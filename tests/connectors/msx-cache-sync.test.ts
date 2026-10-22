import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../packages/connectors/msx/live.js'
import { ThinSliceOrchestrator } from '../../packages/orchestrator/index.js'

const opportunityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function fixture() {
  let version = 'W/"1"'
  let token = 'original-actor'
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    if (init?.method === 'PATCH') {
      if (new Headers(init.headers).get('if-match') !== version) return Response.json({}, { status: 412 })
      return new Response(null, { status: 204, headers: { etag: version } })
    }
    if (url.pathname.endsWith('/WhoAmI')) return Response.json({ UserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
    if (url.pathname.endsWith('/msp_dealteams')) return Response.json({ value: [{ _msp_parentopportunityid_value: opportunityId }] })
    if (url.pathname.endsWith('/opportunities')) return Response.json({ value: [{
      opportunityid: opportunityId, _parentaccountid_value: accountId, name: `Sanitized ${version}`,
      estimatedvalue: 1, '@odata.etag': version
    }] })
    if (url.pathname.endsWith('/accounts')) return Response.json({ value: [{ accountid: accountId, name: 'Sanitized customer' }] })
    return Response.json({ value: [] })
  })
  const msx = new LiveMsxConnector({ getAccessToken: async () => token }, fetcher)
  return { msx, fetcher, change: () => { version = 'W/"2"' }, switchActor: () => { token = 'another-actor' } }
}

describe('fresh source reads and immutable reviewed write proofs', () => {
  it('uses reviewed native ETags even on a compatibility connector whose default writes use wildcards', async () => {
    const { msx, fetcher, change } = fixture()
    await msx.getOpportunityContext(opportunityId)
    const reviewed = await msx.getConcurrencyTokens(opportunityId)
    change()
    msx.refresh()
    await expect(msx.withExpectedVersions(reviewed, () => msx.updateOpportunity(opportunityId, { comments: 'Explicitly reviewed' })))
      .rejects.toMatchObject({ status: 412 })
    const patch = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(new Headers(patch?.[1]?.headers).get('if-match')).toBe('W/"1"')
  })
  it('keeps scoped native version proofs when a background source refresh clears read caches', async () => {
    const { msx } = fixture()
    await msx.withFreshReadContext(async () => {
      await msx.getOpportunityContext(opportunityId)
      msx.refresh()
      expect(await msx.getConcurrencyTokens(opportunityId)).toMatchObject({ [`opportunities(${opportunityId})`]: 'W/"1"' })
    })
  })
  it('fresh aggregate reads revalidate instead of serving the process-lifetime source cache', async () => {
    const { msx, change, fetcher } = fixture()
    const core = new ThinSliceOrchestrator(msx, { getStageGuidance: vi.fn() })
    expect((await core.getPortfolioIndex({ contractVersion: '1.0' })).opportunities[0]?.name).toContain('1')
    change()
    expect((await core.getPortfolioIndex({ contractVersion: '1.0' })).opportunities[0]?.name).toContain('2')
    expect(fetcher.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/msp_dealteams'))).toHaveLength(2)
  })
  it('fails before source dispatch if the original actor token is replaced', async () => {
    const { msx, fetcher, switchActor } = fixture()
    await msx.getOpportunityContext(opportunityId)
    const versions = await msx.getConcurrencyTokens(opportunityId)
    switchActor()
    await expect(msx.withExpectedVersions(versions,
      () => msx.updateOpportunity(opportunityId, { comments: 'Do not send' }),
      (token) => { if (token !== 'original-actor') throw new Error('Source connection changed before dispatch.') }))
      .rejects.toThrow('Source connection changed before dispatch.')
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })
  it('exposes throttling delay without retrying the source request itself', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({}, { status: 429, headers: { 'retry-after': '12' } }))
    const msx = new LiveMsxConnector({ getAccessToken: async () => 'synthetic' }, fetcher)
    await expect(msx.listAccounts()).rejects.toMatchObject({ status: 429, retryAfterMs: 12_000 })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('signals native dispatch only after version and actor checks pass', async () => {
    const { msx, fetcher } = fixture()
    const sent = vi.fn()
    await expect(msx.withExpectedVersions({}, () => msx.updateOpportunity(opportunityId, { comments: 'Not sent' }), undefined, sent)).rejects.toThrow()
    expect(sent).not.toHaveBeenCalled()
    await msx.getOpportunityContext(opportunityId)
    const versions = await msx.getConcurrencyTokens(opportunityId)
    await expect(msx.withExpectedVersions(versions, () => msx.updateOpportunity(opportunityId, { comments: 'Confirmed test' }), undefined, sent))
      .rejects.toThrow('did not confirm the saved opportunity comments')
    expect(sent).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls.filter(([, input]) => input?.method === 'PATCH')).toHaveLength(1)
  })
})
