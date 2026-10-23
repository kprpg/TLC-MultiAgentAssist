import { afterEach, describe, expect, it, vi } from 'vitest'
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadTeamsConfiguration, loadTeamsRuntimeConfiguration } from '../../../apps/teams/src/configuration.js'
import { createTeamsStateStore, createTeamsWorkloadCredential, requiresTeamsFoundryCredential } from '../../../apps/teams/src/runtime-resources.js'
import { startTeamsServer } from '../../../apps/teams/src/server.js'

const tenant = '11111111-1111-4111-8111-111111111111'
const liveEnvironment: NodeJS.ProcessEnv = {
  TLC_TEAMS_MODE: 'live', TLC_TEAMS_ORIGIN: 'https://tlc.example.com',
  TLC_TEAMS_TENANT_ID: tenant,
  TLC_TEAMS_API_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  TLC_TEAMS_SPA_CLIENT_ID: '33333333-3333-4333-8333-333333333333',
  TLC_TEAMS_BOT_CLIENT_ID: '44444444-4444-4444-8444-444444444444',
  TLC_TEAMS_API_CREDENTIAL: 'test-api-credential', TLC_TEAMS_BOT_CREDENTIAL: 'test-bot-credential',
  TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com',
  TLC_TEAMS_MCP_SCOPE: 'https://example.crm.dynamics.com/mcp.tools',
  TLC_TEAMS_ENVIRONMENT_ID: 'test',
  TLC_TEAMS_STATE_KEY: Buffer.alloc(32, 7).toString('base64')
}
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() } finally { vi.restoreAllMocks() } })
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'tlc-teams-local-host-'))
  cleanups.push(() => rm(path, { recursive: true, force: true }))
  return path
}

