import { generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AccountInfo } from '@azure/msal-node'
import { loadTeamsConfiguration, isNativeConfiguration } from '../../../apps/teams/src/configuration.js'
import { NativeIdentityProvider, type NativeAuthenticationResult } from '../../../apps/teams/src/native-identity.js'

const tenantId = '77777777-7777-4777-8777-777777777777'
const clientId = '88888888-8888-4888-8888-888888888888'
const userId = '99999999-9999-4999-8999-999999999999'
const account: AccountInfo = { homeAccountId: 'home-account', localAccountId: userId, tenantId, environment: 'login.microsoftonline.com', username: 'native-user@example.test' }
const config = loadTeamsConfiguration({
  TLC_TEAMS_MODE: 'live', TLC_TEAMS_AUTH_MODE: 'local-interactive', TLC_TEAMS_ORIGIN: 'https://localhost:3978',
  TLC_TEAMS_TENANT_ID: tenantId, TLC_TEAMS_NATIVE_CLIENT_ID: clientId,
  TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com', TLC_TEAMS_ENVIRONMENT_ID: 'native'
})
let keys: Awaited<ReturnType<typeof generateKeyPair>>
beforeAll(async () => { keys = await generateKeyPair('RS256') })
afterEach(() => { vi.useRealTimers() })
async function result(changes: Record<string, unknown> = {}): Promise<NativeAuthenticationResult> {
  const idToken = await new SignJWT({ tid: tenantId, oid: userId, ver: '2.0', roles: ['TLC.Teams.User', 'TLC.Teams.Writer'], ...changes })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(clientId).setExpirationTime('5m').sign(keys.privateKey)
  return { accessToken: 'downstream-private', idToken, account, expiresOn: new Date(Date.now() + 300_000) }
}
function fixture(response: NativeAuthenticationResult, probe = vi.fn(async () => undefined)) {
  if (!isNativeConfiguration(config)) throw new Error('Invalid native fixture.')
  const client = { interactive: vi.fn(async () => response), silent: vi.fn(async () => response), clear: vi.fn(async () => undefined) }
  const provider = new NativeIdentityProvider(config, client, { resolveKey: () => keys.publicKey, probeMsxIdentity: probe })
  return { provider, client, probe }
}
describe('native identity and resource tokens', () => {
  it('uses silent forced refresh for an expired owner token and rechecks source mapping without interactive sign-in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { provider, client, probe } = fixture(await result())
    await provider.connect('msx')
    const generation = provider.generation
    vi.setSystemTime(Date.now() + 6 * 60_000)
    expect(provider.identity()).toBeUndefined()
    client.silent.mockResolvedValueOnce(await result())
    await provider.getToken('msx', true)
    expect(client.silent).toHaveBeenCalledWith(['https://example.crm.dynamics.com/.default'], account, true)
    expect(client.interactive).toHaveBeenCalledOnce()
    expect(provider.generation).toBe(generation)
    expect(probe).toHaveBeenCalledTimes(2)
  })
  it('never prompts from a source HTTP read before explicit owner connection', async () => {
    const { provider, client } = fixture(await result())
    await expect(provider.getToken('msx')).rejects.toMatchObject({ code: 'native_sign_in_required' })
    expect(client.interactive).not.toHaveBeenCalled()
    expect(client.silent).not.toHaveBeenCalled()
  })
  it('verifies the actual native identity and source mapping before admitting it', async () => {
    const { provider, client, probe } = fixture(await result())
    await provider.connect('msx')
    expect(provider.identity()?.principal).toMatchObject({ tenantId, userId, mode: 'live', roles: ['TLC.Teams.User', 'TLC.Teams.Writer'] })
    expect(probe).toHaveBeenCalledWith('downstream-private', expect.objectContaining({ userId, tenantId }))
    expect(await provider.getToken('msx')).toBe('downstream-private')
    expect(client.interactive).toHaveBeenCalledWith(['https://example.crm.dynamics.com/.default'])
    expect(JSON.stringify(provider.status())).not.toContain('downstream-private')
  })
  it.each([{ roles: [] }, { oid: 'different-user' }, { tid: '66666666-6666-4666-8666-666666666666' }, { idtyp: 'app' }])('does not trust browser/email/incorrect subject authority: %j', async (changes) => {
    const { provider, probe } = fixture(await result(changes))
    await expect(provider.connect('msx')).rejects.toMatchObject({ code: 'native_identity_rejected' })
    expect(provider.identity()).toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
  })
  it('does not claim MSX readiness when WhoAmI mapping fails', async () => {
    const { provider } = fixture(await result(), vi.fn(async () => { throw new Error('Wrong source mapping') }))
    await expect(provider.connect('msx')).rejects.toMatchObject({ code: 'native_source_denied' })
    expect(provider.identity()).toBeUndefined()
    expect(provider.status().state).toBe('blocked')
  })
  it('keeps optional resource grants separate and never substitutes another provider', async () => {
    const { provider, client } = fixture(await result())
    await provider.connect('msx')
    await expect(provider.getToken('graph')).rejects.toMatchObject({ code: 'native_resource_unavailable' })
    expect(client.interactive).toHaveBeenCalledTimes(1)
    client.silent.mockRejectedValueOnce({ errorCode: 'consent_required', errorMessage: 'private-data-must-not-log' })
    await expect(provider.getToken('mcp')).rejects.toMatchObject({ code: 'native_consent_required' })
    expect(client.interactive).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(provider.status())).not.toContain('private-data-must-not-log')
    expect(provider.identity()).toBeDefined()
  })
  it('invalidates identity and cached source tokens on disconnect', async () => {
    const { provider, client } = fixture(await result())
    await provider.connect('msx')
    const generation = provider.generation
    await provider.disconnect()
    expect(provider.generation).toBeGreaterThan(generation)
    await expect(provider.getToken('msx')).rejects.toMatchObject({ code: 'native_sign_in_required' })
    expect(client.clear).toHaveBeenCalled()
  })
  it('invalidates old writer authority when a newly verified resource response has different roles', async () => {
    const { provider, client } = fixture(await result())
    await provider.connect('msx')
    const generation = provider.generation
    client.silent.mockResolvedValueOnce(await result({ roles: ['TLC.Teams.User'] }))
    await expect(provider.getToken('mcp')).rejects.toMatchObject({ code: 'native_connection_changed' })
    expect(provider.identity()).toBeUndefined()
    expect(provider.generation).toBeGreaterThan(generation)
  })
  it('keeps exact resource scopes and cached tokens separate', async () => {
    const { provider, client } = fixture(await result())
    await provider.connect('msx')
    client.silent.mockResolvedValueOnce({ ...await result(), accessToken: 'mcp-private-token' })
    expect(await provider.getToken('mcp')).toBe('mcp-private-token')
    expect(client.silent).toHaveBeenCalledWith(['https://example.crm.dynamics.com/mcp.tools'], account)
    expect(await provider.getToken('msx')).toBe('downstream-private')
  })
  it.each(['audience', 'issuer', 'expired'])('rejects an invalid native ID-token %s before any source probe', async (kind) => {
    const response = await result()
    response.idToken = await new SignJWT({ tid: tenantId, oid: userId, ver: '2.0', roles: ['TLC.Teams.User'] })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(kind === 'issuer' ? 'https://untrusted.example.test' : `https://login.microsoftonline.com/${tenantId}/v2.0`)
      .setAudience(kind === 'audience' ? 'different-native-client' : clientId)
      .setExpirationTime(kind === 'expired' ? Math.floor(Date.now() / 1000) - 60 : '5m').sign(keys.privateKey)
    const { provider, probe } = fixture(response)
    await expect(provider.connect('msx')).rejects.toMatchObject({ code: 'native_identity_rejected' })
    expect(probe).not.toHaveBeenCalled()
  })
  it('rejects invalid resource expiration metadata instead of probing or claiming connection success', async () => {
    const { provider, probe } = fixture({ ...await result(), expiresOn: new Date(Number.NaN) })
    await expect(provider.connect('msx')).rejects.toMatchObject({ code: 'native_identity_rejected' })
    expect(probe).not.toHaveBeenCalled()
  })
})
