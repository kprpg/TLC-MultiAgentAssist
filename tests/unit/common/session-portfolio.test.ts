import { describe, expect, it, vi } from 'vitest'
import { SessionPortfolio, waitForSessionRead } from '../../../apps/shared/session-portfolio.js'
import { filterDiscoveryOpportunities } from '../../../apps/shared/discovery.js'
import type { DiscoverySnapshot, Milestone, MutationReview, PortfolioIndex } from '../../../packages/common/contracts/index.js'

function fixture() {
  const opportunity = { id: 'opportunity', accountId: 'account', name: 'Sanitized opportunity', recordedStage: 2, value: -125, currency: 'USD', closeDate: '2099-01-01' }
  const accounts = [{ id: 'account', name: 'Sanitized customer', segment: 'test' },
    { id: 'hidden', name: 'Hidden customer', segment: 'test', visibility: 'hidden' as const }]
  const index: PortfolioIndex = { contractVersion: '1.0', accounts, opportunities: [] }
  const snapshot: DiscoverySnapshot = {
    contractVersion: '1.0', generatedAt: '2026-10-21T12:00:00.000Z', accounts, portfolioOpportunities: [],
    opportunities: ['infra', 'data', 'services'].map((domain) => ({
      ...opportunity, domain: domain as 'infra' | 'data' | 'services', accountName: 'Sanitized customer', onDealTeam: false
    })),
    milestoneTeamOpportunityIds: []
  }
  const milestones: Milestone[] = [{ id: 'milestone', opportunityId: opportunity.id, name: 'Sanitized milestone', status: 'On Track', onMilestoneTeam: false }]
  const source = {
    getPortfolioIndex: vi.fn(async () => structuredClone(index)),
    getDiscoverySnapshot: vi.fn(async () => structuredClone(snapshot)),
    listMilestones: vi.fn(async () => structuredClone(milestones)),
    listDiscoverableMilestones: vi.fn(async () => structuredClone(milestones))
  }
  return { source, session: new SessionPortfolio(source), index, snapshot, opportunity }
}

