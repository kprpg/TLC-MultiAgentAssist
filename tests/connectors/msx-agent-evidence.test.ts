import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../packages/connectors/msx/live.js'
import { commentHistoryEntries, parseCommentHistoryRows, plainText } from '../../packages/connectors/msx/evidence.js'

const opportunityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const milestoneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const authorId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const formatted = '@OData.Community.Display.V1.FormattedValue'

function harness(options: { historyStatus?: number; notesStatus?: number } = {}) {
  const request = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    const select = url.searchParams.get('$select') ?? ''
    if (url.pathname.endsWith('/WhoAmI')) return Response.json({ UserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
    if (url.pathname.endsWith('/msp_dealteams')) {
      return Response.json({ value: select.includes('_msp_dealteamuserid_value')
        ? [{ [`_msp_dealteamuserid_value${formatted}`]: 'Dana Seller' }]
        : [{ _msp_parentopportunityid_value: opportunityId }] })
    }
    if (url.pathname.endsWith(`/opportunities(${opportunityId})`)) {
      if (select === 'msp_forecastcommentsjsonfield') {
        if (options.historyStatus) return Response.json({}, { status: options.historyStatus })
        return Response.json({ msp_forecastcommentsjsonfield: JSON.stringify([
          { userId: authorId, modifiedOn: '2026-10-01T10:00:00Z', comment: 'Customer asked for a security review.' },
          { userId: authorId, modifiedOn: '2026-10-15T10:00:00Z', comment: '<p>Security review booked &amp; scheduled.</p>' }
        ]) })
      }
      return Response.json({
        description: 'Customer needs a governed AI platform.', createdon: '2026-01-02T00:00:00Z', modifiedon: '2026-10-16T00:00:00Z',
        [`msp_solutionarea${formatted}`]: 'Cloud and AI Platforms', [`msp_technicalcapability${formatted}`]: 'Azure AI'
      })
    }
    if (url.pathname.endsWith('/opportunities')) {
      return Response.json({ value: [{ opportunityid: opportunityId, _parentaccountid_value: accountId, name: 'Sanitized opportunity', estimatedvalue: 100, msp_activesalesstage: 3 }] })
    }
    if (url.pathname.endsWith('/accounts')) return Response.json({ value: [{ accountid: accountId, name: 'Sanitized account' }] })
    if (url.pathname.endsWith('/annotations')) {
      if (options.notesStatus) return Response.json({}, { status: options.notesStatus })
      return Response.json({ value: [{ subject: 'Call notes', notetext: 'Sponsor confirmed budget.', createdon: '2026-10-10T00:00:00Z', [`_createdby_value${formatted}`]: 'Sam SE' }] })
    }
    if (url.pathname.endsWith('/activitypointers')) {
      return Response.json({ value: [{ activityid: 'act-1', subject: 'Executive briefing', description: 'Agenda agreed.', statecode: 1, createdon: '2026-10-12T00:00:00Z', [`activitytypecode${formatted}`]: 'Appointment' }] })
    }
    if (url.pathname.endsWith('/msp_engagementmilestones')) {
      return Response.json({ value: [{
        msp_engagementmilestoneid: milestoneId, msp_name: 'Pilot', msp_milestonedate: '2026-11-01',
        msp_forecastcommentsjsonfield: JSON.stringify([{ userId: authorId, modifiedOn: '2026-10-14T00:00:00Z', comment: 'Pilot environment ready.' }])
      }] })
    }
    if (url.pathname.endsWith('/tasks')) {
      return Response.json({ value: [{ activityid: 'task-1', _regardingobjectid_value: milestoneId, subject: 'Run workshop', description: 'Two-day workshop.', statecode: 0, createdon: '2026-10-13T00:00:00Z' }] })
    }
    if (url.pathname.endsWith('/systemusers')) return Response.json({ value: [{ systemuserid: authorId, fullname: 'Alex AE' }] })
    if (url.pathname.endsWith('/teamtemplates')) return Response.json({ value: [] })
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
  const connector = new LiveMsxConnector({ getAccessToken: async () => 'synthetic-token' }, request)
  return { connector, request }
}

describe('MSX agent evidence', () => {
  it('reads comment history, notes, activities, milestone tasks, and details beyond the portfolio rows', async () => {
    const { connector } = harness()
    const evidence = await connector.getOpportunityEvidence(opportunityId)

    expect(evidence.gaps).toEqual([])
    expect(evidence.sourceHealth.state).toBe('live')
    expect(evidence.details).toMatchObject({
      need: 'Customer needs a governed AI platform.', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Azure AI', dealTeam: ['Dana Seller']
    })
    expect(evidence.commentHistory.map((entry) => entry.text)).toEqual(['Security review booked & scheduled.', 'Customer asked for a security review.'])
    expect(evidence.commentHistory[0]).toMatchObject({ author: 'Alex AE', at: '2026-10-15T10:00:00.000Z' })
    expect(evidence.notes).toEqual([expect.objectContaining({ kind: 'note', subject: 'Call notes', text: 'Sponsor confirmed budget.', author: 'Sam SE' })])
    expect(evidence.activities).toEqual([expect.objectContaining({ subject: 'Appointment: Executive briefing', status: 'Completed', text: 'Agenda agreed.' })])
    expect(evidence.milestones).toEqual([expect.objectContaining({
      milestoneId,
      commentHistory: [expect.objectContaining({ text: 'Pilot environment ready.' })],
      activities: [expect.objectContaining({ subject: 'Run workshop', status: 'Open' })]
    })])
  })

  it('keeps every other source when one read fails and names the gap', async () => {
    const { connector } = harness({ notesStatus: 403 })
    const evidence = await connector.getOpportunityEvidence(opportunityId)
    expect(evidence.notes).toEqual([])
    expect(evidence.gaps).toEqual(['Opportunity notes could not be read (HTTP 403).'])
    expect(evidence.sourceHealth.state).toBe('partial')
    expect(evidence.commentHistory).toHaveLength(2)
    expect(evidence.milestones[0]?.activities).toHaveLength(1)
  })

  it('treats a missing comment-history column as optional rather than a gap', async () => {
    const { connector } = harness({ historyStatus: 400 })
    const evidence = await connector.getOpportunityEvidence(opportunityId)
    expect(evidence.commentHistory).toEqual([])
    expect(evidence.gaps).toEqual([])
  })

  it('refuses opportunities outside the signed-in portfolio and malformed ids', async () => {
    const { connector } = harness()
    await expect(connector.getOpportunityEvidence('not-a-guid')).rejects.toThrow('valid MSX GUID')
    await expect(connector.getOpportunityEvidence('ffffffff-ffff-4fff-8fff-ffffffffffff')).rejects.toThrow('active MSX portfolio')
  })
})

describe('MSX evidence text helpers', () => {
  it('collapses rich text and control characters', () => {
    expect(plainText('<div>Line&nbsp;one</div><br/>Line\u0007 two &lt;ok&gt;')).toBe('Line one\nLine two <ok>')
    expect(plainText('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}…`)
    expect(plainText(undefined)).toBe('')
  })

  it('parses only well-formed comment history rows, newest first', () => {
    expect(parseCommentHistoryRows('not json')).toEqual([])
    expect(parseCommentHistoryRows(null)).toEqual([])
    const rows = parseCommentHistoryRows(JSON.stringify([{ comment: '  ' }, 4, { comment: 'old', modifiedOn: '2026-01-01T00:00:00Z' }, { comment: 'new', modifiedOn: '2026-02-01T00:00:00Z' }]))
    expect(commentHistoryEntries(rows, () => undefined, 5).map((entry) => entry.text)).toEqual(['new', 'old'])
  })
})
