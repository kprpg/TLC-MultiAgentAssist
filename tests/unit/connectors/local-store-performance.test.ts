import { describe, expect, it, vi } from 'vitest'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'

describe('SQLite portfolio backend work', () => {
  it('returns the same ordered portfolio with four bulk queries and no per-record lookup queries', async () => {
    const store = new LocalStore()
    try {
      store.run('UPDATE opportunity SET opportunity_intent_codes = ? WHERE id = ?', '606820000,606820001', 'opp-grid-modernization')
      const msx = new LocalStoreMsxConnector(store)
      const accounts = await msx.listAccounts()
      const opportunities = (await Promise.all(accounts.map((account) => msx.listOpportunities(account.id)))).flat()
      const reads = vi.spyOn(store, 'all')
      const lookups = vi.spyOn(store, 'get')
      const perAccount = vi.spyOn(msx, 'listOpportunities')
      const core = new ThinSliceOrchestrator(msx, { getStageGuidance: vi.fn() })
      const result = await core.getPortfolioIndex({ contractVersion: '1.0' })
      expect(result).toEqual({ contractVersion: '1.0', accounts, opportunities })
      expect(reads).toHaveBeenCalledTimes(4)
      expect(lookups).not.toHaveBeenCalled()
      expect(perAccount).not.toHaveBeenCalled()
      expect(opportunities.some((opportunity) => opportunity.owner && opportunity.opportunityIntent?.length)).toBe(true)
    } finally { store.close() }
  })
  it('rechecks visibility and membership rather than retaining a bulk-query result between reads', async () => {
    const store = new LocalStore()
    try {
      const msx = new LocalStoreMsxConnector(store)
      expect((await msx.getPortfolioIndex()).opportunities.some((item) => item.accountId === 'account-contoso')).toBe(true)
      await msx.setAccountVisibility('account-contoso', 'hidden')
      const hidden = await msx.getPortfolioIndex({ includeHidden: true })
      expect(hidden.accounts.find((item) => item.id === 'account-contoso')?.visibility).toBe('hidden')
      expect(hidden.opportunities.some((item) => item.accountId === 'account-contoso')).toBe(false)
      const anotherUser = new LocalStoreMsxConnector(store, 'synthetic-user-without-memberships')
      expect((await anotherUser.getPortfolioIndex()).opportunities).toEqual([])
      await msx.setAccountVisibility('account-contoso', 'visible')
      await msx.leaveDealTeam('opp-grid-modernization')
      expect((await msx.getPortfolioIndex()).opportunities.some((item) => item.id === 'opp-grid-modernization')).toBe(true)
      for (const milestone of await msx.listMilestones('opp-grid-modernization')) {
        if (milestone.onMilestoneTeam) await msx.leaveMilestoneTeam('opp-grid-modernization', milestone.id)
      }
      expect((await msx.getPortfolioIndex()).opportunities.some((item) => item.id === 'opp-grid-modernization')).toBe(false)
    } finally { store.close() }
  })
  it('loads milestone owners in the bulk query while retaining each access and membership check', async () => {
    const store = new LocalStore()
    try {
      const msx = new LocalStoreMsxConnector(store)
      const expected = await msx.listMilestones('opp-grid-modernization')
      const reads = vi.spyOn(store, 'all')
      const lookups = vi.spyOn(store, 'get')
      expect(await msx.listMilestones('opp-grid-modernization')).toEqual(expected)
      expect(reads).toHaveBeenCalledTimes(2)
      expect(lookups).toHaveBeenCalledTimes(3)
      expect(lookups.mock.calls.some(([query]) => query.includes('FROM systemuser'))).toBe(false)
      expect(expected.some((item) => item.owner)).toBe(true)
      expect(expected.some((item) => item.owner === undefined)).toBe(true)
    } finally { store.close() }
  })
})
