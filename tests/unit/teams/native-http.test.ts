import { createHash, randomBytes } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTeamsHandler } from '../../../apps/teams/src/app.js'
import { LocalPairingAuthority } from '../../../apps/teams/src/local-pairing.js'
import { loadTeamsConfiguration } from '../../../apps/teams/src/configuration.js'
import { getCliCapabilities, cliPublicConfigurationVersion, localConnectionVersion, nativeCapabilities, type CliWriteMode } from '../../../packages/common/contracts/local-connection.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import type { NativeIdentity } from '../../../apps/teams/src/native-identity.js'
import { createLiveApplicationServices, type ApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { MemoryPortfolioPreferenceStore } from '../../../packages/connectors/common/portfolio-preferences.js'
import { actionPreviewSchema, collaborationVersion } from '../../../packages/common/contracts/collaboration.js'
import { TeamsLaunchMonitor } from '../../../apps/teams/src/launch-status.js'
import { teamsLaunchVersion } from '../../../packages/common/contracts/teams-launch.js'

const origin = 'https://localhost:3978'
const configuration = loadTeamsConfiguration({
  TLC_TEAMS_MODE: 'live', TLC_TEAMS_AUTH_MODE: 'local-interactive', TLC_TEAMS_ORIGIN: origin,
  TLC_TEAMS_TENANT_ID: '77777777-7777-4777-8777-777777777777', TLC_TEAMS_NATIVE_CLIENT_ID: '88888888-8888-4888-8888-888888888888',
  TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com', TLC_TEAMS_ENVIRONMENT_ID: 'native'
})
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture(services?: ApplicationServices, writeMode?: CliWriteMode) {
  const cli = writeMode !== undefined
  const identity: NativeIdentity = {
    account: 'private-owner@example.test', generation: 1,
    principal: { key: 'native', tenantId: '77777777-7777-4777-8777-777777777777', userId: '99999999-9999-4999-8999-999999999999', mode: 'live', environmentId: 'native', roles: cli ? [] : services ? ['TLC.Teams.User', 'TLC.Teams.Writer'] : ['TLC.Teams.User'], ...(cli ? { localSourceAccess: writeMode } : {}), expiresAt: Date.now() + 300_000 }
  }
  const pairing = new LocalPairingAuthority(origin, () => identity, { allowLocalSource: cli })
  const launch = new TeamsLaunchMonitor({
    contractVersion: teamsLaunchVersion, runId: '1'.repeat(32), clientBuildId: '22222222-2222-4222-8222-222222222222',
    packageId: '8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b', packageVersion: '1.2484.12345',
    origin, mode: 'live', authentication: cli ? 'local-azure-cli' : 'local-interactive'
  }, (code) => pairing.hasPage(code))
  const store = new SqliteDocumentStore()
  cleanup.push(() => store.close())
  const resolveServices = vi.fn(async () => {
    if (services) return services
    throw new Error('A native status/pairing route must not initialize source services.')
  })
  let changeBeforeResponse = false
  const refreshIdentity = vi.fn(async () => { identity.principal.expiresAt = Date.now() + 3600_000 })
  const handler = createTeamsHandler({
    configuration: cli ? loadTeamsConfiguration({
      TLC_TEAMS_MODE: 'live', TLC_TEAMS_AUTH_MODE: 'local-azure-cli', TLC_TEAMS_ORIGIN: origin,
      TLC_TEAMS_TENANT_ID: identity.principal.tenantId, TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com', TLC_TEAMS_ENVIRONMENT_ID: 'native', TLC_TEAMS_CLI_WRITE_MODE: writeMode
    }) : configuration, store, resolveServices,
    authority: { verify: async () => { throw new Error('Cross-device distribution not approved.') } },
    launch, localConnection: { pairing, refreshIdentity, status: () => {
      if (changeBeforeResponse) identity.generation++
      return {
      contractVersion: localConnectionVersion, state: 'connected', detail: 'Owner connected.',
      account: identity.account, resources: [], capabilities: cli ? getCliCapabilities(writeMode) : nativeCapabilities
      }
    } }
  })
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  cleanup.push(() => new Promise<void>((closed, reject) => server.close((error) => error ? reject(error) : closed())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No listener.')
  const send = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; text: string }>((done, fail) => {
    const request = httpRequest({
      hostname: '127.0.0.1', port: address.port, path, method: body === undefined ? 'GET' : 'POST',
      headers: { host: 'localhost:3978', origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }
    }, (response) => {
      let text = ''
      response.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
      response.on('end', () => done({ status: response.statusCode ?? 0, text }))
    })
    request.on('error', fail)
    request.end(body === undefined ? undefined : JSON.stringify(body))
  })
  return { pairing, send, resolveServices, refreshIdentity, changeBeforeResponse: () => { changeBeforeResponse = true }, changeGeneration: () => { identity.generation++ } }
}
describe('native HTTP admission without any real source access', () => {
  it('requires explicit MCP connection before costly workflow source reads without discarding the paired MSX session', async () => {
    const { pairing, send, resolveServices } = await fixture(undefined, 'reviewed')
    const verifier = randomBytes(32).toString('base64url')
    const pending = pairing.begin({ contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') }, origin)
    pairing.approve(pending.userCode)
    const paired = pairing.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier }, origin)
    if (paired.state !== 'paired') throw new Error('Fixture pairing failed.')
    const headers = { authorization: `Bearer ${paired.token}` }
    const response = await send('/api/teams/operations/workflows.start', { contractVersion: '1.0', workflowId: 'WF-001', scope: { kind: 'portfolio' } }, headers)
    expect(response.status).toBe(409)
    expect(JSON.parse(response.text)).toMatchObject({ error: 'mcp_connection_required' })
    expect((await send('/api/teams/session', undefined, headers)).status).toBe(200)
    expect(resolveServices).not.toHaveBeenCalled()
  })

  it('keeps manual transcript extraction readable but rejects meeting-change review in a read-only CLI profile before source initialization', async () => {
    const { pairing, send, resolveServices } = await fixture(undefined, 'read-only')
    const verifier = randomBytes(32).toString('base64url')
    const pending = pairing.begin({ contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') }, origin)
    pairing.approve(pending.userCode)
    const paired = pairing.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier }, origin)
    if (paired.state !== 'paired') throw new Error('Fixture pairing failed.')
    const response = await send('/api/teams/meetings/preview-changes', {}, { authorization: `Bearer ${paired.token}` })
    expect(response.status).toBe(403)
    expect(JSON.parse(response.text)).toMatchObject({ error: 'local_read_only' })
    expect(resolveServices).not.toHaveBeenCalled()
  })

  it('reports unsupported Graph lookup in a CLI profile before initializing source services and retains the paired MSX session', async () => {
    const { pairing, send, resolveServices } = await fixture(undefined, 'reviewed')
    const verifier = randomBytes(32).toString('base64url')
    const pending = pairing.begin({ contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') }, origin)
    pairing.approve(pending.userCode)
    const paired = pairing.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier }, origin)
    if (paired.state !== 'paired') throw new Error('Fixture pairing failed.')
    const headers = { authorization: `Bearer ${paired.token}` }
    for (const [path, body] of [
      ['/api/teams/meetings/resolve', { joinUrl: 'https://teams.microsoft.com/l/meetup-join/sanitized' }],
      ['/api/teams/meetings/acquire', { meetingId: 'sanitized', opportunityId: 'opp', meetingType: 'internal' }]
    ] as const) {
      const result = await send(path, body, headers)
      expect(result.status).toBe(409)
      expect(JSON.parse(result.text)).toMatchObject({ error: 'graph_unavailable_in_cli_profile' })
    }
    expect((await send('/api/teams/session', undefined, headers)).status).toBe(200)
    expect(resolveServices).not.toHaveBeenCalled()
  })

  it('requires an issued page capability before silently revalidating the owner and renewing a lease', async () => {
    const { send, pairing, refreshIdentity, resolveServices } = await fixture()
    expect((await send('/api/teams/local/renew', { contractVersion: '1.0' })).status).toBe(401)
    expect(refreshIdentity).not.toHaveBeenCalled()
    const verifier = randomBytes(32).toString('base64url')
    const pending = pairing.begin({ contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') }, origin)
    pairing.approve(pending.userCode)
    const paired = pairing.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier }, origin)
    if (paired.state !== 'paired') throw new Error('Fixture pairing failed.')
    const headers = { authorization: `Bearer ${paired.token}` }
    const renewed = await send('/api/teams/local/renew', { contractVersion: '1.0' }, headers)
    expect(renewed.status).toBe(200)
    expect(JSON.parse(renewed.text)).toMatchObject({ contractVersion: '1.0', sessionExpiresAt: expect.any(String) })
    expect(refreshIdentity).toHaveBeenCalledOnce()
    expect(resolveServices).not.toHaveBeenCalled()
    expect((await send('/api/teams/local/renew', { contractVersion: '1.0' }, { ...headers, origin: 'https://hostile.test' })).status).toBe(403)
    pairing.revoke(paired.token)
    expect((await send('/api/teams/local/renew', { contractVersion: '1.0' }, headers)).status).toBe(401)
    expect(refreshIdentity).toHaveBeenCalledOnce()
  })
  it('does not transfer a page lease when owner authority changes during silent revalidation', async () => {
    const { send, pairing, refreshIdentity, changeGeneration } = await fixture()
    const verifier = randomBytes(32).toString('base64url')
    const pending = pairing.begin({ contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') }, origin)
    pairing.approve(pending.userCode)
    const paired = pairing.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier }, origin)
    if (paired.state !== 'paired') throw new Error('Fixture pairing failed.')
    refreshIdentity.mockImplementationOnce(async () => { changeGeneration() })
    expect((await send('/api/teams/local/renew', { contractVersion: '1.0' }, { authorization: `Bearer ${paired.token}` })).status).toBe(401)
  })
  it('verifies a matching Teams client only after authenticated pairing, without resolving source services', async () => {
    const { send, pairing, resolveServices } = await fixture()
    const status = JSON.parse((await send('/api/teams/launch')).text)
    expect(status.clients).toEqual([])
    const report = { contractVersion: teamsLaunchVersion, runId: status.runId, clientBuildId: status.clientBuildId, packageVersion: status.packageVersion, host: 'teams' }
    expect((await send('/api/teams/launch/ready', report)).status).toBe(401)
    const verifier = randomBytes(32).toString('base64url')
    const pending = pairing.begin({ contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') }, origin)
    pairing.approve(pending.userCode)
    const paired = pairing.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier }, origin)
    if (paired.state !== 'paired') throw new Error('Fixture pairing failed.')
    const headers = { authorization: `Bearer ${paired.token}` }
    expect((await send('/api/teams/launch/ready', { ...report, runId: '2'.repeat(32) }, headers)).status).toBe(409)
    expect((await send('/api/teams/launch/ready', report, { ...headers, origin: 'https://hostile.test' })).status).toBe(403)
    expect((await send('/api/teams/launch/ready', report, headers)).status).toBe(200)
    expect(JSON.parse((await send('/api/teams/launch')).text).clients).toMatchObject([{ host: 'teams', pairingCode: pending.userCode }])
    pairing.revoke(paired.token)
    expect(JSON.parse((await send('/api/teams/launch')).text).clients).toEqual([])
    expect(resolveServices).not.toHaveBeenCalled()
  })
  it('exposes CLI live configuration, pairs the current user and denies every source action before service resolution', async () => {
    const { send, pairing, resolveServices } = await fixture(undefined, 'read-only')
    const publicResponse = await send('/api/teams/config')
    expect(publicResponse.status).toBe(200)
    expect(JSON.parse(publicResponse.text)).toMatchObject({ contractVersion: cliPublicConfigurationVersion, mode: 'live', authentication: 'local-azure-cli' })
    const verifier = randomBytes(32).toString('base64url')
    const pending = pairing.begin({ contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') }, origin)
    pairing.approve(pending.userCode)
    const paired = pairing.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier }, origin)
    if (paired.state !== 'paired') throw new Error('CLI page was not paired.')
    const headers = { authorization: `Bearer ${paired.token}` }
    const session = await send('/api/teams/session', undefined, headers)
    expect(session.status).toBe(200)
    expect(JSON.parse(session.text)).toMatchObject({ mode: 'live', roles: [], displayName: 'Verified local MSX user (read-only)' })
    expect((await send('/api/teams/local/status', undefined, headers)).status).toBe(200)
    const denied = await send('/api/teams/actions/preview', { operation: 'updateOpportunity', input: {} }, headers)
    expect(denied.status).toBe(403)
    expect(JSON.parse(denied.text)).toMatchObject({ error: 'local_read_only' })
    expect((await send('/api/teams/contexts', {}, headers)).status).toBe(409)
    expect(resolveServices).not.toHaveBeenCalled()
  })
  it('publishes only safe configuration while private requests require local pairing', async () => {
    const { send, resolveServices } = await fixture()
    expect(await send('/api/teams/config')).toMatchObject({ status: 200 })
    const denied = await send('/api/teams/local/status')
    expect(denied.status).toBe(401)
    expect(denied.text).not.toContain('private-owner')
    expect((await send('/api/teams/operations/listAccounts', {})).status).toBe(401)
    expect(resolveServices).not.toHaveBeenCalled()
  })
  it('rejects hostile Host/Origin/fetch-site before pairing or private service resolution', async () => {
    const { send, resolveServices } = await fixture()
    const body = { contractVersion: localConnectionVersion, challenge: createHash('sha256').update('test').digest('base64url') }
    for (const headers of [{ host: 'hostile.test' }, { origin: 'https://hostile.test' }, { 'sec-fetch-site': 'cross-site' }, { 'x-forwarded-host': 'localhost:3978' }]) {
      expect((await send('/api/teams/local/requests', body, headers)).status).toBe(403)
    }
    expect(resolveServices).not.toHaveBeenCalled()
  })
  it('admits only an owner-approved page and exposes no source token or HTTP approval endpoint', async () => {
    const { send, pairing, resolveServices } = await fixture()
    const verifier = randomBytes(32).toString('base64url')
    const response = await send('/api/teams/local/requests', { contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') })
    expect(response.status).toBe(201)
    const pending: unknown = JSON.parse(response.text)
    const parsed = (await import('../../../packages/common/contracts/local-connection.js')).localPairRequestResultSchema.parse(pending)
    expect((await send('/api/teams/local/approve', { userCode: parsed.userCode })).status).toBe(401)
    pairing.approve(parsed.userCode)
    const exchange = await send('/api/teams/local/exchange', { contractVersion: localConnectionVersion, requestId: parsed.requestId, verifier })
    const paired = (await import('../../../packages/common/contracts/local-connection.js')).localPairResultSchema.parse(JSON.parse(exchange.text))
    if (paired.state !== 'paired') throw new Error('Page was not paired.')
    const headers = { authorization: `Bearer ${paired.token}` }
    expect((await send('/api/teams/session', undefined, headers)).status).toBe(200)
    expect((await send('/api/teams/local/status', undefined, headers)).text).toContain('private-owner@example.test')
    expect((await send('/api/teams/contexts', {}, headers)).status).toBe(409)
    expect(resolveServices).not.toHaveBeenCalled()
  })
  it('does not release a private response after the native generation changed during the request', async () => {
    const { send, pairing, changeBeforeResponse } = await fixture()
    const verifier = randomBytes(32).toString('base64url')
    const pending = pairing.begin({ contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') }, origin)
    pairing.approve(pending.userCode)
    const paired = pairing.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier }, origin)
    if (paired.state !== 'paired') throw new Error('Pairing failed.')
    changeBeforeResponse()
    const response = await send('/api/teams/local/status', undefined, { authorization: `Bearer ${paired.token}` })
    expect(response.status).toBe(401)
    expect(response.text).not.toContain('private-owner')
  })
  it('revokes only the approved page and requires a fresh pairing without initializing source services', async () => {
    const { send, pairing, resolveServices } = await fixture()
    const verifier = randomBytes(32).toString('base64url')
    const pending = pairing.begin({ contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') }, origin)
    pairing.approve(pending.userCode)
    const paired = pairing.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier }, origin)
    if (paired.state !== 'paired') throw new Error('Pairing failed.')
    const headers = { authorization: `Bearer ${paired.token}` }
    const response = await send('/api/teams/local/revoke', { contractVersion: localConnectionVersion }, headers)
    expect(response.status).toBe(200)
    expect((await send('/api/teams/session', undefined, headers)).status).toBe(401)
    expect(resolveServices).not.toHaveBeenCalled()
  })
  it.each(['native', 'cli'] as const)('rejects an old %s review after reconnect and sends an exact ETag only for a fresh approved mock write', async (profile) => {
    const opportunityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    let forecastComments = 'Before'
    let sourceAllowsWrite = true
    const transport = vi.fn<typeof fetch>(async (input, options) => {
      if (options?.method === 'PATCH') {
        expect(new Headers(options.headers).get('if-match')).toBe('W/"1"')
        if (!sourceAllowsWrite) return Response.json({ error: { message: 'Sanitized source permission denied' } }, { status: 403 })
        expect(JSON.parse(String(options.body))).toEqual({ msp_forecastcomments: 'Reviewed offline fixture' })
        forecastComments = 'Reviewed offline fixture'
        return new Response(null, { status: 204 })
      }
      const url = new URL(String(input))
      if (url.pathname.endsWith('WhoAmI')) return Response.json({ UserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
      if (url.pathname.endsWith('msp_dealteams')) return Response.json({ value: [{ _msp_parentopportunityid_value: opportunityId }] })
      if (url.pathname.endsWith('opportunities')) return Response.json({ value: [{ opportunityid: opportunityId, name: 'Offline fixture opportunity', _parentaccountid_value: accountId, msp_activesalesstage: 1, estimatedvalue: 100, description: 'Preserve the customer need.', msp_forecastcomments: forecastComments, '@odata.etag': 'W/"1"' }] })
      if (url.pathname.endsWith('accounts')) return Response.json({ value: [{ accountid: accountId, name: 'Offline fixture account' }] })
      return Response.json({ value: [] })
    })
    const services = await createLiveApplicationServices({
      environment: {}, msxResource: 'https://microsoftsales.crm.dynamics.com', guidanceMode: 'deterministic',
      getToken: async () => 'offline-fixture-token', preferences: new MemoryPortfolioPreferenceStore(), fetchImplementation: transport
    })
    cleanup.push(() => services.dispose())
    const { pairing, send, changeGeneration } = await fixture(services, profile === 'cli' ? 'reviewed' : undefined)
    if (profile === 'cli') expect(JSON.parse((await send('/api/teams/config')).text)).toMatchObject({
      contractVersion: cliPublicConfigurationVersion, authentication: 'local-azure-cli', writeMode: 'reviewed'
    })
    const pair = () => {
      const verifier = randomBytes(32).toString('base64url')
      const pending = pairing.begin({ contractVersion: localConnectionVersion, challenge: createHash('sha256').update(verifier).digest('base64url') }, origin)
      pairing.approve(pending.userCode)
      const paired = pairing.exchange({ contractVersion: localConnectionVersion, requestId: pending.requestId, verifier }, origin)
      if (paired.state !== 'paired') throw new Error('Pairing failed.')
      return { authorization: `Bearer ${paired.token}` }
    }
    const input = { operation: 'updateOpportunity', input: { opportunityId, update: { comments: 'Reviewed offline fixture' } } }
    expect((await send('/api/teams/operations/updateOpportunity', input.input, pair())).status).toBe(403)
    const first = actionPreviewSchema.parse(JSON.parse((await send('/api/teams/actions/preview', input, pair())).text))
    changeGeneration()
    const headers = pair()
    const stale = await send('/api/teams/actions/commit', { contractVersion: collaborationVersion, id: first.id, digest: first.digest, reason: 'Old native epoch must not dispatch' }, headers)
    expect(stale.status).toBe(409)
    expect(transport.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
    const fresh = actionPreviewSchema.parse(JSON.parse((await send('/api/teams/actions/preview', input, headers)).text))
    const committed = await send('/api/teams/actions/commit', { contractVersion: collaborationVersion, id: fresh.id, digest: fresh.digest, reason: 'Approved sanitized mock operation only' }, headers)
    expect(JSON.parse(committed.text)).toMatchObject({ state: 'confirmed' })
    const repeated = await send('/api/teams/actions/commit', { contractVersion: collaborationVersion, id: fresh.id, digest: fresh.digest, reason: 'Retrieve existing receipt, not a second write' }, headers)
    expect(JSON.parse(repeated.text)).toMatchObject({ id: fresh.id, state: 'confirmed' })
    expect(transport.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1)
    const activity = await send('/api/teams/activity', undefined, headers)
    expect(JSON.parse(activity.text).actions).toContainEqual({ id: fresh.id, operation: 'updateOpportunity', state: 'confirmed' })
    sourceAllowsWrite = false
    const deniedPreview = actionPreviewSchema.parse(JSON.parse((await send('/api/teams/actions/preview', input, headers)).text))
    const denied = await send('/api/teams/actions/commit', { contractVersion: collaborationVersion, id: deniedPreview.id, digest: deniedPreview.digest, reason: 'Source must enforce its current permissions' }, headers)
    expect(JSON.parse(denied.text)).toMatchObject({ state: 'effect-unknown' })
    expect(forecastComments).toBe('Reviewed offline fixture')
  })
})
