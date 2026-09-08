import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publishDesktopArtifacts } from '../../../scripts/package-desktop-release.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('desktop release package', () => {
  it('publishes release artifacts without copying unpacked staging files', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tlc-desktop-release-test-'))
    temporaryDirectories.push(temporaryDirectory)
    const stagingRoot = join(temporaryDirectory, 'staging')
    const releaseRoot = join(temporaryDirectory, 'release')
    await mkdir(join(stagingRoot, 'win-unpacked'), { recursive: true })
    await mkdir(releaseRoot, { recursive: true })
    await Promise.all([
      writeFile(join(stagingRoot, 'TLC.exe'), 'new installer'),
      writeFile(join(stagingRoot, 'TLC.exe.blockmap'), 'block map'),
      writeFile(join(stagingRoot, 'TLC.zip'), 'portable archive'),
      writeFile(join(stagingRoot, 'builder-effective-config.yaml'), 'config'),
      writeFile(join(stagingRoot, 'win-unpacked', 'app.exe'), 'unpacked app'),
      writeFile(join(releaseRoot, 'old.exe'), 'old installer')
    ])

    const artifacts = await publishDesktopArtifacts(stagingRoot, releaseRoot)

    expect(artifacts.sort()).toEqual(['TLC.exe', 'TLC.exe.blockmap', 'TLC.zip'])
    expect((await readdir(releaseRoot)).sort()).toEqual(['TLC.exe', 'TLC.exe.blockmap', 'TLC.zip'])
    await expect(readFile(join(releaseRoot, 'TLC.exe'), 'utf8')).resolves.toBe('new installer')
  })
})