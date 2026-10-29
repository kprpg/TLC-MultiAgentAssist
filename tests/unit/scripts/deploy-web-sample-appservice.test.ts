import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const repository = resolve(import.meta.dirname, '../../..')
const script = join(repository, 'scripts', 'deploy-web-appservice.ps1')
const directories: string[] = []
const subscription = '00000000-0000-0000-0000-000000000001'
const tenant = '00000000-0000-0000-0000-000000000002'
const planId = `/subscriptions/${subscription}/resourceGroups/test-rg/providers/Microsoft.Web/serverfarms/test-plan`
const powershellScriptTimeoutMs = 30_000
interface Call {
    command: string
    args: string[]
    productionDeployment: string
    productionAuth: boolean
    productionRequireAuthentication: boolean
    productionMode: string | null
}
interface MockState {
    tenantId: string
    plan: { id: string; sku: { tier: string; capacity: number }; elasticScaleEnabled: boolean }
    sites: Record<string, {
        name: string; kind: string; defaultHostName: string; serverFarmId: string
        siteConfig: { linuxFxVersion: string; numberOfWorkers: number }
    }>
    settings: Record<string, Record<string, string>>
    auth: Record<string, {
        version: string; enabled: boolean; requireAuthentication: boolean; excludedPaths: string[]
        unauthenticatedClientAction?: 'AllowAnonymous' | 'RedirectToLoginPage' | null
    }>
    deployments: Record<string, { id: string; status: number; active: boolean }>
    sticky: string[]
    calls: Call[]
    sequence: number
    acceptedCliFailure?: boolean
    failProductionVerification?: boolean
    failSwap?: boolean
}

afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('public sample App Service workflow', () => {
    it('defaults to the sample slot without requiring mode or slot arguments', async () => {
        const fixture = await createFixture()
        const before = await fixture.state()
        const result = await fixture.run('Deploy', [], false, undefined, true)
        const after = await fixture.state()

        expect(result.stdout).toContain('Verified sample deployment')
        expect(after.settings['production']).toEqual(before.settings['production'])
        expect(after.auth['production']).toEqual(before.auth['production'])
        expect(after.deployments['production']).toEqual(before.deployments['production'])
        const upload = after.calls.find((call) => call.args.slice(0, 2).join(' ') === 'webapp deploy')
        expect(upload?.args).toEqual(expect.arrayContaining(['--slot', 'sample']))
        expect(after.calls.filter((call) => mutation(call) && call.args[0] !== 'rest').every((call) => call.args.includes('--slot'))).toBe(true)
    }, 60_000)

    it('packages without Azure login or a real Foundry configuration', async () => {
        const fixture = await createFixture()
        const result = await fixture.run('Deploy', ['-PackageOnly'])
        expect(result.stdout).toContain('Azure was not contacted')
        expect((await fixture.state()).calls).toEqual([])
    }, powershellScriptTimeoutMs)

    it('deploys only to sample and leaves production authentication and settings untouched', async () => {
        const fixture = await createFixture()
        const before = await fixture.state()
        const result = await fixture.run()
        const after = await fixture.state()
        expect(result.stdout).toContain('Production was not changed')
        expect(after.settings['production']).toEqual(before.settings['production'])
        expect(after.auth['production']).toEqual(before.auth['production'])
        expect(after.settings['sample']).toMatchObject({
            TLC_WEB_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_DATA_STORE_PATH: ':memory:', HOST: '0.0.0.0'
        })
        expect(after.auth['sample']?.enabled).toBe(false)
        expect(after.sticky).toEqual(before.sticky)
        const upload = after.calls.find((call) => call.args.slice(0, 2).join(' ') === 'webapp deploy')
        expect(upload?.args).toEqual(expect.arrayContaining(['--async', 'true', '--timeout', '1800000']))
        expect(JSON.parse(await readFile(fixture.receipt, 'utf8'))).toMatchObject({ version: 1, state: 'staged', deploymentId: 'deployment-1' })
        expect(await readFile(fixture.receipt, 'utf8')).not.toContain('must-not-enter-a-receipt')
        expect(after.calls.filter((call) => mutation(call) && call.args[0] !== 'rest').every((call) => call.args.includes('--slot'))).toBe(true)
    }, 60_000)

    it('does not mutate Azure or write a receipt during WhatIf', async () => {
        const fixture = await createFixture()
        await fixture.run('Deploy', ['-WhatIf'])
        expect((await fixture.state()).calls.filter(mutation)).toEqual([])
        await expect(readFile(fixture.receipt)).rejects.toMatchObject({ code: 'ENOENT' })
    }, powershellScriptTimeoutMs)

    it('configures Foundry metadata only for the sample slot and does not claim paid inference was verified', async () => {
        const fixture = await createFixture()
        const before = await fixture.state()
        const foundryPath = join(fixture.directory, 'foundry.json')
        await writeFile(foundryPath, JSON.stringify({
            foundry: { projectEndpoint: 'https://example.services.ai.azure.com/api/projects/demo', agents: { accountPulse: { name: 'sample-agent' } } }
        }))
        const result = await fixture.run('Deploy', ['-AiMode', 'foundry'], true, foundryPath)
        const after = await fixture.state()
        expect(after.settings['sample']).toMatchObject({ TLC_AI_MODE: 'foundry' })
        expect(after.settings['sample']!['TLC_FOUNDRY_ENV_BASE64']).toBeTruthy()
        expect(after.settings['production']).toEqual(before.settings['production'])
        expect(`${result.stdout}${result.stderr}`).toContain('Foundry inference was not invoked')
    }, 60_000)

    it.each([true, false])('uses classic commands for a v1 sample slot with enabled=%s', async (enabled) => {
        const fixture = await createFixture((state) => {
            state.auth['sample']!.version = 'v1'
            state.auth['sample']!.enabled = enabled
            if (!enabled) state.auth['sample']!.unauthenticatedClientAction = null
        })
        await fixture.run()
        const state = await fixture.state()
        expect(state.auth['sample']).toMatchObject({ version: 'v1', enabled: false })
        expect(state.auth['production']).toMatchObject({ version: 'v2', enabled: true, requireAuthentication: true })
        expect(state.calls.some((call) => call.args.slice(0, 3).join(' ') === 'webapp auth-classic update')).toBe(true)
        expect(state.calls.some((call) => call.args.slice(0, 3).join(' ') === 'webapp auth update' && call.args.includes('--slot'))).toBe(false)
    }, 60_000)

    it('finalizes a verified existing upload without changing Azure or rebuilding', async () => {
        const fixture = await createFixture((state) => { state.auth['sample']!.version = 'v1' })
        await fixture.run()
        await rm(fixture.receipt)
        const before = await fixture.state()
        await fixture.run('Verify', ['-WhatIf'])
        await expect(readFile(fixture.receipt)).rejects.toMatchObject({ code: 'ENOENT' })
        const result = await fixture.run('Verify')
        const after = await fixture.state()
        expect(result.stdout).toContain('Verified sample deployment')
        expect(after.calls.filter(mutation)).toEqual(before.calls.filter(mutation))
        expect(JSON.parse(await readFile(fixture.receipt, 'utf8'))).toMatchObject({ state: 'staged', deploymentId: 'deployment-1' })
    }, 60_000)

    it('refuses to finalize a different local ZIP or an authenticated existing slot', async () => {
        const fixture = await createFixture()
        await fixture.run()
        const releaseId = (await fixture.state()).settings['sample']!['TLC_SAMPLE_RELEASE_ID']!
        await fixture.update((state) => { state.settings['sample']!['TLC_SAMPLE_RELEASE_ID'] = 'a'.repeat(64) })
        const before = (await fixture.state()).calls.filter(mutation)
        await expect(fixture.run('Verify')).rejects.toMatchObject({ stderr: expect.stringContaining('recorded sample release') })
        await fixture.update((state) => {
            state.settings['sample']!['TLC_SAMPLE_RELEASE_ID'] = releaseId
            state.auth['sample']!.enabled = true
        })
        await expect(fixture.run('Verify')).rejects.toMatchObject({ stderr: expect.stringContaining('Authentication must be disabled') })
        expect((await fixture.state()).calls.filter(mutation)).toEqual(before)
    }, 60_000)

    it('rejects unknown auth versions before deploying or changing settings', async () => {
        const fixture = await createFixture((state) => { state.auth['sample']!.version = 'v3' })
        await expect(fixture.run()).rejects.toMatchObject({ stderr: expect.stringContaining('active App Service Authentication version') })
        expect((await fixture.state()).calls.filter(mutation)).toEqual([])
    }, powershellScriptTimeoutMs)

    it('refuses a protected classic production swap without silently migrating authentication', async () => {
        const fixture = await createFixture((state) => { state.auth['production']!.version = 'v1' })
        await fixture.run()
        const before = await fixture.state()
        await expect(fixture.run('Promote')).rejects.toMatchObject({ stderr: expect.stringContaining('Protected production promotion requires Auth v2') })
        const after = await fixture.state()
        expect(after.calls.filter(mutation)).toEqual(before.calls.filter(mutation))
        expect(after.auth['production']).toEqual(before.auth['production'])
    }, 60_000)

    it('restores an originally public classic production policy without migrating providers', async () => {
        const fixture = await createFixture((state) => {
            state.auth['production'] = {
                version: 'v1', enabled: false, requireAuthentication: false, excludedPaths: [],
                unauthenticatedClientAction: 'AllowAnonymous'
            }
        })
        const original = await fixture.state()
        await fixture.run()
        await fixture.run('Promote')
        await fixture.run('Rollback')
        expect((await fixture.state()).auth['production']).toEqual(original.auth['production'])
    }, 120_000)

    it.each(['', 'production'])('rejects an explicit unsafe slot: %j', async (slot) => {
        const fixture = await createFixture()
        await expect(fixture.run('Deploy', ['-Slot', slot], false)).rejects.toMatchObject({ stderr: expect.stringContaining('named non-production') })
        expect((await fixture.state()).calls).toEqual([])
    }, powershellScriptTimeoutMs)

    it('refuses to bypass sample verification', async () => {
        const fixture = await createFixture()
        await expect(fixture.run('Deploy', ['-SkipHealthCheck'])).rejects.toMatchObject({ stderr: expect.stringContaining('cannot skip') })
        expect((await fixture.state()).calls).toEqual([])
    }, powershellScriptTimeoutMs)

    it.each(['tenant', 'hostname', 'platform', 'tier', 'capacity', 'runtime', 'sticky-release'] as const)(
        'rejects an incompatible %s before any mutation', async (invalid) => {
            const fixture = await createFixture((state) => {
                if (invalid === 'tenant') state.tenantId = 'wrong-tenant'
                if (invalid === 'hostname') state.sites['production']!.defaultHostName = 'wrong.example.test'
                if (invalid === 'platform') state.sites['production']!.kind = 'app'
                if (invalid === 'tier') state.plan.sku.tier = 'Basic'
                if (invalid === 'capacity') state.plan.sku.capacity = 2
                if (invalid === 'runtime') state.sites['production']!.siteConfig.linuxFxVersion = 'NODE|20-lts'
                if (invalid === 'sticky-release') state.sticky.push('TLC_SAMPLE_RELEASE_ID')
            })
            await expect(fixture.run()).rejects.toThrow()
            expect((await fixture.state()).calls.filter(mutation)).toEqual([])
        }, powershellScriptTimeoutMs
    )

    it('creates a missing slot only with opt-in, without cloning live configuration', async () => {
        const fixture = await createFixture((state) => { delete state.sites['sample'] })
        await expect(fixture.run()).rejects.toMatchObject({ stderr: expect.stringContaining('does not exist') })
        expect((await fixture.state()).calls.filter(mutation)).toEqual([])
        await fixture.run('Deploy', ['-CreateSlot', '-WhatIf'])
        expect((await fixture.state()).calls.filter(mutation)).toEqual([])
        await fixture.run('Deploy', ['-CreateSlot'])
        const calls = (await fixture.state()).calls
        expect(calls.some((call) => call.args.slice(0, 4).join(' ') === 'webapp deployment slot create')).toBe(true)
        expect(calls.some((call) => call.args.includes('--configuration-source'))).toBe(false)
    }, 60_000)

    it.each(['v1', 'v2'])('promotes a %s sample slot without rebuilding and restores protected live production before rollback', async (version) => {
        const fixture = await createFixture((state) => { state.auth['sample']!.version = version })
        const original = await fixture.state()
        await fixture.run()
        await fixture.run('Promote')
        const promoted = await fixture.state()
        expect(promoted.settings['production']).toMatchObject({ TLC_WEB_MODE: 'sample', TLC_DATA_STORE: 'sqlite' })
        expect(promoted.auth['production']).toEqual({ version: 'v2', enabled: false, requireAuthentication: true, excludedPaths: ['/existing-health'] })
        const opened = promoted.calls.find((call) => call.args.includes('--enabled') && call.args.includes('false') && !call.args.includes('--slot'))
        expect(opened).toMatchObject({ productionDeployment: 'deployment-1', productionMode: 'sample' })
        const rollbackStart = promoted.calls.length
        await fixture.update((state) => { state.auth['production']!.requireAuthentication = false })
        await fixture.run('Rollback')
        const rolledBack = await fixture.state()
        expect(rolledBack.settings['production']).toEqual(original.settings['production'])
        expect(rolledBack.auth['production']).toEqual(original.auth['production'])
        expect(rolledBack.sticky).toEqual(original.sticky)
        expect(rolledBack.deployments['production']?.id).toBe('original-production')
        const rollbackCalls = rolledBack.calls.slice(rollbackStart)
        const protectIndex = rollbackCalls.findIndex((call) => call.args.includes('put') && call.args.some((argument) => argument.includes('/config/authsettingsV2?')))
        const swapIndex = rollbackCalls.findIndex((call) => call.args.includes('swap'))
        expect(protectIndex).toBeGreaterThanOrEqual(0)
        expect(protectIndex).toBeLessThan(swapIndex)
        expect(rollbackCalls[swapIndex]).toMatchObject({ productionAuth: true, productionRequireAuthentication: true })
        expect(rollbackCalls.slice(0, swapIndex).some((call) => call.command === 'node' && call.args.includes('--protected'))).toBe(true)
        expect(rolledBack.calls.filter((call) => call.args.slice(0, 2).join(' ') === 'webapp deploy')).toHaveLength(1)
        expect(JSON.parse(await readFile(fixture.receipt, 'utf8')).state).toBe('rolled-back')
        expect(await readFile(fixture.receipt, 'utf8')).not.toContain('must-not-enter-a-receipt')
    }, 120_000)

    it('fails closed after failed production verification and supports an explicit recovery rollback', async () => {
        const fixture = await createFixture()
        await fixture.run()
        await fixture.update((state) => { state.failProductionVerification = true })
        await expect(fixture.run('Promote')).rejects.toMatchObject({ stderr: expect.stringContaining('Sample promotion failed') })
        expect((await fixture.state()).auth['production']?.enabled).toBe(true)
        expect((await fixture.state()).auth['production']?.requireAuthentication).toBe(true)
        expect(JSON.parse(await readFile(fixture.receipt, 'utf8')).state).toBe('promotion-failed')
        await fixture.run('Rollback')
        expect((await fixture.state()).deployments['production']?.id).toBe('original-production')
    }, 120_000)

    it('recovers settings without swapping when promotion failed before the swap', async () => {
        const fixture = await createFixture()
        const original = await fixture.state()
        await fixture.run()
        await fixture.update((state) => { state.failSwap = true })
        await expect(fixture.run('Promote')).rejects.toThrow()
        await fixture.run('Rollback')
        const recovered = await fixture.state()
        expect(recovered.settings['production']).toEqual(original.settings['production'])
        expect(recovered.auth['production']).toEqual(original.auth['production'])
        expect(recovered.calls.filter((call) => call.args.includes('swap'))).toHaveLength(1)
    }, 120_000)

    it('rejects a changed staged deployment and a receipt for another target', async () => {
        const fixture = await createFixture()
        await fixture.run()
        await fixture.update((state) => { state.deployments['sample']!.id = 'someone-else-deployed' })
        const before = (await fixture.state()).calls.filter(mutation).length
        await expect(fixture.run('Promote')).rejects.toMatchObject({ stderr: expect.stringContaining('changed after verification') })
        expect((await fixture.state()).calls.filter(mutation)).toHaveLength(before)
        const receipt = JSON.parse(await readFile(fixture.receipt, 'utf8'))
        receipt.app = 'another-app'
        await writeFile(fixture.receipt, JSON.stringify(receipt))
        await expect(fixture.run('Promote')).rejects.toMatchObject({ stderr: expect.stringContaining('exact Azure target') })
    }, 60_000)

    it('preserves retained rollback content instead of overwriting it on the next deploy', async () => {
        const fixture = await createFixture()
        await fixture.run()
        await fixture.run('Promote')
        const before = (await fixture.state()).calls.filter(mutation).length
        await expect(fixture.run()).rejects.toMatchObject({ stderr: expect.stringContaining('retains production rollback content') })
        expect((await fixture.state()).calls.filter(mutation)).toHaveLength(before)
        await fixture.update((state) => { state.deployments['sample']!.id = 'replaced-rollback' })
        await expect(fixture.run('Rollback')).rejects.toMatchObject({ stderr: expect.stringContaining('rollback deployment was replaced') })
    }, 120_000)

    it('reconciles an accepted deployment after Azure CLI returns a failure', async () => {
        const fixture = await createFixture((state) => { state.acceptedCliFailure = true })
        const result = await fixture.run()
        expect(`${result.stdout}${result.stderr}`).toContain('App Service completed accepted deployment')
        expect(JSON.parse(await readFile(fixture.receipt, 'utf8')).state).toBe('staged')
    }, 60_000)
})

