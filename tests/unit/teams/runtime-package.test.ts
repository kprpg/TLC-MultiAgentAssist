import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { createRuntimeInstallEnvironment, installTeamsRuntime, packageTeamsRuntime, stageTeamsRuntime } from '../../../scripts/package-teams-runtime.mjs'

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})

async function createSourceFixture(folder: string) {
  const source = join(folder, 'source')
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ engines: { node: '>=22.12.0' }, dependencies: { zod: '4.4.3', '@azure/identity': '^4.13.2', '@azure/ai-projects': '^2.5.0', 'pdf-parse': '^2.4.5' } }),
    'apps\\teams\\package.json': JSON.stringify({ version: '0.1.0', dependencies: { express: '^5.1.0', jose: '6.2.12', '@microsoft/teams.apps': '2.1.1' } }),
    'packages\\connectors\\mcp\\package.json': JSON.stringify({ dependencies: { '@modelcontextprotocol/sdk': '1.32.1' } }),
    'packages\\documents\\package.json': JSON.stringify({ dependencies: { docx: '^9.7.1' } }),
    'apps\\teams\\dist\\server.js': 'console.log("test host")',
    'apps\\teams\\dist\\client\\index.html': '<html>fixture</html>',
    'apps\\teams\\dist\\client\\build.json': '{"contractVersion":"1.0","buildId":"22222222-2222-4222-8222-222222222222"}',
    'apps\\teams\\dist\\runtime.env': 'sensitive-runtime-configuration-must-not-ship',
    'apps\\teams\\dist\\operator-state.sqlite': 'private-state-must-not-ship',
    'docs\\knowledge\\MCEM Overview.pdf': 'fixture pdf',
    'config\\foundry.environment.example.json': '{}',
    'config\\mcp.servers.json': '{}',
    'config\\mcp.tool-policy.json': '{}',
    'config\\dataverse.entity-map.json': '{}',
    'config\\teams-disclosure.example.json': '{"policies":[]}',
    'apps\\teams\\.env.example': 'TLC_TEAMS_MODE=sample\nTLC_TEAMS_API_CREDENTIAL=REPLACE_WITH_APPROVED_SERVER_CREDENTIAL\n',
    'apps\\teams\\.env.native.example': 'TLC_TEAMS_AUTH_MODE=local-interactive\n',
    'apps\\teams\\.env.cli.example': 'TLC_TEAMS_AUTH_MODE=local-azure-cli\n',
    'scripts\\teams-local-connection.ps1': '# fixture owner command\n',
    'scripts\\teams-launch-session.ps1': '# fixture launch verification\n',
    'config\\foundry.environment.json': 'sensitive-configuration-must-not-ship'
  }
  for (const [name, contents] of Object.entries(files)) {
    const path = join(source, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
  return source
}

describe('self-contained host release staging', () => {
  it('removes only npm-run exported allow-scripts flags while retaining user policy and registry configuration', () => {
    const environment = {
      NPM_CONFIG_ALLOW_SCRIPTS: '@fixture/approved-script',
      npm_config_userconfig: 'protected-user-policy',
      npm_config_registry: 'https://registry.npmjs.org',
      PATH: 'fixture-path'
    }
    expect(createRuntimeInstallEnvironment(environment)).toEqual({
      npm_config_userconfig: 'protected-user-policy',
      npm_config_registry: 'https://registry.npmjs.org',
      PATH: 'fixture-path'
    })
    expect(environment.NPM_CONFIG_ALLOW_SCRIPTS).toBe('@fixture/approved-script')
  })

  it('installs a standalone project offline without running any lifecycle script, even inside npm run', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tlc-teams-install-policy-'))
    try {
      await writeFile(join(folder, 'package.json'), JSON.stringify({
        name: 'tlc-runtime-install-policy-fixture', version: '1.0.0', private: true,
        scripts: { postinstall: 'node -e "require(\'node:fs\').writeFileSync(\'unexpected-script\', \'executed\')"' }
      }))
      installTeamsRuntime(folder, { ...process.env, npm_config_allow_scripts: '@fixture/approved-script', npm_config_offline: 'true' })
      await expect(readFile(join(folder, 'unexpected-script'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(JSON.parse(await readFile(join(folder, 'package-lock.json'), 'utf8')).name).toBe('tlc-runtime-install-policy-fixture')
    } finally { await rm(folder, { recursive: true, force: true }) }
  }, 60_000)

  it('loads the packager in native Node ESM without relying on test-runner interop', () => {
    const result = execFileSync(process.execPath, [
      '--input-type=module', '--eval',
      'const runtime = await import(process.argv[1]); console.log(typeof runtime.packageTeamsRuntime)',
      new URL('../../../scripts/package-teams-runtime.mjs', import.meta.url).href
    ], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
    expect(result.trim()).toBe('function')
  }, 15_000)

  it('stages the compiled host, browser, safe configs and production dependencies without workspace links or secrets', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tlc-teams-runtime-'))
    try {
      const source = await createSourceFixture(folder)
      const target = join(folder, 'runtime')
      await stageTeamsRuntime(target, source)
      expect(await readFile(join(target, 'server.js'), 'utf8')).toContain('test host')
      expect(await readFile(join(target, 'client', 'index.html'), 'utf8')).toContain('fixture')
      expect(JSON.parse(await readFile(join(target, 'client', 'build.json'), 'utf8')).buildId).toBe('22222222-2222-4222-8222-222222222222')
      const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
      expect(manifest.scripts.start).toBe('node --experimental-sqlite server.js')
      expect(manifest.scripts['start:configured']).toBe('node --env-file=runtime.env --experimental-sqlite server.js')
      expect(manifest.workspaces).toBeUndefined()
      expect(manifest.dependencies['@microsoft/teams.apps']).toBe('2.1.1')
      expect(await readFile(join(target, 'runtime.env.example'), 'utf8')).toContain('REPLACE_WITH_APPROVED_SERVER_CREDENTIAL')
      expect(await readFile(join(target, 'runtime.native.env.example'), 'utf8')).toContain('local-interactive')
      expect(await readFile(join(target, 'runtime.cli.env.example'), 'utf8')).toContain('local-azure-cli')
      expect(await readFile(join(target, 'scripts', 'teams-local-connection.ps1'), 'utf8')).toContain('owner command')
      expect(await readFile(join(target, 'scripts', 'teams-launch-session.ps1'), 'utf8')).toContain('launch verification')
      expect(await readFile(join(target, 'config', 'teams-disclosure.example.json'), 'utf8')).toContain('policies')
      const instructions = await readFile(join(target, 'RUNTIME-README.txt'), 'utf8')
      expect(instructions).toContain('npm run start:configured')
      expect(instructions).toContain('Ctrl+C')
      expect(instructions).toContain('backup')
      expect(instructions).toContain('Azure later')
      expect(instructions).not.toContain('central platform operator')
      await expect(readFile(join(target, 'config', 'foundry.environment.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(target, 'runtime.env'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(target, 'operator-state.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(folder, { recursive: true, force: true }) }
  })

  it.each(['missing', 'invalid'] as const)('preserves unowned staging contents and explains a %s ownership marker', async (ownership) => {
    const folder = await mkdtemp(join(tmpdir(), 'tlc-teams-unowned-runtime-'))
    try {
      const target = join(folder, 'runtime')
      await mkdir(join(target, 'node_modules'), { recursive: true })
      await writeFile(join(target, 'node_modules', 'retained.txt'), 'unowned contents')
      if (ownership === 'invalid') await writeFile(join(target, '.generated-teams-runtime'), 'not-owned')
      await expect(stageTeamsRuntime(target, join(folder, 'source'))).rejects.toThrow(/Refusing to replace.*not owned by the Teams packager/)
      expect(await readFile(join(target, 'node_modules', 'retained.txt'), 'utf8')).toBe('unowned contents')
      if (ownership === 'missing') await expect(readFile(join(target, '.generated-teams-runtime'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(folder, { recursive: true, force: true }) }
  })

  it('packages in a fresh build directory despite unmarked legacy node_modules, then removes only its own staging', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tlc-teams-fresh-build-'))
    const installer = vi.mocked(spawnSync)
    try {
      const source = await createSourceFixture(folder)
      const outputDirectory = join(folder, 'release-teams')
      const legacy = join(outputDirectory, 'runtime')
      await mkdir(join(legacy, 'node_modules'), { recursive: true })
      await writeFile(join(legacy, 'node_modules', 'retained.txt'), 'unowned contents')
      const stages: string[] = []
      const installFixture = () => installer.mockImplementationOnce((...args) => {
        const options = args[2]
        if (!options || typeof options.cwd !== 'string') throw new Error('Expected a runtime installation directory.')
        stages.push(options.cwd)
        mkdirSync(join(options.cwd, 'node_modules', 'express'), { recursive: true })
        writeFileSync(join(options.cwd, 'node_modules', 'express', 'package.json'), '{"name":"express","version":"5.1.0"}')
        writeFileSync(join(options.cwd, 'package-lock.json'), '{"lockfileVersion":3}')
        return { pid: 0, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0, signal: null }
      })
      for (let build = 0; build < 2; build++) {
        installFixture()
        const output = await packageTeamsRuntime(outputDirectory, source)
        const archive = await JSZip.loadAsync(await readFile(output), { checkCRC32: true })
        expect(await archive.file('.generated-teams-runtime')?.async('string')).toBe('TLC_TEAMS_GENERATED_RUNTIME')
        expect(await archive.file('server.js')?.async('string')).toContain('test host')
        expect(archive.file('node_modules/retained.txt')).toBeNull()
        expect(await readFile(join(legacy, 'node_modules', 'retained.txt'), 'utf8')).toBe('unowned contents')
        expect((await readdir(outputDirectory)).some((name) => name.startsWith('.runtime-build-'))).toBe(false)
      }
      expect(stages).toHaveLength(2)
      expect(stages[0]).not.toBe(stages[1])
    } finally {
      installer.mockClear()
      await rm(folder, { recursive: true, force: true })
    }
  }, 30_000)

  it('cleans its own staging after an install failure without touching unowned output or publishing an archive', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tlc-teams-failed-build-'))
    try {
      const source = await createSourceFixture(folder)
      const outputDirectory = join(folder, 'release-teams')
      const legacy = join(outputDirectory, 'runtime')
      await mkdir(legacy, { recursive: true })
      await writeFile(join(legacy, 'retained.txt'), 'unowned contents')
      vi.mocked(spawnSync).mockReturnValueOnce({
        pid: 0, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 1, signal: null
      })
      await expect(packageTeamsRuntime(outputDirectory, source)).rejects.toThrow('Runtime production dependency installation failed.')
      expect(await readdir(outputDirectory)).toEqual(['runtime'])
      expect(await readFile(join(legacy, 'retained.txt'), 'utf8')).toBe('unowned contents')
    } finally { await rm(folder, { recursive: true, force: true }) }
  })
})
