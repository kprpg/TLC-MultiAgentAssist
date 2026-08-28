import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../packages/connectors/msx/index.js'

const baseUrl = 'https://microsoftsales.crm.dynamics.com/api/data/v9.2/'

describe('LiveMsxConnector', () => {
  it('returns distinct active accounts from the signed-in user deal team across pages', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('secret-token')
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_dealteams') && !url.searchParams.has('page')) {
        return json({
          value: [{ _msp_parentopportunityid_value: 'opp-1' }],
          '@odata.nextLink': `${baseUrl}msp_dealteams?page=2`
        })
      }
      if (url.pathname.endsWith('/msp_dealteams')) {
        return json({ value: [
          { _msp_parentopportunityid_value: 'opp-1' },
          { _msp_parentopportunityid_value: 'opp-2' }
        ] })
      }
      if (url.pathname.endsWith('/opportunities')) {
        expect(url.searchParams.get('$filter')).toContain('statecode eq 0')
        return json({ value: [
          { opportunityid: 'opp-1', _parentaccountid_value: 'account-b', name: 'Second opportunity' },
          { opportunityid: 'opp-2', _parentaccountid_value: 'account-a', name: 'First opportunity', msp_activesalesstage: 2, estimatedvalue: 1500000 }
        ] })
      }
      if (url.pathname.endsWith('/accounts')) {
        return json({ value: [
          { accountid: 'account-b', name: 'Beta' },
          { accountid: 'account-a', name: 'Alpha' }
        ] })
      }
      if (url.pathname.endsWith('/msp_engagementmilestones')) {
        expect(url.searchParams.get('$filter')).toBe('statecode eq 0 and _msp_opportunityid_value eq opp-2')
        return json({ value: [{
          msp_engagementmilestoneid: 'milestone-1',
          msp_name: 'Customer pilot',
          _ownerid_value: 'owner-1',
          msp_milestonedate: '2026-10-15',
          msp_milestonestatus: 861980000,
          msp_monthlyuse: 25000
        }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken }, request as typeof fetch)

    await expect(connector.listAccounts()).resolves.toEqual([
      { id: 'account-a', name: 'Alpha', segment: 'Live MSX' },
      { id: 'account-b', name: 'Beta', segment: 'Live MSX' }
    ])
    await expect(connector.listOpportunities('account-a')).resolves.toHaveLength(1)
    const firstContext = await connector.getOpportunityContext('opp-2')
    const secondContext = await connector.getOpportunityContext('opp-2')
    expect(firstContext.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterionId: 'business-case', status: 'partial' }),
      expect.objectContaining({ criterionId: 'customer-outcome', status: 'partial' }),
      expect.objectContaining({ criterionId: 'next-step', status: 'met' })
    ]))
    expect(secondContext.observations).toEqual(firstContext.observations)
    expect(request.mock.calls.filter(([input]) => String(input).includes('msp_engagementmilestones'))).toHaveLength(1)
    expect(getAccessToken).toHaveBeenCalled()
    expect(request.mock.calls.some(([input]) => String(input).includes('secret-token'))).toBe(false)
  })

  it('rejects a continuation URL outside the trusted MSX origin', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      return json({ value: [], '@odata.nextLink': 'https://example.com/steal' })
    })
    const connector = new LiveMsxConnector(
      { getAccessToken: vi.fn().mockResolvedValue('secret-token') },
      request as typeof fetch
    )

    await expect(connector.listAccounts()).rejects.toThrow('untrusted continuation URL')
  })
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}