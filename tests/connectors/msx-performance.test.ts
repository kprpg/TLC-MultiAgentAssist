import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../packages/connectors/msx/live.js'
import { MemoryPortfolioPreferenceStore } from '../../packages/connectors/common/portfolio-preferences.js'
import { ThinSliceOrchestrator } from '../../packages/orchestrator/index.js'
import type { PerformanceEvent } from '../../packages/common/telemetry/performance.js'

function fixture() {
  let denied = false
  const credential = vi.fn(async () => 'synthetic-credential')
  const transport = vi.fn<typeof fetch>(async (input) => {
    if (denied) return Response.json({}, { status: 403 })
    const entity = new URL(String(input)).pathname.split('/').at(-1)
    if (entity === 'WhoAmI') return Response.json({ UserId: 'synthetic-user' })
    if (entity === 'msp_dealteams') return Response.json({ value: [{ _msp_parentopportunityid_value: 'opportunity' }] })
    if (entity === 'opportunities') return Response.json({ value: [{ opportunityid: 'opportunity', _parentaccountid_value: 'account', name: 'Sanitized opportunity', estimatedvalue: 1 }] })
    if (entity === 'accounts') return Response.json({ value: [{ accountid: 'account', name: 'Sanitized account' }] })
    if (entity === 'msp_engagementmilestones' || entity === 'teamtemplates') return Response.json({ value: [] })
    throw new Error('Unexpected source read in performance fixture.')
  })
  const msx = new LiveMsxConnector({ getAccessToken: credential }, transport, undefined, undefined, {},
    new MemoryPortfolioPreferenceStore(), { cachePortfolio: false, requireConditionalWrites: true })
  const core = new ThinSliceOrchestrator(msx, { getStageGuidance: async () => { throw new Error('Guidance not needed by this read fixture.') } })
  const scans = () => transport.mock.calls.filter(([input]) => String(input).includes('/msp_dealteams')).length
  return { msx, core, transport, credential, scans, deny: () => { denied = true } }
}

