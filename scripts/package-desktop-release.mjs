import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseExtensions = new Set(['.exe', '.zip', '.blockmap'])

export async function publishDesktopArtifacts(stagingRoot, releaseRoot) {
  await mkdir(releaseRoot, { recursive: true })

  const stagedArtifacts = (await readdir(stagingRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && releaseExtensions.has(extname(entry.name)))
    .map((entry) => entry.name)

  if (stagedArtifacts.length === 0) {
    throw new Error(`No desktop release artifacts were produced in ${stagingRoot}`)
  }

  const existingArtifacts = (await readdir(releaseRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && releaseExtensions.has(extname(entry.name)))
  await Promise.all(existingArtifacts.map((entry) => rm(join(releaseRoot, entry.name), { force: true })))
  await Promise.all(stagedArtifacts.map((name) => cp(join(stagingRoot, name), join(releaseRoot, basename(name)))))

  return stagedArtifacts
}

async function packageDesktopRelease() {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'tlc-desktop-package-'))
  try {
    await runElectronBuilder(stagingRoot)
    const artifacts = await publishDesktopArtifacts(stagingRoot, join(repositoryRoot, 'release'))
    console.info(`Desktop release artifacts published: ${artifacts.join(', ')}`)
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

function runElectronBuilder(stagingRoot) {
  const cliPath = join(repositoryRoot, 'node_modules', 'electron-builder', 'cli.js')
  const args = [
    cliPath,
    '--projectDir',
    'apps/desktop',
    '--win',
    '--x64',
    '--publish',
    'never',
    `--config.directories.output=${stagingRoot}`
  ]

  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: repositoryRoot, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`electron-builder failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`))
    })
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageDesktopRelease()
}