function mutation(call: Call) {
    return call.command === 'az' && call.args.some((argument) => ['set', 'delete', 'update', 'deploy', 'create', 'swap', 'put'].includes(argument))
}

async function createFixture(configure?: (state: MockState) => void) {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-sample-deployment-'))
    directories.push(directory)
    const statePath = join(directory, 'state.json')
    const receipt = join(directory, 'deployment.json')
    const artifact = join(directory, 'sample.zip')
    const site = {
        name: 'test-app', kind: 'app,linux', defaultHostName: 'demo.example.test', serverFarmId: planId,
        siteConfig: { linuxFxVersion: 'NODE|24-lts', numberOfWorkers: 1 }
    }
    const initial: MockState = {
        tenantId: tenant, plan: { id: planId, sku: { tier: 'Premium0V3', capacity: 1 }, elasticScaleEnabled: false },
        sites: { production: site, sample: { ...site, defaultHostName: 'demo-sample.example.test' } },
        settings: { production: { WEBSITE_RUN_FROM_PACKAGE: '1', TLC_FOUNDRY_ENV_BASE64: 'must-not-enter-a-receipt' }, sample: {} },
        auth: {
            production: { version: 'v2', enabled: true, requireAuthentication: true, excludedPaths: ['/existing-health'] },
            sample: { version: 'v2', enabled: false, requireAuthentication: false, excludedPaths: [] }
        },
        deployments: {
            production: { id: 'original-production', status: 4, active: true },
            sample: { id: 'original-sample', status: 4, active: true }
        },
        sticky: ['TLC_WEB_MODE'], calls: [], sequence: 0
    }
    configure?.(initial)
    await writeFile(statePath, JSON.stringify(initial))
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
    for (const command of ['az', 'node']) {
        await writeFile(join(directory, `${command}.ps1`),
            `& ${quote(process.execPath)} ${quote(join(repository, 'tests', 'fixtures', 'appservice-cli.mjs'))} '${command}' @args\n$global:LASTEXITCODE = $LASTEXITCODE\n`)
    }
    const zip = new JSZip()
    for (const file of ['server.js', 'package.json', 'apps/desktop/dist/revamp/index.html', 'docs/knowledge/MCEM Overview.pdf', 'node_modules/zod/package.json']) zip.file(file, '{}')
    await writeFile(artifact, await zip.generateAsync({ type: 'nodebuffer' }))
    const state = async (): Promise<MockState> => JSON.parse(await readFile(statePath, 'utf8'))
    return {
        receipt, state, directory,
        update: async (change: (value: MockState) => void) => { const value = await state(); change(value); await writeFile(statePath, JSON.stringify(value)) },
        run: (action = 'Deploy', extra: string[] = [], withSlot = true, foundryEnvironmentPath = join(directory, 'does-not-exist.json'), useDefaults = false) => execute('pwsh', [
            '-NoProfile', '-File', script, ...(useDefaults ? [] : ['-Mode', 'sample']), '-Action', action,
            '-SubscriptionId', subscription, '-TenantId', tenant, '-ResourceGroup', 'test-rg',
            '-WebAppName', 'test-app', '-AppServicePlan', 'test-plan', '-ExpectedHostName', 'demo.example.test',
            '-ReceiptPath', receipt, '-FoundryEnvironmentPath', foundryEnvironmentPath,
            '-HealthAttempts', '1', '-HealthDelaySeconds', '1', '-Confirm:$false',
            ...(withSlot ? ['-Slot', 'sample'] : []),
            ...(action === 'Deploy' ? ['-SkipBuild'] : []),
            ...(['Deploy', 'Verify'].includes(action) ? ['-ArtifactPath', artifact] : []), ...extra
        ], { env: {
            ...process.env, PATH: [directory, process.env.PATH ?? ''].join(delimiter),
            AZURE_CONFIG_DIR: join(directory, 'isolated-azure'), AZURE_CORE_COLLECT_TELEMETRY: '0',
            TLC_APP_SERVICE_TEST_STATE: statePath
        }, maxBuffer: 2 * 1024 * 1024 })
    }
}
