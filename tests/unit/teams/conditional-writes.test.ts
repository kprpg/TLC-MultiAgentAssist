import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../../packages/connectors/msx/live.js'
import { MemoryPortfolioPreferenceStore } from '../../../packages/connectors/common/portfolio-preferences.js'

const opportunityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
function fixture(includeVersion = true) {
  let version = 'W/"1"'
  let comments = 'Before'
  const transport = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
    const url = new URL(String(input))
    if (options?.method === 'PATCH') {
      if (new Headers(options.headers).get('if-match') !== version) return Response.json({ error: { message: 'Precondition failed' } }, { status: 412 })
      expect(JSON.parse(String(options.body))).toEqual({ msp_forecastcomments: 'Reviewed after' })
      comments = 'Reviewed after'
      version = 'W/"3"'
      return new Response(null, { status: 204, headers: { etag: 'W/"3"' } })
    }
    if (url.pathname.endsWith('/WhoAmI')) return Response.json({ UserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
    if (url.pathname.endsWith('/msp_dealteams')) return Response.json({ value: [{ _msp_parentopportunityid_value: opportunityId }] })
    if (url.pathname.endsWith('/opportunities')) return Response.json({ value: [{
      opportunityid: opportunityId, name: 'Authorized fixture opportunity', _parentaccountid_value: accountId,
      msp_activesalesstage: 1, estimatedvalue: 100, estimatedclosedate: '2026-10-17',
      description: 'Preserve the customer need.', msp_forecastcomments: comments,
      ...(includeVersion ? { '@odata.etag': version } : {})
    }] })
    if (url.pathname.endsWith('/accounts')) return Response.json({ value: [{ accountid: accountId, name: 'Fixture account' }] })
    return Response.json({ value: [] })
  })
  const msx = new LiveMsxConnector({ getAccessToken: async () => 'delegated' }, transport, undefined, undefined, {}, new MemoryPortfolioPreferenceStore(), { cachePortfolio: false, requireConditionalWrites: true })
  return { msx, transport, changeVersion: () => { version = 'W/"2"' } }
}

describe('native reviewed-version concurrency, not a second read proxy', () => {
  it('sends the exact reviewed native ETag rather than If-Match wildcard', async () => {
    const { msx, transport } = fixture()
    await msx.getOpportunityContext(opportunityId)
    const versions = await msx.getConcurrencyTokens(opportunityId)
    await msx.withExpectedVersions(versions, () => msx.updateOpportunity(opportunityId, { comments: 'Reviewed after' }))
    const patch = transport.mock.calls.find(([, options]) => options?.method === 'PATCH')
    expect(new Headers(patch?.[1]?.headers).get('if-match')).toBe('W/"1"')
  })
  it('does not replace the reviewed version with a newer version observed by a later access check', async () => {
    const { msx, transport, changeVersion } = fixture()
    await msx.getOpportunityContext(opportunityId)
    const reviewed = await msx.getConcurrencyTokens(opportunityId)
    changeVersion()
    await expect(msx.withExpectedVersions(reviewed, () => msx.updateOpportunity(opportunityId, { comments: 'Reviewed after' }))).rejects.toMatchObject({ status: 412 })
    expect(transport.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1)
  })
  it('fails closed before PATCH when no authoritative concurrency token was read', async () => {
    const { msx, transport } = fixture(false)
    await expect(msx.withExpectedVersions({}, () => msx.updateOpportunity(opportunityId, { comments: 'No version' }))).rejects.toThrow(/concurrency/i)
    expect(transport.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
  })
  it('uses the just-verified self-membership ETag when leaving a Deal Team', async () => {
    const membership = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    let deleted = false
    const transport = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
      if (options?.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }) }
      if (String(input).endsWith('WhoAmI')) return Response.json({ UserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
      return Response.json({ value: deleted ? [] : [{ msp_dealteamid: membership, '@odata.etag': 'W/"5"' }] })
    })
    const msx = new LiveMsxConnector({ getAccessToken: async () => 'delegated' }, transport, undefined, undefined, {}, new MemoryPortfolioPreferenceStore(), { requireConditionalWrites: true })
    await msx.withExpectedVersions({}, () => msx.leaveDealTeam(opportunityId))
    const deletion = transport.mock.calls.find(([, options]) => options?.method === 'DELETE')
    expect(new Headers(deletion?.[1]?.headers).get('if-match')).toBe('W/"5"')
  })
})
