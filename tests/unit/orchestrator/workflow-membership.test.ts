import { describe, expect, it, vi } from 'vitest'
import { initialWorkflowOutputSchema } from '../../../packages/common/contracts/workflow-output.js'
import { projectWorkflowOutput } from '../../../packages/orchestrator/workflows/membership-projection.js'
import { prepareMemberWorkflowGuidance, readWorkflowResultsView } from '../../../packages/orchestrator/workflows/membership-view.js'
import type { WorkflowHost } from '../../../packages/orchestrator/workflows/host.js'
import { createSampleWorkflowHost } from '../../../packages/orchestrator/workflows/sample-host.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'

const memberships = {
  dealTeamOpportunityIds: ['deal'],
  milestoneTeamOpportunityIds: ['milestone-only'],
  milestoneTeamMilestoneIds: ['member-milestone']
}
const runId = 'c0d0f181-2075-4ebe-b073-2131569cfbc3'

function output() {
  const records = [
    { recordId: 'deal-milestone', kind: 'milestone', opportunityId: 'deal', milestoneId: 'deal-milestone', queueItemId: 'q1', cardIndex: 0 },
    { recordId: 'member-milestone', kind: 'milestone', opportunityId: 'milestone-only', milestoneId: 'member-milestone', queueItemId: 'q2', cardIndex: 1 },
    { recordId: 'sibling', kind: 'milestone', opportunityId: 'milestone-only', milestoneId: 'sibling', queueItemId: 'q3', cardIndex: 2 },
    { recordId: 'unrelated', kind: 'milestone', opportunityId: 'other', milestoneId: 'unrelated', queueItemId: 'q4', cardIndex: 3 }
  ]
  return initialWorkflowOutputSchema.parse({
    contractVersion: '2.0', workflowId: 'WF-005', generatedAt: '2026-10-27T00:00:00.000Z',
    scope: { kind: 'portfolio' },
    card: { kind: 'exception-list', title: 'Review risk', evidenceIds: ['call'],
      exceptions: records.map((record) => ({ id: record.queueItemId, title: record.recordId, detail: 'Verify evidence', priority: 'P1', evidenceIds: ['call'] })) },
    queueItems: records.map((record) => ({
      id: record.queueItemId, workflowId: 'WF-005', priority: 'P1', title: record.recordId,
      accountId: 'account', opportunityId: record.opportunityId, evidenceIds: ['call'], status: 'new'
    })),
    projection: { records },
    lineage: [{ connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'call' }],
    sourceHealth: [{ source: 'dataverse-mcp', state: 'partial', detail: 'Bounded source results', checkedAt: '2026-10-27T00:00:00.000Z' }]
  })
}

