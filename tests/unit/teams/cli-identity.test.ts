import { generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CliIdentityProvider } from '../../../apps/teams/src/cli-identity.js'
import { isCliConfiguration, loadTeamsConfiguration } from '../../../apps/teams/src/configuration.js'
import { requireRole } from '../../../packages/orchestrator/collaboration/principal.js'
import { LocalPairingAuthority } from '../../../apps/teams/src/local-pairing.js'

const tenantId = '77777777-7777-4777-8777-777777777777'
const userId = '99999999-9999-4999-8999-999999999999'
const configuration = loadTeamsConfiguration({
  TLC_TEAMS_MODE: 'live', TLC_TEAMS_AUTH_MODE: 'local-azure-cli', TLC_TEAMS_ORIGIN: 'https://localhost:3978',
  TLC_TEAMS_TENANT_ID: tenantId, TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com', TLC_TEAMS_ENVIRONMENT_ID: 'cli'
})
let keys: Awaited<ReturnType<typeof generateKeyPair>>
beforeAll(async () => { keys = await generateKeyPair('RS256') })
afterEach(() => { vi.useRealTimers() })
async function result(changes: Record<string, unknown> = {}, issuer = `https://sts.windows.net/${tenantId}/`, audience = 'https://example.crm.dynamics.com') {
  const token = await new SignJWT({ tid: tenantId, oid: userId, ver: '1.0', scp: 'user_impersonation', upn: 'cli-user@example.test', ...changes })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setAudience(audience).setExpirationTime(typeof changes['exp'] === 'number' ? changes['exp'] : '5m').sign(keys.privateKey)
  return { token, expiresOnTimestamp: Date.now() + 300_000 }
}
async function fixture(changes: Record<string, unknown> = {}, issuer?: string, audience?: string, writeMode: 'read-only' | 'reviewed' = 'read-only') {
  if (!isCliConfiguration(configuration)) throw new Error('Invalid CLI fixture.')
  const credential = { getToken: vi.fn(async () => result(changes, issuer, audience)) }
  const probe = vi.fn(async () => undefined)
  const provider = new CliIdentityProvider({ ...configuration, writeMode }, credential, { resolveKey: () => keys.publicKey, probeMsxIdentity: probe })
  return { provider, credential, probe }
}

