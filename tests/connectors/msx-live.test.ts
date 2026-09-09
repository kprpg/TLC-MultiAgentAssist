import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector, msxWriteMetadataFromEnvironment } from '../../packages/connectors/msx/index.js'

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
        return json({
          value: [
            { _msp_parentopportunityid_value: 'opp-1' },
            { _msp_parentopportunityid_value: 'opp-2' }
          ]
        })
      }
      if (url.pathname.endsWith('/opportunities')) {
        expect(url.searchParams.get('$filter')).toContain('statecode eq 0')
        return json({
          value: [
            {
              opportunityid: 'opp-1',
              _parentaccountid_value: 'account-b',
              '_ownerid_value@OData.Community.Display.V1.FormattedValue': 'Morgan Lee',
              name: 'Second opportunity',
              estimatedvalue: 0,
              msp_consumptionconsumedrecurring: 275000,
              description: null
            },
            { opportunityid: 'opp-2', _parentaccountid_value: 'account-a', name: 'First opportunity', msp_activesalesstage: 2, estimatedvalue: 1500000, description: null }
          ]
        })
      }
      if (url.pathname.endsWith('/accounts')) {
        return json({
          value: [
            { accountid: 'account-b', name: 'Beta' },
            { accountid: 'account-a', name: 'Alpha' }
          ]
        })
      }
      if (url.pathname.endsWith('/msp_engagementmilestones')) {
        expect(url.searchParams.get('$filter')).toBe('statecode eq 0 and _msp_opportunityid_value eq opp-2')
        return json({
          value: [{
            msp_engagementmilestoneid: 'milestone-1',
            msp_name: 'Customer pilot',
            _ownerid_value: 'owner-1',
            '_ownerid_value@OData.Community.Display.V1.FormattedValue': 'Taylor Kim',
            msp_milestonedate: '2026-10-15',
            msp_milestonestatus: 861980000,
            'msp_milestonestatus@OData.Community.Display.V1.FormattedValue': 'On track',
            'msp_commitmentrecommendation@OData.Community.Display.V1.FormattedValue': 'Committed',
            msp_monthlyuse: 25000,
            msp_forecastcomments: null
          }]
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken }, request as typeof fetch)

    await expect(connector.listAccounts()).resolves.toEqual([
      { id: 'account-a', name: 'Alpha', segment: 'Live MSX' },
      { id: 'account-b', name: 'Beta', segment: 'Live MSX' }
    ])
    await expect(connector.listOpportunities('account-a')).resolves.toHaveLength(1)
    await expect(connector.listOpportunities('account-b')).resolves.toEqual([
      expect.objectContaining({ id: 'opp-1', owner: 'Morgan Lee', value: 275000 })
    ])
    expect((await connector.listOpportunities('account-b'))[0]).not.toHaveProperty('comments')
    await expect(connector.listMilestones('opp-2')).resolves.toEqual([{
      id: 'milestone-1',
      opportunityId: 'opp-2',
      name: 'Customer pilot',
      status: 'On track',
      targetDate: '2026-10-15',
      estimatedMonthlyUsage: 25000,
      owner: 'Taylor Kim',
      commitment: 'Committed'
    }])
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

  it('updates only requested milestone and opportunity fields with strict PATCH requests', async () => {
    let comments = 'Original opportunity comment'
    let milestoneRead = 0
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (init?.method === 'PATCH') {
        expect(new Headers(init.headers).get('If-Match')).toBe('*')
        if (url.pathname.endsWith('/msp_engagementmilestones(milestone-1)')) {
          expect(JSON.parse(String(init.body))).toEqual({
            msp_milestonestatus: 861980001,
            msp_riskblockerdetails: 'Sponsor approval is late.',
            msp_milestonedate: '2026-11-20',
            msp_commitmentrecommendation: 861980003,
            msp_forecastcomments: 'Reviewed with the account team.'
          })
        } else if (url.pathname.endsWith('/opportunities(opp-1)')) {
          expect(JSON.parse(String(init.body))).toEqual({ description: 'Updated opportunity comment' })
          comments = 'Updated opportunity comment'
        } else {
          throw new Error(`Unexpected PATCH: ${url}`)
        }
        return new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_dealteams')) return json({ value: [{ _msp_parentopportunityid_value: 'opp-1' }] })
      if (url.pathname.endsWith('/opportunities')) return json({ value: [{ opportunityid: 'opp-1', _parentaccountid_value: 'account-1', name: 'Opportunity', estimatedvalue: 100, description: comments }] })
      if (url.pathname.endsWith('/accounts')) return json({ value: [{ accountid: 'account-1', name: 'Account' }] })
      if (url.pathname.endsWith('/msp_engagementmilestones')) {
        milestoneRead += 1
        return json({
          value: [{
            msp_engagementmilestoneid: 'milestone-1',
            msp_name: 'Milestone',
            msp_milestonedate: milestoneRead === 1 ? '2026-10-15' : '2026-11-20',
            msp_riskblockerdetails: milestoneRead === 1 ? '' : 'Sponsor approval is late.',
            msp_forecastcomments: milestoneRead === 1 ? '' : 'Reviewed with the account team.',
            'msp_milestonestatus@OData.Community.Display.V1.FormattedValue': milestoneRead === 1 ? 'On Track' : 'At Risk',
            'msp_commitmentrecommendation@OData.Community.Display.V1.FormattedValue': milestoneRead === 1 ? 'Uncommitted' : 'Committed'
          }]
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector(
      { getAccessToken: vi.fn().mockResolvedValue('secret-token') },
      request as typeof fetch,
      undefined,
      undefined,
      { riskDetailsField: 'msp_riskblockerdetails' }
    )

    await expect(connector.updateMilestone('opp-1', 'milestone-1', {
      status: 'At Risk',
      riskDetails: 'Sponsor approval is late.',
      targetDate: '2026-11-20',
      customerCommitment: 'Committed',
      comments: 'Reviewed with the account team.'
    })).resolves.toEqual(expect.objectContaining({
      status: 'At Risk',
      targetDate: '2026-11-20',
      commitment: 'Committed',
      riskDetails: 'Sponsor approval is late.',
      comments: 'Reviewed with the account team.'
    }))
    await expect(connector.updateOpportunity('opp-1', { comments: 'Updated opportunity comment' }))
      .resolves.toEqual(expect.objectContaining({ comments: 'Updated opportunity comment' }))
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(2)
  })

  it('writes configured tenant stage codes and refuses unconfigured live stage writes', async () => {
    let activeStage = 2
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (init?.method === 'PATCH') {
        expect(url.pathname).toMatch(/\/opportunities\(opp-1\)$/)
        expect(new Headers(init.headers).get('If-Match')).toBe('*')
        expect(JSON.parse(String(init.body))).toEqual({
          msp_activesalesstage: 861980013,
          description: 'Advanced from Stage 2 to Stage 3. Gates passed.'
        })
        activeStage = 3
        return new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_dealteams')) return json({ value: [{ _msp_parentopportunityid_value: 'opp-1' }] })
      if (url.pathname.endsWith('/opportunities')) return json({ value: [{ opportunityid: 'opp-1', _parentaccountid_value: 'account-1', name: 'Opportunity', msp_activesalesstage: activeStage, estimatedvalue: 100 }] })
      if (url.pathname.endsWith('/accounts')) return json({ value: [{ accountid: 'account-1', name: 'Account' }] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector(
      { getAccessToken: vi.fn().mockResolvedValue('secret-token') },
      request as typeof fetch,
      undefined,
      undefined,
      { stageCodes: { 3: 861980013 } }
    )

    await expect(connector.updateOpportunityStage('opp-1', 3, 'Advanced from Stage 2 to Stage 3. Gates passed.'))
      .resolves.toEqual(expect.objectContaining({ id: 'opp-1', recordedStage: 3 }))
    await expect(connector.updateOpportunityStage('opp-1', 4, 'Advance again.'))
      .rejects.toThrow('TLC_MSX_STAGE_4')
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
  })

  it('exports and parses tenant-specific write metadata from the connector entry point', () => {
    expect(msxWriteMetadataFromEnvironment({
      TLC_MSX_RISK_DETAILS_FIELD: 'msp_verifiedriskdetails',
      TLC_MSX_STATUS_LOST_TO_COMPETITOR: '861980005',
      TLC_MSX_STATUS_HYGIENE_DUPLICATE: '861980006',
      TLC_MSX_STAGE_1: '861980011',
      TLC_MSX_STAGE_5: '861980015'
    })).toEqual({
      riskDetailsField: 'msp_verifiedriskdetails',
      milestoneStatusCodes: {
        'Lost to Competitor': 861980005,
        'Hygiene/Duplicate': 861980006
      },
      stageCodes: { 1: 861980011, 5: 861980015 }
    })
  })
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}