describe('session-local Portfolio and Discovery snapshots', () => {
  it('validates the derived Portfolio on Discovery refresh without a second index scan or losing a confirmed join', async () => {
    const { session, source } = fixture()
    await session.getDiscoverySnapshot()
    session.refresh()
    await session.getDiscoverySnapshot()
    session.applyMutation('joinDealTeam', { opportunityId: 'opportunity', onDealTeam: true, alreadyMember: false })
    expect(await session.listOpportunities('account')).toHaveLength(1)
    expect(source.getPortfolioIndex).not.toHaveBeenCalled()
    expect(source.getDiscoverySnapshot).toHaveBeenCalledTimes(2)
  })
  it('uses the value actually displayed by an editor, not a newer silent cache result', async () => {
    const { session, opportunity } = fixture()
    await session.getDiscoverySnapshot()
    const current = { ...opportunity, comments: 'Changed behind the existing editor' }
    session.applyMutation('updateOpportunity', current)
    session.captureField(opportunity.id, 'comments', '')
    const input = { opportunityId: opportunity.id, update: { comments: 'User draft from the older display' } }
    const review: MutationReview = { contractVersion: '1.0', id: '00000000-0000-4000-8000-000000000001', operation: 'updateOpportunity',
      input, digest: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z', recordKeys: [`opportunity:${opportunity.id}`], before: { opportunity: current } }
    expect(() => session.captureReview('updateOpportunity', input)?.(review)).toThrow('source changed while you were editing')
  })
  it('bounds original edit proofs and refuses to mint a replacement proof after overflow', () => {
    const { source, opportunity } = fixture()
    const session = new SessionPortfolio(source, { policy: { maxInactiveEntries: 1 } })
    for (let index = 0; index < 11; index++) session.captureField(`record-${index}`, 'comments', 'Original displayed value')
    expect(session.getState().error).toContain('Unsent draft memory is full')
    const input = { opportunityId: 'record-10', update: { comments: 'New draft' } }
    const review: MutationReview = { contractVersion: '1.0', id: '00000000-0000-4000-8000-000000000001', operation: 'updateOpportunity',
      input, digest: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z', recordKeys: ['opportunity:record-10'], before: { opportunity } }
    expect(() => session.captureReview('updateOpportunity', input)?.(review)).toThrow('original edit base could not be retained')
    session.dispose()
  })
  it('fetches genuinely missing scope once after adding a customer and patches cached search state', async () => {
    const { session, source, snapshot, opportunity } = fixture()
    await session.getDiscoverySnapshot()
    await session.readDataset('search:name:Added', async () => [{ id: 'added', name: 'Added customer', segment: 'test', state: 'not-added' }])
    const added = { id: 'added', name: 'Added customer', segment: 'test', visibility: 'visible' as const }
    snapshot.accounts.push(added)
    snapshot.opportunities.push({ ...opportunity, id: 'added-opportunity', accountId: added.id, accountName: added.name, domain: 'infra', onDealTeam: false })
    session.applyMutation('addAccount', added)
    expect((await session.discoverOpportunities('infra')).some((item) => item.id === 'added-opportunity')).toBe(true)
    expect(source.getDiscoverySnapshot).toHaveBeenCalledTimes(2)
    expect(source.getPortfolioIndex).not.toHaveBeenCalled()
    expect(await session.readDataset('search:name:Added', vi.fn())).toMatchObject([{ state: 'visible' }])
  })
  it('re-registers an evicted lazy detail instead of keeping a detached cache handle', async () => {
    const { source } = fixture()
    const details = vi.fn(async (id: string): Promise<Milestone[]> => [{ id: `milestone-${id}`, opportunityId: id, name: 'Synthetic milestone', status: 'On Track' }])
    const session = new SessionPortfolio({ ...source, listMilestones: details }, { policy: { maxInactiveEntries: 1 } })
    await session.listMilestones('one')
    await session.listMilestones('two')
    expect(session.cache.has('milestones:one')).toBe(false)
    await session.listMilestones('one')
    expect(details).toHaveBeenCalledTimes(3)
    expect(session.cache.has('milestones:one')).toBe(true)
    session.dispose()
  })
  it('freezes a submitted draft before pane navigation and rejects a fresh ETag for an old editor intent', async () => {
    const { session, opportunity } = fixture()
    await session.getDiscoverySnapshot()
    session.captureDraft(opportunity.id)
    const input = { opportunityId: opportunity.id, update: { comments: 'Retained local draft' } }
    const validate = session.captureReview('updateOpportunity', input)
    expect(validate).toBeTypeOf('function')
    session.discardDraft(opportunity.id)
    const remote = { ...opportunity, comments: 'Changed by another editor' }
    session.applyMutation('updateOpportunity', remote)
    const review: MutationReview = { contractVersion: '1.0', id: '00000000-0000-4000-8000-000000000001',
      operation: 'updateOpportunity', input, digest: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z',
      recordKeys: [`opportunity:${opportunity.id}`], before: { opportunity: remote } }
    expect(() => validate?.(review)).toThrow('source changed while you were editing')
    session.clear()
    expect(() => validate?.(review)).toThrow()
  })
  it('loads all Discovery domains once and filters tabs and customers without more source reads', async () => {
    const { session, source } = fixture()
    const infra = await session.discoverOpportunities('infra')
    for (const domain of ['data', 'services', 'infra', 'data'] as const) {
      expect(await session.discoverOpportunities(domain)).toHaveLength(1)
    }
    expect(filterDiscoveryOpportunities(infra, { include: [{ id: 'account', name: 'Sanitized customer' }], exclude: [] })).toHaveLength(1)
    expect(filterDiscoveryOpportunities(infra, { include: [], exclude: [{ id: 'account', name: 'Sanitized customer' }] })).toEqual([])
    expect(source.getDiscoverySnapshot).toHaveBeenCalledOnce()
    expect(source.getPortfolioIndex).not.toHaveBeenCalled()
    expect(source.listMilestones).not.toHaveBeenCalled()
    expect(source.listDiscoverableMilestones).not.toHaveBeenCalled()
  })

  it('keeps Discovery lazy when Portfolio loads first and reuses the index across account navigation', async () => {
    const { session, source } = fixture()
    await Promise.all([session.getPortfolioIndex(), session.listAccounts(), session.listAccounts(true)])
    await session.listOpportunities('account')
    await session.getPortfolioWorkspace({ contractVersion: '1.0', accountId: 'account' })
    expect(source.getPortfolioIndex).toHaveBeenCalledOnce()
    expect(source.getDiscoverySnapshot).not.toHaveBeenCalled()
    expect(await session.listAccounts()).toHaveLength(1)
    expect(await session.listAccounts(true)).toHaveLength(2)
    await session.discoverOpportunities('infra')
    expect(source.getDiscoverySnapshot).toHaveBeenCalledOnce()
    expect(source.getPortfolioIndex).toHaveBeenCalledOnce()
  })

  it('seeds Portfolio from Discovery when Discovery opens first', async () => {
    const { session, source } = fixture()
    await session.discoverOpportunities('infra')
    await session.getPortfolioWorkspace({ contractVersion: '1.0', accountId: 'account' })
    expect(source.getPortfolioIndex).not.toHaveBeenCalled()
  })

  it('coalesces concurrent requests, returns isolated values and caches empty lists', async () => {
    const { session, source } = fixture()
    const [first] = await Promise.all([session.discoverOpportunities('infra'), session.discoverOpportunities('data')])
    first[0]!.name = 'Local mutation must not leak'
    expect((await session.discoverOpportunities('infra'))[0]?.name).toBe('Sanitized opportunity')
    expect(await session.discoverOpportunities('security')).toEqual([])
    expect(await session.discoverOpportunities('security')).toEqual([])
    expect(source.getDiscoverySnapshot).toHaveBeenCalledOnce()
  })

  it('loads milestones only on first expansion and shares the detail snapshot with Portfolio', async () => {
    const { session, source } = fixture()
    await session.discoverOpportunities('infra')
    expect(source.listDiscoverableMilestones).not.toHaveBeenCalled()
    await session.listMilestones('opportunity', true)
    await session.listMilestones('opportunity', true)
    await session.listMilestones('opportunity')
    expect(source.listDiscoverableMilestones).toHaveBeenCalledOnce()
    expect(source.listMilestones).not.toHaveBeenCalled()
  })

  it('updates membership across cached domains and Portfolio without requerying', async () => {
    const { session, source } = fixture()
    await session.discoverOpportunities('infra')
    await session.listMilestones('opportunity', true)
    session.applyMutation('joinDealTeam', { opportunityId: 'opportunity', onDealTeam: true, alreadyMember: false })
    expect((await session.discoverOpportunities('data'))[0]?.onDealTeam).toBe(true)
    expect(await session.listOpportunities('account')).toHaveLength(1)
    session.applyMutation('joinMilestoneTeam', { opportunityId: 'opportunity', milestoneId: 'milestone', onMilestoneTeam: true, alreadyMember: false })
    session.applyMutation('leaveDealTeam', { opportunityId: 'opportunity', onDealTeam: false, alreadyAbsent: false })
    expect(await session.listOpportunities('account')).toHaveLength(1)
    expect((await session.discoverOpportunities('services'))[0]?.onDealTeam).toBe(false)
    session.applyMutation('leaveMilestoneTeam', { opportunityId: 'opportunity', milestoneId: 'milestone', onMilestoneTeam: false, alreadyAbsent: false })
    expect(await session.listOpportunities('account')).toEqual([])
    expect(source.getDiscoverySnapshot).toHaveBeenCalledOnce()
    expect(source.getPortfolioIndex).not.toHaveBeenCalled()
  })

  it('hides and restores a cached customer locally without losing its cached opportunities', async () => {
    const { session, source } = fixture()
    await session.discoverOpportunities('infra')
    session.applyMutation('setAccountVisibility', { id: 'account', name: 'Sanitized customer', segment: 'test', visibility: 'hidden' })
    expect((await session.getDiscoverySnapshot()).opportunities).toEqual([])
    expect(await session.discoverOpportunities('infra')).toEqual([])
    session.applyMutation('setAccountVisibility', { id: 'account', name: 'Sanitized customer', segment: 'test', visibility: 'visible' })
    expect(await session.discoverOpportunities('infra')).toHaveLength(1)
    expect(source.getDiscoverySnapshot).toHaveBeenCalledOnce()
  })

  it('reloads once on explicit Refresh and does not fall back to an old snapshot after failure', async () => {
    const { session, source } = fixture()
    await session.discoverOpportunities('infra')
    source.getDiscoverySnapshot.mockRejectedValueOnce(new Error('MSX access denied.'))
    session.refresh()
    await expect(session.discoverOpportunities('data')).rejects.toThrow('MSX access denied.')
    expect(await session.discoverOpportunities('data')).toHaveLength(1)
    expect(source.getDiscoverySnapshot).toHaveBeenCalledTimes(3)
    expect(source.getPortfolioIndex).not.toHaveBeenCalled()
  })

  it('refreshes Portfolio through a fresh shared snapshot, not a stale host index', async () => {
    const { session, source } = fixture()
    await session.getPortfolioIndex()
    session.refresh()
    await session.getPortfolioIndex()
    await session.discoverOpportunities('infra')
    expect(source.getPortfolioIndex).toHaveBeenCalledOnce()
    expect(source.getDiscoverySnapshot).toHaveBeenCalledOnce()
  })

  it('rejects a stale in-flight result after session reset', async () => {
    const { session, source, snapshot } = fixture()
    let complete!: (value: DiscoverySnapshot) => void
    source.getDiscoverySnapshot.mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
    const old = session.discoverOpportunities('infra')
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
    session.clear()
    complete(snapshot)
    await rejected
    await session.discoverOpportunities('infra')
    expect(source.getDiscoverySnapshot).toHaveBeenCalledTimes(2)
  })

  it('preserves a confirmed membership write that completes while the snapshot is loading', async () => {
    const { session, source, snapshot } = fixture()
    let complete!: (value: DiscoverySnapshot) => void
    source.getDiscoverySnapshot.mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
    const pending = session.discoverOpportunities('infra')
    session.applyMutation('joinDealTeam', { opportunityId: 'opportunity', onDealTeam: true, alreadyMember: false })
    complete(snapshot)
    expect((await pending)[0]?.onDealTeam).toBe(true)
    expect(await session.listOpportunities('account')).toHaveLength(1)
    expect(source.getPortfolioIndex).not.toHaveBeenCalled()
  })

  it.each([false, true])('does not reseed a cleared session from a ready cache hit (queued reset: %s)', async (queued) => {
    const { session, source } = fixture()
    await session.getDiscoverySnapshot()
    const pending = session.getDiscoverySnapshot()
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    if (queued) queueMicrotask(() => session.clear())
    else session.clear()
    await rejected
    await session.getPortfolioIndex()
    expect(source.getPortfolioIndex).toHaveBeenCalledOnce()
  })

  it('returns confirmed local membership changes even when a ready-cache read is already queued', async () => {
    const { session } = fixture()
    await session.getDiscoverySnapshot()
    const pending = session.discoverOpportunities('infra')
    session.applyMutation('joinDealTeam', { opportunityId: 'opportunity', onDealTeam: true, alreadyMember: false })
    expect((await pending)[0]?.onDealTeam).toBe(true)
  })

  it('does not let an aborted pane navigation cancel the session load needed by another pane', async () => {
    const { session, source } = fixture()
    const controller = new AbortController()
    const first = waitForSessionRead(session.discoverOpportunities('infra'), controller.signal)
    const second = session.discoverOpportunities('data')
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(await second).toHaveLength(1)
    expect(source.getDiscoverySnapshot).toHaveBeenCalledOnce()
  })

  it('rejects unavailable selections rather than substituting another customer', async () => {
    const { session } = fixture()
    await expect(session.getPortfolioWorkspace({ contractVersion: '1.0', accountId: 'hidden' })).rejects.toThrow('selected account')
    await expect(session.getPortfolioWorkspace({ contractVersion: '1.0', accountId: 'account', opportunityId: 'other' })).rejects.toThrow('selected opportunity')
  })
})