describe('one Teams runtime, local now and Azure later', () => {
  it('starts live local configuration with synthetic registrations, no external calls, and unsigned-user denial', async () => {
    const root = await directory()
    const policyPath = join(root, 'test-disclosure-policy.json')
    await writeFile(policyPath, JSON.stringify({ contractVersion: '1.0', revision: 'test-deny-all', expiresAt: '2000-01-01T00:00:00.000Z', contexts: [] }))
    const foundry = {
      schemaVersion: 1, environment: 'test',
      authentication: {
        mode: 'azure-cli', expectedUserDomain: '@microsoft.com',
        foundryTenantId: '77777777-7777-4777-8777-777777777777',
        scopes: { foundry: ['https://ai.azure.com/.default'], msx: ['https://example.crm.dynamics.com/.default'], graph: ['https://graph.microsoft.com/.default'] }
      },
      foundry: {
        projectEndpoint: 'https://synthetic-test.services.ai.azure.com/api/projects/test', requestTimeoutMs: 30_000,
        agents: Object.fromEntries(['accountPulse', 'mcemCoach', 'pursuitExecutive', 'riskSolutionPlay'].map((name) => [
          name, { name: `test-${name}`, type: 'prompt', protocol: 'responses' }
        ]))
      }
    }
    const originalFetch = globalThis.fetch
    const outbound = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.hostname !== '127.0.0.1') throw new Error('No external resource request is permitted in this startup test.')
      return originalFetch(input, init)
    })
    const application = await startTeamsServer({
      ...liveEnvironment, TLC_TEAMS_DATA_DIR: root, TLC_TEAMS_HOST: '127.0.0.1', TLC_TEAMS_PORT: '0',
      TLC_TEAMS_DISCLOSURE_POLICY: policyPath,
      TLC_FOUNDRY_ENV_BASE64: Buffer.from(JSON.stringify(foundry)).toString('base64')
    })
    cleanups.push(() => application.close())
    const address = application.server.address()
    if (!address || typeof address === 'string') throw new Error('Missing live local listener.')
    expect(address.address).toBe('127.0.0.1')
    expect(outbound).not.toHaveBeenCalled()
    const origin = `http://127.0.0.1:${address.port}`
    expect(await (await fetch(`${origin}/api/health`)).json()).toMatchObject({ surface: 'teams', mode: 'live' })
    expect((await fetch(`${origin}/api/teams/session`)).status).toBe(401)
    expect((await fetch(`${origin}/api/teams/operations/listAccounts`, {
      method: 'POST', headers: { origin: application.configuration.origin }, body: '{}'
    })).status).toBe(401)
    expect(outbound.mock.calls).toHaveLength(3)
  })
  it('restores a stopped encrypted database with its matching key without losing claims or leaking payloads', async () => {
    const root = await directory()
    const environment = { ...liveEnvironment, TLC_TEAMS_DATA_DIR: root }
    const configuration = loadTeamsConfiguration(environment)
    const runtime = loadTeamsRuntimeConfiguration(environment, configuration)
    const original = await createTeamsStateStore(configuration, runtime, environment)
    await original.store.insert('user-partition', 'action:opaque', { state: 'effect-unknown', privateNote: 'synthetic-private-note' })
    original.close()
    if (runtime.state.kind !== 'sqlite') throw new Error('Expected local SQLite.')
    const backupPath = join(root, 'stopped-backup.sqlite')
    await cp(runtime.state.path, backupPath)
    const restoredRuntime = loadTeamsRuntimeConfiguration({ ...environment, TLC_TEAMS_STATE_PATH: backupPath }, configuration)
    const restored = await createTeamsStateStore(configuration, restoredRuntime, environment)
    cleanups.push(() => restored.close())
    expect((await restored.store.read('user-partition', 'action:opaque'))?.value).toEqual({ state: 'effect-unknown', privateNote: 'synthetic-private-note' })
    expect((await readFile(backupPath)).includes(Buffer.from('synthetic-private-note'))).toBe(false)
  })
  it('uses local durable state without Table Storage or a managed identity on a laptop', async () => {
    const environment = { ...liveEnvironment, TLC_TEAMS_DATA_DIR: await directory() }
    const configuration = loadTeamsConfiguration(environment)
    const runtime = loadTeamsRuntimeConfiguration(environment, configuration)
    expect(runtime).toMatchObject({ profile: 'local', state: { kind: 'sqlite' } })
    expect(runtime.state).not.toHaveProperty('url')
    expect(createTeamsWorkloadCredential(runtime, tenant, environment)).toBeInstanceOf(AzureCliCredential)
    const resources = await createTeamsStateStore(configuration, runtime, environment)
    cleanups.push(() => resources.close())
    await resources.store.insert('tenant:env:user-a', 'review:opaque-id', { customer: 'sensitive-synthetic-fixture' })
    const reopened = await createTeamsStateStore(configuration, runtime, environment)
    cleanups.push(() => reopened.close())
    expect((await reopened.store.read('tenant:env:user-a', 'review:opaque-id'))?.value).toEqual({ customer: 'sensitive-synthetic-fixture' })
    expect(await reopened.store.read('tenant:env:user-b', 'review:opaque-id')).toBeUndefined()
    if (runtime.state.kind !== 'sqlite') throw new Error('Expected local SQLite.')
    expect((await readFile(runtime.state.path)).includes(Buffer.from('sensitive-synthetic-fixture'))).toBe(false)
  })
  it('retains an explicit Azure Table/managed-identity profile and fails if its store is unconfigured', () => {
    const environment = { ...liveEnvironment, TLC_TEAMS_RUNTIME_PROFILE: 'azure' }
    const configuration = loadTeamsConfiguration(environment)
    expect(() => loadTeamsRuntimeConfiguration(environment, configuration)).toThrow(/storage/i)
    const configured = { ...environment, TLC_TEAMS_STORAGE_URL: 'https://examplestorage.table.core.windows.net' }
    const runtime = loadTeamsRuntimeConfiguration(configured, loadTeamsConfiguration(configured))
    expect(runtime).toMatchObject({ profile: 'azure', state: { kind: 'table', url: configured.TLC_TEAMS_STORAGE_URL } })
    expect(createTeamsWorkloadCredential(runtime, tenant, configured)).toBeInstanceOf(ManagedIdentityCredential)
  })
  it('keeps state outside the runtime release folder and separates sample from live by default', async () => {
    const localAppData = await directory()
    const sample = loadTeamsRuntimeConfiguration({ LOCALAPPDATA: localAppData }, loadTeamsConfiguration({}))
    const live = loadTeamsRuntimeConfiguration({ ...liveEnvironment, LOCALAPPDATA: localAppData }, loadTeamsConfiguration(liveEnvironment))
    expect(sample.state.kind).toBe('sqlite')
    expect(live.state.kind).toBe('sqlite')
    if (sample.state.kind !== 'sqlite' || live.state.kind !== 'sqlite') throw new Error('Expected local state.')
    expect(sample.state.path).toContain(localAppData)
    expect(sample.state.path).not.toBe(live.state.path)
    expect(sample.state.path).not.toBe(sample.samplePath)
  })
  it('rejects non-durable live state, invalid profiles, missing encryption and wrong keys without exposing secrets', async () => {
    const environment = { ...liveEnvironment, TLC_TEAMS_DATA_DIR: await directory() }
    const configuration = loadTeamsConfiguration(environment)
    expect(() => loadTeamsRuntimeConfiguration({ ...environment, TLC_TEAMS_STATE_PATH: ':memory:' }, configuration)).toThrow(/durable/i)
    const samplePath = join(environment.TLC_TEAMS_DATA_DIR, 'sample.sqlite')
    expect(() => loadTeamsRuntimeConfiguration({
      ...environment, TLC_TEAMS_SAMPLE_PATH: samplePath, TLC_TEAMS_STATE_PATH: `${samplePath}.state.sqlite`
    }, configuration)).toThrow(/Live.*Sample.*distinct/i)
    if (process.platform === 'win32') {
      expect(() => loadTeamsRuntimeConfiguration({
        ...environment, TLC_TEAMS_SAMPLE_PATH: samplePath, TLC_TEAMS_STATE_PATH: `${samplePath.toUpperCase()}.state.sqlite`
      }, configuration)).toThrow(/Live.*Sample.*distinct/i)
    }
    expect(() => loadTeamsRuntimeConfiguration({ ...environment, TLC_TEAMS_RUNTIME_PROFILE: 'typo' }, configuration)).toThrow()
    const runtime = loadTeamsRuntimeConfiguration(environment, configuration)
    await expect(createTeamsStateStore(configuration, runtime, { ...environment, TLC_TEAMS_STATE_KEY: undefined })).rejects.toThrow(/key/i)
    const original = await createTeamsStateStore(configuration, runtime, environment)
    original.close()
    await expect(createTeamsStateStore(configuration, runtime, {
      ...environment, TLC_TEAMS_STATE_KEY: Buffer.alloc(32, 8).toString('base64')
    })).rejects.toThrow(/authenticate|key/i)
  })

  it('initializes the narrative credential for reporting in deterministic native and CLI modes', () => {
    expect(requiresTeamsFoundryCredential({}, false, false)).toBe(false)
    expect(requiresTeamsFoundryCredential({ TLC_SE_REPORTING_ENABLED: '1' }, false, false)).toBe(true)
    expect(requiresTeamsFoundryCredential({}, true, false)).toBe(true)
    expect(requiresTeamsFoundryCredential({}, false, true)).toBe(true)
  })
})
