import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver'
import { packageWebRelease } from './package-web-release.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function createAppServiceZip(packageRoot, artifactPath) {
  await mkdir(dirname(artifactPath), { recursive: true })
  await rm(artifactPath, { force: true })
  const archive = new ZipArchive({ forceZip64: true, zlib: { level: 9 } })
  const completion = pipeline(archive, createWriteStream(artifactPath))
  archive.directory(packageRoot, false)
  await archive.finalize()
  await completion
  return artifactPath
}

async function prepareWebAppServiceRelease() {
  const packageRoot = await mkdtemp(join(tmpdir(), 'tlc-web-appservice-'))
  try {
    await packageWebRelease(packageRoot)
    const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    const artifactPath = join(
      repositoryRoot,
      'release-web',
      `TLC-MultiAgent-Assist-${packageJson.version}-Web-AppService.zip`
    )

    const npm = resolveNpmInvocation()
    await run(npm.command, [...npm.argsPrefix, ...createProductionInstallArgs(packageRoot)])
    const canvasPackage = JSON.parse(await readFile(join(packageRoot, 'node_modules', '@napi-rs', 'canvas', 'package.json'), 'utf8'))
    await run(npm.command, [
      ...npm.argsPrefix,
      ...createLinuxCanvasInstallArgs(packageRoot, canvasPackage.optionalDependencies)
    ])
    await run(process.execPath, [join(repositoryRoot, 'scripts', 'smoke-web-release.mjs'), packageRoot])
    await createAppServiceZip(packageRoot, artifactPath)
    console.info(`App Service package created at ${artifactPath}`)
  } finally {
    await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined)
  }
}

export function createProductionInstallArgs(packageRoot) {
  return [
    'install',
    '--omit=dev',
    '--ignore-scripts',
    '--package-lock=false',
    '--prefix',
    packageRoot
  ]
}

export function createLinuxCanvasInstallArgs(packageRoot, optionalDependencies) {
  const packageName = '@napi-rs/canvas-linux-x64-gnu'
  const version = optionalDependencies?.[packageName]
  if (!version) throw new Error(`${packageName} is not declared by @napi-rs/canvas`)
  return [
    'install',
    `${packageName}@${version}`,
    '--omit=dev',
    '--ignore-scripts',
    '--package-lock=false',
    '--no-save',
    '--force',
    '--prefix',
    packageRoot
  ]
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`))
    })
  })
}

export function resolveNpmInvocation({
  platform = process.platform,
  nodeExecutable = process.execPath,
  npmExecPath = process.env.npm_execpath
} = {}) {
  if (platform !== 'win32') return { command: 'npm', argsPrefix: [] }
  return {
    command: nodeExecutable,
    argsPrefix: [npmExecPath || join(dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareWebAppServiceRelease()
}