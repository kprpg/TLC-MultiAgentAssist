import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../packages/connectors/msx/live.js'
import { MemoryPortfolioPreferenceStore } from '../../packages/connectors/common/portfolio-preferences.js'
import { discoverySnapshotVersion } from '../../packages/common/contracts/index.js'
import { ThinSliceOrchestrator } from '../../packages/orchestrator/index.js'

describe('all-domain live Discovery capture', () => {
  it('uses one scoped open-opportunity query, preserves OR classification, pagination and membership, and refreshes current scope', async () => {
    let denied = false
    const transport = vi.fn<typeof fetch>(async (input) => {
      if (denied) return Response.json({}, { status: 403 })
      const url = new URL(String(input))
      const entity = url.pathname.split('/').at(-1)
      if (entity === 'WhoAmI') return Response.json({ UserId: 'synthetic-user' })
      if (entity === 'msp_dealteams') return Response.json({ value: [{ _msp_parentopportunityid_value: 'member' }] })
      if (entity === 'teamtemplates') return Response.json({ value: [] })
      if (entity === 'accounts') return Response.json({ value: [{ accountid: 'account', name: 'Sanitized customer' }] })
      if (entity === 'opportunities') {
        if (url.searchParams.has('$skiptoken')) return Response.json({ value: [
          { opportunityid: 'services', _parentaccountid_value: 'account', name: 'Services', msp_technicalcapability: 861980055 }
        ] })
        if (url.searchParams.get('$select')?.includes('msp_technicalcapability')) return Response.json({
          value: [
            { opportunityid: 'member', _parentaccountid_value: 'account', name: 'Existing', msp_technicalcapability: 861980000, msp_conversation: 884800007, estimatedvalue: -125 },
            { opportunityid: 'conversation-only', _parentaccountid_value: 'account', name: 'Conversation', msp_conversation: 884800008 },
            { opportunityid: 'outside-scope', _parentaccountid_value: 'other-account', name: 'Not accessible', msp_technicalcapability: 861980000 }
          ], '@odata.nextLink': `${url.origin}${url.pathname}?$skiptoken=synthetic-page`
        })
        return Response.json({ value: [{ opportunityid: 'member', _parentaccountid_value: 'account', name: 'Existing' }] })
      }
      throw new Error('Unexpected Discovery snapshot source request.')
    })
    const msx = new LiveMsxConnector({ getAccessToken: async () => 'synthetic' }, transport, undefined, undefined, {},
      new MemoryPortfolioPreferenceStore())
    const core = new ThinSliceOrchestrator(msx, { getStageGuidance: vi.fn() })
    const snapshot = await core.getDiscoverySnapshot({ contractVersion: discoverySnapshotVersion })
    expect(snapshot.opportunities.map((item) => [item.id, item.domain])).toEqual(expect.arrayContaining([
      ['member', 'infra'], ['member', 'data'], ['conversation-only', 'services'], ['services', 'services']
    ]))
    expect(snapshot.opportunities).toHaveLength(4)
    expect(snapshot.opportunities.filter((item) => item.id === 'member').every((item) => item.onDealTeam && item.value === -125)).toBe(true)
    const discoveries = transport.mock.calls.filter(([input]) => new URL(String(input)).searchParams.get('$select')?.includes('msp_technicalcapability'))
    expect(discoveries).toHaveLength(1)
    const filter = new URL(String(discoveries[0]![0])).searchParams.get('$filter')
    expect(filter).toContain('statecode eq 0')
    expect(filter).toContain('_parentaccountid_value eq account')
    expect(filter).not.toContain('msp_technicalcapability')
    expect(transport.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/msp_dealteams'))).toHaveLength(1)
    denied = true
    await expect(core.getDiscoverySnapshot({ contractVersion: discoverySnapshotVersion })).rejects.toMatchObject({ status: 403 })
  })
})
