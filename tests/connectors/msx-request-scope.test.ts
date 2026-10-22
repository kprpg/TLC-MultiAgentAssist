import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../packages/connectors/msx/live.js'
import { MemoryPortfolioPreferenceStore } from '../../packages/connectors/common/portfolio-preferences.js'

function fixture() {
  const preferences = new MemoryPortfolioPreferenceStore()
  const transport = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/WhoAmI')) return Response.json({ UserId: 'user-id' })
    if (path.endsWith('/msp_dealteams')) return Response.json({ value: [{ _msp_parentopportunityid_value: 'one' }, { _msp_parentopportunityid_value: 'two' }] })
    if (path.endsWith('/opportunities')) return Response.json({ value: [
      { opportunityid: 'one', _parentaccountid_value: 'alpha', name: 'First', estimatedvalue: 10 },
      { opportunityid: 'two', _parentaccountid_value: 'beta', name: 'Second', estimatedvalue: 20 }
    ] })
    if (path.endsWith('/accounts')) return Response.json({ value: [{ accountid: 'alpha', name: 'Alpha' }, { accountid: 'beta', name: 'Beta' }] })
    throw new Error('Unexpected fixture source request.')
  })
  const msx = new LiveMsxConnector({ getAccessToken: async () => 'fixture-token' }, transport, undefined, undefined, {}, preferences, { cachePortfolio: false })
  const scans = () => transport.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/msp_dealteams')).length
  const capture = async () => {
    const accounts = await msx.listAccounts()
    const opportunities = (await Promise.all(accounts.map((account) => msx.listOpportunities(account.id)))).flat()
    return { accounts, opportunities }
  }
  return { msx, preferences, capture, scans }
}

describe('bounded workflow source-scope reads', () => {
  it('loads the full portfolio once per capture rather than once per account, then rechecks the next capture', async () => {
    const { msx, preferences, capture, scans } = fixture()
    const first = await msx.withReadContext(capture)
    expect(first.opportunities.map((item) => item.id)).toEqual(['one', 'two'])
    expect(scans()).toBe(1)
    await preferences.setVisibility('user-id', 'beta', 'hidden')
    msx.refresh()
    const next = await msx.withReadContext(capture)
    expect(next.accounts.map((item) => item.id)).toEqual(['alpha'])
    expect(next.opportunities.map((item) => item.id)).toEqual(['one'])
    expect(scans()).toBe(2)
  })
  it('does not retain the read context across unrelated requests or concurrent captures', async () => {
    const { msx, capture, scans } = fixture()
    await Promise.all([msx.withReadContext(capture), msx.withReadContext(capture)])
    expect(scans()).toBe(2)
    await msx.listAccounts()
    await msx.listAccounts()
    expect(scans()).toBe(4)
  })
})
