import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ZipArchive } from 'archiver'
import JSZip from 'jszip'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const marker = 'TLC_TEAMS_GENERATED_RUNTIME'

export async function stageTeamsRuntime(outputDirectory = join(root, 'release-teams', 'runtime'), sourceRoot = root) {
  const target = resolve(outputDirectory)
  if (basename(target) !== 'runtime' || target === resolve(sourceRoot)) throw new Error('A dedicated runtime output directory is required.')
  let exists = true
  try { await readdir(target) } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false }
  if (exists) {
    if ((await readFile(join(target, '.generated-teams-runtime'), 'utf8')) !== marker) throw new Error('Refusing to replace a directory not owned by the Teams packager.')
    await rm(target, { recursive: true, force: true })
  }
  await mkdir(target, { recursive: true })
  await writeFile(join(target, '.generated-teams-runtime'), marker)
  const rootPackage = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))
  const teamsPackage = JSON.parse(await readFile(join(sourceRoot, 'apps', 'teams', 'package.json'), 'utf8'))
  const mcpPackage = JSON.parse(await readFile(join(sourceRoot, 'packages', 'connectors', 'mcp', 'package.json'), 'utf8'))
  const documentsPackage = JSON.parse(await readFile(join(sourceRoot, 'packages', 'documents', 'package.json'), 'utf8'))
  const dependencies = {}
  for (const name of ['@azure/ai-projects', '@azure/identity', 'pdf-parse', 'zod']) {
    if (!rootPackage.dependencies[name]) throw new Error(`Missing declared runtime dependency: ${name}`)
    dependencies[name] = rootPackage.dependencies[name]
  }
  for (const name of ['@azure/data-tables', '@azure/msal-node', '@microsoft/teams.apps', 'express', 'jose']) {
    if (teamsPackage.dependencies[name]) dependencies[name] = teamsPackage.dependencies[name]
  }
  dependencies['@modelcontextprotocol/sdk'] = mcpPackage.dependencies['@modelcontextprotocol/sdk']
  Object.assign(dependencies, documentsPackage.dependencies)
  await cp(join(sourceRoot, 'apps', 'teams', 'dist'), target, { recursive: true })
  for (const name of ['foundry.environment.example.json', 'mcp.servers.json', 'mcp.tool-policy.json', 'dataverse.entity-map.json', 'teams-disclosure.example.json']) {
    await mkdir(join(target, 'config'), { recursive: true })
    await cp(join(sourceRoot, 'config', name), join(target, 'config', name))
  }
  await cp(join(sourceRoot, 'apps', 'teams', '.env.example'), join(target, 'runtime.env.example'))
  await mkdir(join(target, 'docs', 'knowledge'), { recursive: true })
  await cp(join(sourceRoot, 'docs', 'knowledge', 'MCEM Overview.pdf'), join(target, 'docs', 'knowledge', 'MCEM Overview.pdf'))
  await writeFile(join(target, 'package.json'), `${JSON.stringify({
    name: '@tlc/teams-release', version: teamsPackage.version, private: true, type: 'module',
    engines: rootPackage.engines, scripts: { start: 'node --experimental-sqlite server.js' }, dependencies
  }, null, 2)}\n`)
  await writeFile(join(target, 'RUNTIME-README.txt'), [
    'TLC Assist Teams host runtime',
    '',
    'This is the separately hosted service, not the ZIP to upload into Teams.',
    'The bundled node_modules match the packaging OS and CPU. Restore dependencies',
    'with npm ci --omit=dev on the destination platform when they differ.',
    'For a local sanitized preview: set TLC_TEAMS_MODE=sample, then npm start.',
    'Use a reachable, trusted HTTPS proxy/origin for Teams clients.',
    'Live mode requires approved FTE/Entra/MSX/MCP/Graph/disclosure/storage configuration.',
    'runtime.env.example and config/teams-disclosure.example.json are safe templates,',
    'not working live credentials or an approved disclosure policy. They are not auto-loaded.',
    'Set TLC_TEAMS_ADMISSION=read-only to stop new work while retaining authorized reads.',
    'No credentials or real Foundry environment configuration are bundled.',
    ''
  ].join('\n'))
  return target
}

export function createRuntimeInstallEnvironment(environment = process.env) {
  const childEnvironment = { ...environment }
  // npm run exports .npmrc policy as flags; npm rejects those for a child project.
  for (const key of Object.keys(childEnvironment)) {
    if (key.toLowerCase() === 'npm_config_allow_scripts') delete childEnvironment[key]
  }
  return childEnvironment
}

export function installTeamsRuntime(runtime, environment = process.env) {
  const install = spawnSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: runtime, shell: process.platform === 'win32', stdio: 'inherit',
    env: createRuntimeInstallEnvironment(environment)
  })
  if (install.error) throw install.error
  if (install.status !== 0) throw new Error('Runtime production dependency installation failed.')
}

export async function packageTeamsRuntime() {
  const runtime = await stageTeamsRuntime()
  installTeamsRuntime(runtime)
  const output = join(root, 'release-teams', `TLC-Assist-Teams-runtime-${process.platform}-${process.arch}.zip`)
  await new Promise((resolveZip, reject) => {
    const destination = createWriteStream(output)
    const archive = new ZipArchive({ forceZip64: true, zlib: { level: 1 } })
    destination.on('close', resolveZip)
    destination.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', reject)
    archive.pipe(destination)
    archive.directory(runtime, false)
    void archive.finalize().catch(reject)
  })
  const zip = await JSZip.loadAsync(await readFile(output), { checkCRC32: true })
  for (const name of ['server.js', 'client/index.html', 'package.json', 'package-lock.json', 'node_modules/express/package.json', 'config/mcp.tool-policy.json']) {
    if (!zip.file(name)) throw new Error(`Runtime archive is incomplete: ${name}`)
  }
  if (Object.keys(zip.files).some((name) => /(^|\/)\.env($|\.)|foundry\.environment\.json$|portfolio-preferences|\.sqlite($|-)/i.test(name))) {
    throw new Error('Private environment or state files were included in the runtime archive.')
  }
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.info(`Teams runtime ZIP: ${await packageTeamsRuntime()}`)
}
