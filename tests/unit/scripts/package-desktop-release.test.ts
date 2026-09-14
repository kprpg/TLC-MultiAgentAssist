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
  it('includes the MCP runtime configuration as packaged resources', async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), 'apps/desktop/package.json'), 'utf8'))

    expect(packageJson.dependencies).toHaveProperty('@modelcontextprotocol/sdk', '1.29.0')
    expect(packageJson.build.extraResources).toEqual(expect.arrayContaining([
      { from: '../../config/mcp.servers.json', to: 'config/mcp.servers.json' },
      { from: '../../config/mcp.tool-policy.json', to: 'config/mcp.tool-policy.json' },
      { from: '../../config/dataverse.entity-map.json', to: 'config/dataverse.entity-map.json' }
    ]))
  })

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