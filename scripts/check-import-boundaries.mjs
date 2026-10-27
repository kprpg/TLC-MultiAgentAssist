#!/usr/bin/env node
// Dependency-direction gate: apps -> packages/orchestrator -> packages/{common,connectors,agents}.
// Known pre-existing violations live in scripts/import-boundary-baseline.json and can only shrink.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))
const skippedDirectories = new Set(['node_modules', 'dist', 'dist-electron', 'coverage', 'release', 'out', '.vite'])
const backendLayers = ['connectors', 'agents', 'documents']
// Presentation code must not depend on these; packages/documents is a neutral, browser-safe shared package.
const presentationForbiddenPackages = ['connectors', 'agents', 'orchestrator']
const previewZone = 'apps/desktop/renderer-revamp/src/preview/'
const previewConsumers = new Set(['apps/desktop/renderer-revamp/src/data-client.ts'])

/** Replaces comments with spaces and every string literal with a numbered placeholder so only real syntax is matched. */
function tokenize(source) {
  const strings = []
  let code = ''
  let index = 0
  const length = source.length
  const regexPrecedes = (text) => {
    const tail = text.replace(/\s+$/, '')
    return tail === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(tail) || /\b(?:return|typeof|case|in|of|void|delete|throw|else)$/.test(tail)
  }
  while (index < length) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '/' && next === '/') {
      while (index < length && source[index] !== '\n') index++
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? length : end + 2
      code += ' '
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      let value = ''
      index++
      while (index < length && source[index] !== char) {
        if (source[index] === '\\') { value += source[index + 1] ?? ''; index += 2; continue }
        value += source[index++]
      }
      index++
      strings.push(value)
      code += `'§${strings.length - 1}§'`
      continue
    }
    if (char === '/' && regexPrecedes(code)) {
      let inClass = false
      index++
      while (index < length) {
        const current = source[index]
        if (current === '\\') { index += 2; continue }
        if (current === '\n') break
        if (current === '[') inClass = true
        else if (current === ']') inClass = false
        else if (current === '/' && !inClass) { index++; break }
        index++
      }
      while (/[a-z]/i.test(source[index] ?? '')) index++
      code += ' 0 '
      continue
    }
    code += char
    index++
  }
  return { code, strings }
}

function isTypeOnly(clause) {
  const text = clause.trim()
  if (/^type\b(?!\s*,)/.test(text) && !/^type\s+from\b/.test(text)) return true
  const braces = /\{([\s\S]*)\}/.exec(text)
  if (!braces) return false
  const entries = braces[1].split(',').map((entry) => entry.trim()).filter(Boolean)
  return entries.length > 0 && entries.every((entry) => /^type\s/.test(entry)) && !/^[^{]*\S[^{]*\{/.test(text.replace(/^type\s/, ''))
}

function importsOf(source) {
  const { code, strings } = tokenize(source)
  const found = []
  const add = (placeholder, typeOnly) => found.push({ specifier: strings[Number(placeholder)], typeOnly })
  for (const match of code.matchAll(/\b(?:import|export)\b\s*([^;'`"§]*?)\s*\bfrom\s*'§(\d+)§'/g)) add(match[2], isTypeOnly(match[1]))
  for (const match of code.matchAll(/\bimport\s*'§(\d+)§'/g)) add(match[1], false)
  for (const match of code.matchAll(/\bimport\s*\(\s*'§(\d+)§'\s*[,)]/g)) add(match[1], false)
  return found
}

function layerOf(path) {
  const parts = path.split('/')
  if (parts[0] === 'packages') return { kind: 'package', name: parts[1] ?? '' }
  if (parts[0] === 'apps') return { kind: 'app', name: parts[1] ?? '' }
  return { kind: 'other', name: '' }
}

function isPresentation(file) {
  return file.startsWith('apps/shared/') || file.startsWith('apps/vscode-extension/src/webview/') ||
    file.startsWith('apps/desktop/renderer/') || file.startsWith('apps/desktop/renderer-revamp/') || file.startsWith('apps/teams/src/client/')
}

function isNodeBuiltin(specifier) {
  return specifier.startsWith('node:') || builtins.has(specifier.split('/')[0])
}

export function analyzeImports(sources) {
  const violations = []
  for (const [file, source] of Object.entries(sources)) {
    const from = layerOf(file)
    if (from.kind === 'other') continue
    for (const { specifier, typeOnly } of importsOf(source)) {
      const flag = (rule, target) => violations.push({ rule, file, target })
      // Bundler asset imports (for example `prompts.md?raw`) are data, not code coupling.
      if (specifier.includes('?')) continue
      if (!specifier.startsWith('.')) {
        if (isPresentation(file) && !typeOnly && isNodeBuiltin(specifier)) flag('ui-node-builtin', specifier)
        continue
      }
      const target = posix.normalize(posix.join(posix.dirname(file), specifier))
      const to = layerOf(target)
      if (to.kind === 'other') continue
      if (from.kind === 'package') {
        if (to.kind === 'app') flag('core-to-app', target)
        else if (from.name === 'common' && to.name !== 'common') flag('common-purity', target)
        else if (backendLayers.includes(from.name) && to.name === 'orchestrator' && !typeOnly) flag('backend-to-orchestrator-runtime', target)
        else if (from.name === 'connectors' && to.name === 'agents' && !typeOnly) flag('connector-to-agent-runtime', target)
        continue
      }
      if (to.kind === 'app' && to.name !== from.name && to.name !== 'shared') flag('app-to-app', target)
      if (target.startsWith(previewZone) && !file.startsWith(previewZone) && !previewConsumers.has(file)) flag('ui-preview-leak', target)
      if (isPresentation(file) && !file.startsWith(previewZone) && to.kind === 'package' && !typeOnly && presentationForbiddenPackages.includes(to.name)) {
        flag('ui-backend-internals', target)
      }
    }
  }
  return violations
}

const key = (entry) => `${entry.rule}\0${entry.file}\0${entry.target}`

export function applyBaseline(violations, baseline) {
  const allowed = new Set(baseline.map(key))
  const present = new Set(violations.map(key))
  return {
    newViolations: violations.filter((violation) => !allowed.has(key(violation))),
    staleBaseline: baseline.filter((entry) => !present.has(key(entry)))
  }
}

export function loadSources(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const sources = {}
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      if (skippedDirectories.has(name) || name.startsWith('release')) continue
      const path = join(directory, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(?:ts|tsx|mts)$/.test(name) && !name.endsWith('.d.ts')) {
        sources[relative(root, path).split(sep).join('/')] = readFileSync(path, 'utf8')
      }
    }
  }
  for (const top of ['apps', 'packages']) walk(join(root, top))
  return sources
}

export function loadBaseline(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  return JSON.parse(readFileSync(join(root, 'scripts', 'import-boundary-baseline.json'), 'utf8'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const { newViolations, staleBaseline } = applyBaseline(analyzeImports(loadSources(root)), loadBaseline(root))
  for (const violation of newViolations) console.error(`FORBIDDEN ${violation.rule}: ${violation.file} -> ${violation.target}`)
  for (const entry of staleBaseline) console.error(`STALE BASELINE (fixed; remove it): ${entry.rule}: ${entry.file} -> ${entry.target}`)
  if (newViolations.length || staleBaseline.length) process.exit(1)
  console.log('Import boundaries passed.')
}