describe('bounded Live portfolio performance without stale authorization', () => {
  it('reports denied HTTP reads as failed timing events rather than successful fetches', async () => {
    const events: PerformanceEvent[] = []
    const msx = new LiveMsxConnector({ getAccessToken: async () => 'synthetic' },
      async () => Response.json({}, { status: 403 }), undefined, (event) => events.push(event))
    await expect(msx.listAccounts()).rejects.toMatchObject({ status: 403 })
    expect(events).toContainEqual(expect.objectContaining({ operation: 'msx.http.read', outcome: 'failure' }))
  })
  it('hydrates one portfolio for a snapshot and one for a complete workspace, not once per component read', async () => {
    const data = fixture()
    const snapshot = await data.core.getOpportunitySnapshot('opportunity')
    expect(data.scans()).toBe(1)
    expect(data.transport).toHaveBeenCalledTimes(6)
    data.msx.refresh()
    data.transport.mockClear(); data.credential.mockClear()
    const workspace = await data.core.getPortfolioWorkspace({ contractVersion: '1.0' })
    expect(workspace).toMatchObject({ selectedAccountId: 'account', selectedOpportunityId: 'opportunity', milestones: [] })
    expect(workspace.opportunities[0]).toEqual(snapshot.opportunity)
    expect(data.scans()).toBe(1)
    expect(data.transport).toHaveBeenCalledTimes(6)
    expect(data.credential).toHaveBeenCalledTimes(6)
    expect(data.transport.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/teamtemplates'))).toHaveLength(1)
  })
  it('uses one capture for a search index and rechecks independent requests, including denial', async () => {
    const data = fixture()
    const perAccount = vi.spyOn(data.msx, 'listOpportunities')
    expect((await data.core.getPortfolioIndex({ contractVersion: '1.0' })).opportunities).toHaveLength(1)
    expect(perAccount).not.toHaveBeenCalled()
    expect(data.scans()).toBe(1)
    await data.core.getPortfolioIndex({ contractVersion: '1.0' })
    expect(data.scans()).toBe(2)
    data.deny()
    await expect(data.core.getPortfolioIndex({ contractVersion: '1.0' })).rejects.toMatchObject({ status: 403 })
  })
  it('reads current milestone membership once per capture and rechecks it in the next capture', async () => {
    let member = false
    const transport = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return Response.json({ UserId: 'user' })
      if (url.pathname.endsWith('/msp_dealteams')) return Response.json({ value: [{ _msp_parentopportunityid_value: 'opportunity' }] })
      if (url.pathname.endsWith('/opportunities')) return Response.json({ value: [{ opportunityid: 'opportunity', _parentaccountid_value: 'account', name: 'Synthetic', estimatedvalue: 1 }] })
      if (url.pathname.endsWith('/accounts')) return Response.json({ value: [{ accountid: 'account', name: 'Synthetic' }] })
      if (url.pathname.endsWith('/teams')) return Response.json({ value: member ? [{ _regardingobjectid_value: 'milestone' }] : [] })
      if (url.pathname.endsWith('/msp_engagementmilestones')) return Response.json({ value: [{ msp_engagementmilestoneid: 'milestone', _msp_opportunityid_value: 'opportunity', msp_name: 'Synthetic milestone' }] })
      throw new Error('Unexpected membership fixture read.')
    })
    const msx = new LiveMsxConnector({ getAccessToken: async () => 'synthetic' }, transport, undefined, undefined,
      { milestoneTeam: { templateId: '11111111-1111-4111-8111-111111111111' } }, new MemoryPortfolioPreferenceStore(), { cachePortfolio: false })
    const core = new ThinSliceOrchestrator(msx, { getStageGuidance: vi.fn() })
    expect((await core.getPortfolioWorkspace({ contractVersion: '1.0' })).milestones[0]?.onMilestoneTeam).toBe(false)
    expect(transport.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/teams'))).toHaveLength(1)
    member = true
    expect((await core.getPortfolioWorkspace({ contractVersion: '1.0' })).milestones[0]?.onMilestoneTeam).toBe(true)
    expect(transport.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/teams'))).toHaveLength(2)
  })
  it('does not substitute another customer or opportunity for an explicitly unavailable selection', async () => {
    const { core } = fixture()
    await expect(core.getPortfolioWorkspace({ contractVersion: '1.0', accountId: 'other-account' })).rejects.toThrow(/selected account/i)
    await expect(core.getPortfolioWorkspace({ contractVersion: '1.0', accountId: 'account', opportunityId: 'other-opportunity' })).rejects.toThrow(/selected opportunity/i)
  })
  it('keeps concurrent captures independent while reusing a nested read context', async () => {
    const data = fixture()
    await Promise.all([data.core.getPortfolioWorkspace({ contractVersion: '1.0' }), data.core.getPortfolioWorkspace({ contractVersion: '1.0' })])
    expect(data.scans()).toBe(2)
  })
  it('does not let cancellation of one capture poison another capture on the same connector', async () => {
    const data = fixture()
    const controller = new AbortController()
    data.transport.mockImplementationOnce(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const abandoned = data.core.withReadContext(() => data.core.getPortfolioWorkspace({ contractVersion: '1.0' }), controller.signal)
    const rejected = expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    expect(await data.core.getPortfolioWorkspace({ contractVersion: '1.0' })).toMatchObject({ selectedAccountId: 'account' })
    controller.abort()
    await rejected
  })
  it('stops before another pagination or credential dispatch after cancellation', async () => {
    const controller = new AbortController()
    const credential = vi.fn(async () => 'synthetic')
    const transport = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('WhoAmI')) return Response.json({ UserId: 'synthetic-user' })
      controller.abort()
      return Response.json({ value: [], '@odata.nextLink': 'https://microsoftsales.crm.dynamics.com/api/data/v9.2/msp_dealteams?page=2' })
    })
    const msx = new LiveMsxConnector({ getAccessToken: credential }, transport, undefined, undefined, {},
      new MemoryPortfolioPreferenceStore(), { cachePortfolio: false })
    await expect(msx.withReadContext(() => msx.listAccounts(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(transport).toHaveBeenCalledTimes(2)
    // Deal-team and milestone-team reads now start together, so a token may be requested for the sibling read; it is never dispatched.
    expect(credential.mock.calls.length).toBeLessThanOrEqual(3)
    expect(transport.mock.calls.at(-1)?.[1]?.signal).toBe(controller.signal)
  })
  it('reads chunks with at most two concurrent requests and preserves deterministic source order', async () => {
    const ids = Array.from({ length: 121 }, (_, index) => `opportunity-${index}`)
    let active = 0
    let peak = 0
    const transport = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return Response.json({ UserId: 'user' })
      if (url.pathname.endsWith('/msp_dealteams')) return Response.json({ value: ids.map((id) => ({ _msp_parentopportunityid_value: id })) })
      if (url.pathname.endsWith('/teamtemplates')) return Response.json({ value: [] })
      if (url.pathname.endsWith('/accounts')) return Response.json({ value: [{ accountid: 'account', name: 'Account' }] })
      if (url.pathname.endsWith('/opportunities')) {
        active++; peak = Math.max(peak, active)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        active--
        const filter = url.searchParams.get('$filter') ?? ''
        return Response.json({ value: ids.filter((id) => filter.includes(`opportunityid eq ${id})`) || filter.includes(`opportunityid eq ${id} or`))
          .map((id) => ({ opportunityid: id, _parentaccountid_value: 'account', name: id, estimatedvalue: 1 })) })
      }
      throw new Error('Unexpected bounded-chunk source request.')
    })
    const msx = new LiveMsxConnector({ getAccessToken: async () => 'synthetic' }, transport)
    const opportunities = await msx.listOpportunities('account')
    expect(peak).toBe(2)
    expect(opportunities.map((item) => item.id)).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
    expect(transport.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/opportunities'))).toHaveLength(4)
  })
})