describe('explicit signed-in CLI source identity', () => {
  it('coalesces concurrent credential acquisition only, rechecks the next dispatch and rejects old-owner results', async () => {
    const { provider, credential } = await fixture()
    await provider.connect('msx')
    const signed = await result()
    let release: (value: typeof signed) => void = () => {}
    const pending = new Promise<typeof signed>((resolve) => { release = resolve })
    credential.getToken.mockClear()
    credential.getToken.mockImplementationOnce(() => pending)
    const first = provider.getToken('msx')
    const second = provider.getToken('msx')
    expect(credential.getToken).toHaveBeenCalledOnce()
    release(signed)
    expect(await Promise.all([first, second])).toEqual([signed.token, signed.token])
    await provider.getToken('msx')
    expect(credential.getToken).toHaveBeenCalledTimes(2)
    credential.getToken.mockImplementationOnce(() => pending)
    const oldOwner = provider.getToken('msx')
    await provider.disconnect()
    await expect(oldOwner).rejects.toMatchObject({ code: 'native_connection_changed' })
    expect(provider.identity()).toBeUndefined()
  })
  it('renews an expired delegated token for the same explicitly connected owner without changing its generation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { provider, probe } = await fixture()
    await provider.connect('msx')
    const generation = provider.generation
    vi.setSystemTime(Date.now() + 6 * 60_000)
    expect(provider.identity()).toBeUndefined()
    await provider.getToken('msx', true)
    expect(provider.identity()?.principal.userId).toBe(userId)
    expect(provider.generation).toBe(generation)
    expect(probe).toHaveBeenCalledTimes(2)
    await provider.disconnect()
    await expect(provider.getToken('msx', true)).rejects.toMatchObject({ code: 'native_sign_in_required' })
  })
  it('does not obtain tokens, query MSX or initiate a login before the owner connects', async () => {
    const { provider, credential, probe } = await fixture()
    expect(provider.identity()).toBeUndefined()
    await expect(provider.getToken('msx')).rejects.toMatchObject({ code: 'native_sign_in_required' })
    expect(credential.getToken).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
  })
  it('verifies delegated token identity and own source mapping without inventing FTE/writer roles', async () => {
    const { provider, credential, probe } = await fixture()
    await provider.connect('msx')
    const identity = provider.identity()
    expect(identity?.principal).toMatchObject({ userId, tenantId, mode: 'live', roles: [], localSourceAccess: 'read-only' })
    expect(probe).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId, tenantId }))
    expect(credential.getToken).toHaveBeenCalledWith('https://example.crm.dynamics.com/.default')
    expect(provider.status()).toMatchObject({ state: 'connected', account: 'cli-user@example.test' })
    expect(JSON.stringify(provider.status())).not.toContain((await result()).token)
    if (!identity) throw new Error('No verified identity.')
    expect(() => requireRole(identity.principal, 'TLC.Teams.User')).not.toThrow()
    for (const role of ['TLC.Teams.Writer', 'TLC.Teams.Publisher', 'TLC.Teams.ContextAdmin']) {
      expect(() => requireRole(identity.principal, role)).toThrow()
    }
    const unmarked = { ...identity.principal }
    delete unmarked.localSourceAccess
    expect(() => requireRole(unmarked, 'TLC.Teams.User')).toThrow()
    const nativePairing = new LocalPairingAuthority(configuration.origin, () => identity)
    expect(() => nativePairing.reviewGeneration()).toThrow()
    expect(() => new LocalPairingAuthority(configuration.origin, () => identity, { allowLocalSource: true }).reviewGeneration()).not.toThrow()
  })
  it('enables reviewed source writes only through the explicit owner configuration, never token role claims', async () => {
    const { provider, credential, probe } = await fixture({ roles: ['TLC.Teams.Publisher', 'TLC.Teams.Writer'] }, undefined, undefined, 'reviewed')
    expect(provider.status().capabilities.find((entry) => entry.id === 'reviewed-writes')?.state).toBe('requires-source-grant')
    expect(credential.getToken).not.toHaveBeenCalled()
    await provider.connect('msx')
    const identity = provider.identity()
    if (!identity) throw new Error('No verified CLI identity.')
    expect(probe).toHaveBeenCalledOnce()
    expect(identity.principal).toMatchObject({ roles: [], localSourceAccess: 'reviewed' })
    expect(() => requireRole(identity.principal, 'TLC.Teams.Writer')).not.toThrow()
    expect(() => requireRole(identity.principal, 'TLC.Teams.Publisher')).toThrow()
    expect(() => requireRole(identity.principal, 'TLC.Teams.ContextAdmin')).toThrow()
    expect(provider.status().capabilities.find((entry) => entry.id === 'reviewed-writes')?.state).toBe('available')
    const pairing = new LocalPairingAuthority(configuration.origin, () => identity, { allowLocalSource: true })
    expect(() => pairing.reviewGeneration()).not.toThrow()
    await provider.disconnect()
    expect(provider.status().capabilities.find((entry) => entry.id === 'reviewed-writes')?.state).toBe('requires-source-grant')
  })
  it.each([
    { tid: '66666666-6666-4666-8666-666666666666' }, { oid: 'not-a-guid' },
    { idtyp: 'app' }, { scp: '' }, { scp: 'not_the_msx_delegated_scope' }, { exp: 1 }
  ])('rejects invalid or non-delegated source authority before source access: %j', async (changes) => {
    const { provider, probe } = await fixture(changes)
    await expect(provider.connect('msx')).rejects.toMatchObject({ code: 'native_identity_rejected' })
    expect(provider.identity()).toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
  })
  it.each([
    ['https://untrusted.example.test', 'https://example.crm.dynamics.com'],
    [`https://sts.windows.net/${tenantId}/`, 'https://graph.microsoft.com']
  ])('rejects a wrong issuer/audience before mapping (%s)', async (issuer, audience) => {
    const { provider, probe } = await fixture({}, issuer, audience)
    await expect(provider.connect('msx')).rejects.toMatchObject({ code: 'native_identity_rejected' })
    expect(probe).not.toHaveBeenCalled()
  })
  it('accepts tenant-pinned v2 and canonical Dataverse audience tokens', async () => {
    const { provider } = await fixture({ ver: '2.0' }, `https://login.microsoftonline.com/${tenantId}/v2.0`, '00000007-0000-0000-c000-000000000000')
    await provider.connect('msx')
    expect(provider.identity()?.principal.userId).toBe(userId)
  })
  it('fails closed on absent/disabled/mismatched source user mapping', async () => {
    const { provider, probe } = await fixture()
    probe.mockRejectedValueOnce(new Error('private mapping details'))
    await expect(provider.connect('msx')).rejects.toMatchObject({ code: 'native_source_denied' })
    expect(provider.identity()).toBeUndefined()
    expect(JSON.stringify(provider.status())).not.toContain('private mapping')
  })
  it('rechecks the current CLI subject on every dispatch and revokes old page authority on account change', async () => {
    const { provider, credential } = await fixture()
    await provider.connect('msx')
    const generation = provider.generation
    await provider.getToken('msx')
    credential.getToken.mockResolvedValueOnce(await result({ oid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))
    await expect(provider.getToken('msx')).rejects.toMatchObject({ code: 'native_connection_changed' })
    expect(provider.identity()).toBeUndefined()
    expect(provider.generation).toBeGreaterThan(generation)
  })
  it('requires explicit owner MCP connection and never enables Graph or logs out the CLI user', async () => {
    const { provider, credential } = await fixture()
    await expect(provider.connect('mcp')).rejects.toMatchObject({ code: 'native_sign_in_required' })
    expect(credential.getToken).not.toHaveBeenCalled()
    await provider.connect('msx')
    await expect(provider.getToken('mcp')).rejects.toMatchObject({ code: 'native_resource_unavailable' })
    await expect(provider.getToken('graph')).rejects.toMatchObject({ code: 'native_resource_unavailable' })
    await expect(provider.connect('graph')).rejects.toMatchObject({ code: 'native_resource_unavailable' })
    expect(credential.getToken).toHaveBeenCalledTimes(1)
    await provider.disconnect()
    expect(provider.identity()).toBeUndefined()
    expect(provider.status().state).toBe('sign-in-required')
  })
  it('connects MCP only for the same verified owner without resetting pairing or adding FTE roles', async () => {
    const { provider, credential, probe } = await fixture()
    await provider.connect('msx')
    const generation = provider.generation
    await provider.connect('mcp')
    expect(provider.generation).toBe(generation)
    expect(probe).toHaveBeenCalledOnce()
    expect(provider.status().resources.find((entry) => entry.resource === 'mcp')?.state).toBe('connected')
    expect(provider.status().capabilities.find((entry) => entry.id === 'mcp')?.state).toBe('available')
    expect(provider.identity()?.principal).toMatchObject({ userId, roles: [], localSourceAccess: 'read-only' })
    await expect(provider.getToken('mcp')).resolves.toBeTypeOf('string')
    expect(credential.getToken).toHaveBeenCalledTimes(3)
    expect(credential.getToken).toHaveBeenLastCalledWith('https://example.crm.dynamics.com/.default')
    await provider.disconnect()
    expect(provider.status().resources.find((entry) => entry.resource === 'mcp')?.state).toBe('not-connected')
  })
  it('retains MSX and pairing when optional MCP permission acquisition fails', async () => {
    const { provider, credential } = await fixture()
    await provider.connect('msx')
    const generation = provider.generation
    credential.getToken.mockRejectedValueOnce(new Error('private consent details must not be exposed'))
    await expect(provider.connect('mcp')).rejects.toMatchObject({ code: 'native_source_denied' })
    expect(provider.generation).toBe(generation)
    expect(provider.identity()?.principal.userId).toBe(userId)
    expect(provider.status().resources.find((entry) => entry.resource === 'mcp')?.state).toBe('denied')
    expect(JSON.stringify(provider.status())).not.toContain('private consent')
    await expect(provider.getToken('msx')).resolves.toBeTypeOf('string')
  })
  it('revokes old authority if the CLI subject changes during optional MCP connection', async () => {
    const { provider, credential } = await fixture()
    await provider.connect('msx')
    const generation = provider.generation
    credential.getToken.mockResolvedValueOnce(await result({ oid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))
    await expect(provider.connect('mcp')).rejects.toMatchObject({ code: 'native_connection_changed' })
    expect(provider.identity()).toBeUndefined()
    expect(provider.generation).toBeGreaterThan(generation)
    await expect(provider.getToken('mcp')).rejects.toMatchObject({ code: 'native_sign_in_required' })
  })
  it('discards a late optional MCP result after owner disconnect', async () => {
    const { provider, credential } = await fixture()
    await provider.connect('msx')
    let complete: ((value: Awaited<ReturnType<typeof result>>) => void) | undefined
    const pending = new Promise<Awaited<ReturnType<typeof result>>>((resolve) => { complete = resolve })
    credential.getToken.mockImplementationOnce(() => pending)
    const connecting = provider.connect('mcp')
    await provider.disconnect()
    complete?.(await result())
    await expect(connecting).rejects.toMatchObject({ code: 'native_connection_changed' })
    expect(provider.identity()).toBeUndefined()
    expect(provider.status().resources.find((entry) => entry.resource === 'mcp')?.state).toBe('not-connected')
  })
  it('rejects an unrelated MCP token audience and invalidates the affected owner authority', async () => {
    const { provider, credential } = await fixture()
    await provider.connect('msx')
    credential.getToken.mockResolvedValueOnce(await result({}, undefined, 'https://graph.microsoft.com'))
    await expect(provider.connect('mcp')).rejects.toMatchObject({ code: 'native_identity_rejected' })
    expect(provider.identity()).toBeUndefined()
    expect(provider.status().resources.find((entry) => entry.resource === 'mcp')?.state).toBe('not-connected')
  })
})