describe('membership-aware Play result projection', () => {
  it('uses the parent Deal Team OR the exact milestone, not a sibling membership', () => {
    const raw = output()
    const view = projectWorkflowOutput(raw, 'mine', memberships)
    expect(view.state).toBe('ready')
    expect(view.output?.queueItems.map((item) => item.id)).toEqual(['q1', 'q2'])
    expect(view.output?.card).toMatchObject({ exceptions: [{ id: 'q1' }, { id: 'q2' }] })
    expect(view).toMatchObject({ totalItems: 4, visibleItems: 2 })
    expect(view.eligibility.find((item) => item.queueItemId === 'q3')).toMatchObject({ eligible: false })
    expect(view.output?.lineage).toEqual(raw.lineage)
    expect(view.output?.sourceHealth).toEqual(raw.sourceHealth)
  })

  it('restores the original full result in All without mutating the snapshot', () => {
    const raw = output()
    const before = structuredClone(raw)
    projectWorkflowOutput(raw, 'mine', memberships)
    const all = projectWorkflowOutput(raw, 'all', memberships)
    expect(all.output).toEqual(before)
    expect(raw).toEqual(before)
    expect(all.visibleItems).toBe(4)
    expect(all.eligibility.filter((item) => !item.eligible)).toHaveLength(2)
    expect(all.eligibility.every((item) => item.eligible || item.reason.length > 0)).toBe(true)
  })

  it('includes opportunity and activity items for milestone-only members', () => {
    const raw = output()
    raw.projection!.records = raw.projection!.records.map((record) => {
      const opportunity = { ...record, kind: 'opportunity' as const }
      delete opportunity.milestoneId
      return opportunity
    })
    const view = projectWorkflowOutput(raw, 'mine', memberships)
    expect(view.output?.queueItems.map((item) => item.id)).toEqual(['q1', 'q2', 'q3'])
  })

  it.each(['record-table', 'timeline', 'action-list'] as const)('filters %s using typed references', (kind) => {
    const raw = output()
    raw.card = kind === 'record-table'
      ? { kind, title: 'Records', evidenceIds: ['call'], columns: ['name'], rows: ['deal', 'member', 'sibling', 'other'].map((name) => ({ name })) }
      : kind === 'timeline'
        ? { kind, title: 'Events', evidenceIds: ['call'], events: ['deal', 'member', 'sibling', 'other'].map((label) => ({ label, at: raw.generatedAt })) }
        : { kind, title: 'Actions', evidenceIds: ['call'], actions: raw.queueItems.map((item) => ({ id: item.id, label: item.title, priority: item.priority })) }
    const card = projectWorkflowOutput(raw, 'mine', memberships).output?.card
    if (card?.kind === 'record-table') expect(card.rows).toEqual([{ name: 'deal' }, { name: 'member' }])
    else if (card?.kind === 'timeline') expect(card.events.map((event) => event.label)).toEqual(['deal', 'member'])
    else if (card?.kind === 'action-list') expect(card.actions.map((item) => item.id)).toEqual(['q1', 'q2'])
    else throw new Error('Expected the projected card.')
  })

  it('does not present a failed membership read as an empty or full My result', () => {
    const raw = output()
    const mine = projectWorkflowOutput(raw, 'mine')
    expect(mine).toMatchObject({ state: 'unavailable', visibleItems: 0 })
    expect(mine.output).toBeUndefined()
    expect(mine.message).toContain('membership')
    const all = projectWorkflowOutput(raw, 'all')
    expect(all.output).toEqual(raw)
    expect(all.eligibility.every((item) => !item.eligible)).toBe(true)
  })

  it('preserves legacy All results and asks for a fresh run for unverifiable My results', () => {
    const legacy = output()
    delete legacy.projection
    const raw = initialWorkflowOutputSchema.parse({ ...legacy, contractVersion: '1.0' })
    expect(projectWorkflowOutput(raw, 'all', memberships).output).toEqual(raw)
    const mine = projectWorkflowOutput(raw, 'mine', memberships)
    expect(mine.state).toBe('legacy')
    expect(mine.output).toBeUndefined()
    expect(mine.message).toMatch(/run.*again/i)
  })

  it('requires projection metadata for version 2 and rejects it on legacy output', () => {
    const raw = output()
    const missing = structuredClone(raw)
    delete missing.projection
    expect(initialWorkflowOutputSchema.safeParse(missing).success).toBe(false)
    expect(initialWorkflowOutputSchema.safeParse({ ...raw, contractVersion: '1.0' }).success).toBe(false)
  })

  it('recomputes concentration metrics from member opportunities', () => {
    const raw = output()
    raw.workflowId = 'WF-008'
    raw.card = { kind: 'metric-strip', title: 'Concentration', evidenceIds: ['call'], metrics: [{ label: 'Pipeline opportunities', value: 4 }] }
    raw.projection!.records = raw.projection!.records.map((record, index) => ({
      ...record, kind: 'opportunity', accountId: index === 0 ? 'a' : 'b'
    }))
    const card = projectWorkflowOutput(raw, 'mine', memberships).output?.card
    expect(card).toMatchObject({ metrics: [
      { label: 'Pipeline opportunities', value: 3 },
      { label: 'Accounts', value: 2 },
      { label: 'Top account share %', value: 67 }
    ] })
  })

  it('uses original owner-load parameters rather than filtering already-aggregated counts', () => {
    const raw = output()
    raw.workflowId = 'WF-009'
    raw.projection = { maximumActiveItems: 2, records: Array.from({ length: 5 }, (_, index) => ({
      kind: 'opportunity', recordId: String(index), opportunityId: index < 3 ? 'deal' : 'other', ownerId: 'owner', ownerName: 'Sample owner', cardIndex: index
    })) }
    raw.queueItems = [{ id: 'WF-009:owner', workflowId: 'WF-009', priority: 'P1', title: 'Sample owner owns 5 active opportunities', evidenceIds: ['call'], status: 'new' }]
    raw.card = { kind: 'metric-strip', title: 'Workload', evidenceIds: ['call'], metrics: [{ label: 'Active opportunities', value: 5 }] }
    const view = projectWorkflowOutput(raw, 'mine', memberships)
    expect(view.output?.queueItems[0]?.title).toBe('Sample owner owns 3 active opportunities')
    expect(view.output?.card).toMatchObject({ metrics: [{ label: 'Overloaded owners', value: 1 }, { label: 'Active opportunities', value: 3 }] })
  })

  it('rechecks membership before preparing queue Guidance and never calls a model', async () => {
    const raw = output()
    const prepareGuidance = vi.fn<WorkflowHost['prepareGuidance']>()
    const host = { get: () => ({ output: raw }), prepareGuidance }
    const request = { contractVersion: '1.0', runId, queueItemId: 'q3', capability: 'mcem-coach' }
    await expect(prepareMemberWorkflowGuidance(host, async () => memberships, request)).rejects.toThrow(/member/i)
    expect(prepareGuidance).not.toHaveBeenCalled()
    await prepareMemberWorkflowGuidance(host, async () => memberships, { ...request, queueItemId: 'q2' })
    expect(prepareGuidance).toHaveBeenCalledOnce()
  })

  it('reports source errors explicitly while keeping All results visible', async () => {
    const host = { get: () => ({ output: output() }) }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const read = vi.fn(async () => { throw new Error('Source offline') })
      const view = await readWorkflowResultsView(host, read, { contractVersion: '1.0', runId, filter: 'all' })
      expect(view.state).toBe('unavailable')
      expect(view.output?.queueItems).toHaveLength(4)
      expect(warn).toHaveBeenCalledWith('[workflow-membership] read-unavailable')
    } finally { warn.mockRestore() }
  })

  it('the real sample assembler preserves typed milestone references', async () => {
    const host = createSampleWorkflowHost()
    const run = host.start({ contractVersion: '1.0', workflowId: 'WF-002', scope: { kind: 'portfolio' }, input: { asOf: '2026-10-27' } })
    await vi.waitFor(() => expect(host.get({ contractVersion: '1.0', runId: run.runId }).run.status).toBe('completed'))
    const raw = host.get({ contractVersion: '1.0', runId: run.runId }).output
    expect(raw).toMatchObject({ contractVersion: '2.0', projection: { records: [{ kind: 'milestone', milestoneId: 'milestone-grid', opportunityId: 'opp-grid-modernization' }] } })
  })

  it('fixture and SQLite membership snapshots reflect independent joins and removals', async () => {
    const store = new LocalStore()
    try {
      for (const connector of [new FixtureMsxConnector(), new LocalStoreMsxConnector(store)]) {
        const milestone = (await connector.listMilestones('opp-grid-modernization'))[0]!
        await connector.joinMilestoneTeam('opp-grid-modernization', milestone.id)
        await connector.leaveDealTeam('opp-grid-modernization')
        const snapshot = await connector.getTeamMemberships()
        expect(snapshot.dealTeamOpportunityIds).not.toContain('opp-grid-modernization')
        expect(snapshot.milestoneTeamOpportunityIds).toContain('opp-grid-modernization')
        expect(snapshot.milestoneTeamMilestoneIds).toContain(milestone.id)
        await connector.leaveMilestoneTeam('opp-grid-modernization', milestone.id)
        expect((await connector.getTeamMemberships()).milestoneTeamMilestoneIds).not.toContain(milestone.id)
      }
    } finally { store.close() }
  })
})
