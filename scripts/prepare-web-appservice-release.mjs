import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { packageWebRelease } from './package-web-release.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function createAppServiceZip(packageRoot, artifactPath) {
  const archive = new JSZip()
  await addDirectory(archive, packageRoot, packageRoot)
  await mkdir(dirname(artifactPath), { recursive: true })
  await rm(artifactPath, { force: true })
  await pipeline(
    archive.generateNodeStream({
      type: 'nodebuffer',
      streamFiles: true,
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    }),
    createWriteStream(artifactPath)
  )
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
    await run(npm.command, [...npm.argsPrefix, 'install', '--omit=dev', '--ignore-scripts', '--package-lock=false', '--prefix', packageRoot])
    await run(process.execPath, [join(repositoryRoot, 'scripts', 'smoke-web-release.mjs'), packageRoot])
    await createAppServiceZip(packageRoot, artifactPath)
    console.info(`App Service package created at ${artifactPath}`)
  } finally {
    await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined)
  }
}

async function addDirectory(archive, root, currentDirectory) {
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = join(currentDirectory, entry.name)
    const archivePath = relative(root, absolutePath).split(sep).join('/')
    if (entry.isDirectory()) {
      await addDirectory(archive, root, absolutePath)
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const metadata = await stat(absolutePath)
      archive.file(archivePath, createReadStream(absolutePath), { unixPermissions: metadata.mode })
    }
  }
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