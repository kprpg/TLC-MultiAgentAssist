import { beforeAll, describe, expect, it, vi } from 'vitest'
import { generateKeyPair, SignJWT } from 'jose'
import { loadTeamsConfiguration } from '../../../apps/teams/src/configuration.js'
import { createTeamsAuthenticator, createDelegatedTokenProvider } from '../../../apps/teams/src/authentication.js'

const tenant = '11111111-1111-4111-8111-111111111111'
const api = '22222222-2222-4222-8222-222222222222'
const spa = '33333333-3333-4333-8333-333333333333'
const bot = '44444444-4444-4444-8444-444444444444'
const user = '55555555-5555-4555-8555-555555555555'
const environment = {
  TLC_TEAMS_MODE: 'live',
  TLC_TEAMS_ORIGIN: 'https://tlc.example.com',
  TLC_TEAMS_TENANT_ID: tenant,
  TLC_TEAMS_API_CLIENT_ID: api,
  TLC_TEAMS_SPA_CLIENT_ID: spa,
  TLC_TEAMS_BOT_CLIENT_ID: bot,
  TLC_TEAMS_API_CREDENTIAL: 'test-credential-not-for-production',
  TLC_TEAMS_BOT_CREDENTIAL: 'test-bot-credential-not-for-production',
  TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com',
  TLC_TEAMS_MCP_SCOPE: 'https://example.crm.dynamics.com/mcp.tools',
  TLC_TEAMS_STORAGE_URL: 'https://examplestorage.table.core.windows.net',
  TLC_TEAMS_ENVIRONMENT_ID: 'test-environment'
}
let keys: Awaited<ReturnType<typeof generateKeyPair>>
beforeAll(async () => { keys = await generateKeyPair('RS256') })

async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    tid: tenant, oid: user, azp: spa, scp: 'access_as_user', roles: ['TLC.Teams.User'], ver: '2.0',
    ...overrides
  }).setProtectedHeader({ alg: 'RS256' })
    .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
    .setAudience(api).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)
}

describe('Teams configuration admission', () => {
  it('keeps sample local and never silently selects sample in a hosted environment', () => {
    expect(loadTeamsConfiguration({}).mode).toBe('sample')
    expect(() => loadTeamsConfiguration({ WEBSITE_SITE_NAME: 'hosted' })).toThrow(/mode/i)
    expect(() => loadTeamsConfiguration({ TLC_TEAMS_MODE: 'typo' })).toThrow()
  })
  it('requires the complete live identity and persistent-store configuration', () => {
    expect(() => loadTeamsConfiguration({ TLC_TEAMS_MODE: 'live' })).toThrow()
    expect(loadTeamsConfiguration(environment).mode).toBe('live')
    expect(() => loadTeamsConfiguration({ ...environment, TLC_TEAMS_MCP_SCOPE: '' })).toThrow()
    expect(() => loadTeamsConfiguration({ ...environment, TLC_TEAMS_ORIGIN: 'http://public.example.com' })).toThrow()
    expect(() => loadTeamsConfiguration({ ...environment, TLC_TEAMS_TENANT_ID: 'common' })).toThrow()
    expect(() => loadTeamsConfiguration({ ...environment, TLC_TEAMS_MSX_RESOURCE: 'https://evil.example.com' })).toThrow()
    expect(() => loadTeamsConfiguration({ ...environment, TLC_TEAMS_MCP_SCOPE: 'https://evil.example.com/mcp.tools' })).toThrow()
  })
})

describe('Teams delegated token validation', () => {
  const configuration = loadTeamsConfiguration(environment)
  const authenticate = createTeamsAuthenticator(configuration, () => keys.publicKey)
  it('verifies a signed API token and derives identity only from its claims', async () => {
    const principal = await authenticate(await token())
    expect(principal).toMatchObject({ tenantId: tenant, userId: user, roles: ['TLC.Teams.User'] })
    expect(principal.key).toBe(`${tenant}:${user}`)
    expect(JSON.stringify(principal)).not.toContain('test-credential')
  })
  it.each([
    { tid: '66666666-6666-4666-8666-666666666666' },
    { aud: 'https://graph.microsoft.com' },
    { iss: 'https://evil.example.com' },
    { azp: api },
    { scp: '' },
    { scp: 'User.Read' },
    { roles: [] },
    { roles: ['TLC.Teams.Writer'] },
    { oid: '' },
    { ver: '1.0' },
    { idtyp: 'app' },
    { exp: 1 }
  ])('rejects an inadmissible identity without exposing the token: %j', async (changes) => {
    const signed = new SignJWT({
      tid: tenant, oid: user, azp: spa, scp: 'access_as_user', roles: ['TLC.Teams.User'], ver: '2.0',
      iss: `https://login.microsoftonline.com/${tenant}/v2.0`, aud: api,
      exp: Math.floor(Date.now() / 1000) + 300, ...changes
    }).setProtectedHeader({ alg: 'RS256' })
    await expect(authenticate(await signed.sign(keys.privateKey))).rejects.toThrow(/authorization|eligible/i)
  })
  it('does not accept unsigned, malformed, or differently signed tokens', async () => {
    for (const invalid of ['', 'not-a-jwt', 'eyJhbGciOiJub25lIn0.e30.']) {
      await expect(authenticate(invalid)).rejects.toThrow(/authorization/i)
    }
    const other = await generateKeyPair('RS256')
    const invalid = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).sign(other.privateKey)
    await expect(authenticate(invalid)).rejects.toThrow(/authorization/i)
  })
  it('does not equate a corporate email with FTE entitlement', async () => {
    await expect(authenticate(await token({ roles: [], preferred_username: 'fte@microsoft.com' }))).rejects.toThrow()
  })
})

describe('resource-specific OBO', () => {
  it('uses only configured resources and never returns or reuses the inbound API token', async () => {
    const acquire = vi.fn().mockResolvedValue({ accessToken: 'downstream-only', expiresOn: new Date(Date.now() + 300_000) })
    const provider = createDelegatedTokenProvider(loadTeamsConfiguration(environment), 'api-user-assertion', acquire)
    expect(await provider.getToken('mcp')).toBe('downstream-only')
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      oboAssertion: 'api-user-assertion', scopes: [environment.TLC_TEAMS_MCP_SCOPE]
    }))
    await provider.getToken('graph')
    expect(acquire).toHaveBeenLastCalledWith(expect.objectContaining({ scopes: ['https://graph.microsoft.com/.default'] }))
    await provider.getToken('msx')
    expect(acquire).toHaveBeenLastCalledWith(expect.objectContaining({ scopes: ['https://example.crm.dynamics.com/.default'] }))
  })
  it('fails explicitly when consent/acquisition is unavailable', async () => {
    const acquire = vi.fn().mockResolvedValue(null)
    const provider = createDelegatedTokenProvider(loadTeamsConfiguration(environment), 'assertion', acquire)
    await expect(provider.getToken('msx')).rejects.toThrow(/authorization/i)
  })
  it('never refreshes source access from an expired API assertion in background work', async () => {
    const acquire = vi.fn().mockResolvedValue({ accessToken: 'unexpected-token' })
    const provider = createDelegatedTokenProvider(loadTeamsConfiguration(environment), 'expired-assertion', acquire, Date.now() - 1)
    await expect(provider.getToken('graph')).rejects.toThrow(/authorization/i)
    expect(acquire).not.toHaveBeenCalled()
  })
  it('propagates only a bounded structured claims challenge, never raw provider error text', async () => {
    const claims = '{"access_token":{"acrs":{"essential":true,"value":"cp1"}}}'
    const provider = createDelegatedTokenProvider(loadTeamsConfiguration(environment), 'assertion', async () => {
      throw { errorCode: 'interaction_required', claims, errorMessage: 'sensitive-provider-context' }
    })
    await expect(provider.getToken('graph')).rejects.toMatchObject({ code: 'authorization_required', claims })
    await expect(provider.getToken('graph')).rejects.not.toThrow(/sensitive-provider-context/)
  })
})
