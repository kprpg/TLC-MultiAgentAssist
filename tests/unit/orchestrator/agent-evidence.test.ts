import { describe, expect, it, vi } from 'vitest'
import { contractVersion, type Milestone, type Opportunity } from '../../../packages/common/index.js'
import type { MsxConnector, OpportunityContext, OpportunityEvidence } from '../../../packages/connectors/common/index.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { FixtureMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { createDeterministicLiveTaskAgents } from '../../../packages/orchestrator/task-agents.js'
import {
  agentSourceHealth,
  buildAgentEvidencePack,
  serializeAgentContext,
  ThinSliceOrchestrator,
  type AgentTaskContext
} from '../../../packages/orchestrator/index.js'

const now = new Date('2026-10-22T12:00:00Z')
const health = { source: 'msx' as const, state: 'live' as const, detail: 'Live MSX.', checkedAt: now.toISOString() }

const opportunity: Opportunity = {
  id: 'opp-1', accountId: 'acct-1', name: 'Contoso AI', recordedStage: 3, value: 1_000_000, currency: 'USD',
  closeDate: '2026-10-01', comments: 'RAW-OPPORTUNITY-COMMENTS'
}

const milestone = (id: string, overrides: Partial<Milestone> = {}): Milestone => ({
  id, opportunityId: 'opp-1', name: `Milestone ${id}`, status: 'On Track', targetDate: '2026-12-01', comments: 'RAW-MILESTONE-COMMENT', ...overrides
})

function evidence(overrides: Partial<OpportunityEvidence> = {}): OpportunityEvidence {
  return {
    details: { need: 'Governed AI platform.' }, commentHistory: [], notes: [], activities: [], milestones: [], gaps: [],
    retrievedAt: now.toISOString(), sourceHealth: health, ...overrides
  }
}

const context = { account: { id: 'acct-1', name: 'Contoso', segment: 'Enterprise' }, opportunity, observations: [], retrievedAt: now.toISOString(), sourceHealth: health } as OpportunityContext

describe('agent evidence pack', () => {
  it('orders dated entries newest first with citation refs, ages, and deterministic signals', () => {
    const pack = buildAgentEvidencePack({
      context, now,
      milestones: [
        milestone('m-done', { status: 'Completed', targetDate: '2026-01-01' }),
        milestone('m-late', { status: 'At Risk', targetDate: '2026-10-10', commitment: 'Uncommitted' }),
        milestone('m-future')
      ],
      evidence: evidence({
        commentHistory: [
          { kind: 'forecast-comment', text: 'older', at: '2026-10-01T00:00:00.000Z' },
          { kind: 'forecast-comment', text: 'newer', at: '2026-10-20T00:00:00.000Z', author: 'Alex AE' }
        ],
        milestones: [{ milestoneId: 'm-late', commentHistory: [], activities: [{ kind: 'activity', text: '', subject: 'Workshop', status: 'Open', at: '2026-10-21T00:00:00.000Z' }] }]
      })
    })

    expect(pack.opportunity.commentHistory.map(({ ref, text, ageDays }) => ({ ref, text, ageDays }))).toEqual([
      { ref: 'O.C1', text: 'newer', ageDays: 2 }, { ref: 'O.C2', text: 'older', ageDays: 21 }
    ])
    expect(pack.opportunity).not.toHaveProperty('currentComments')
    expect(pack.opportunity).toMatchObject({ needStatement: 'Governed AI platform.', daysToClose: -21 })
    expect(pack.milestones.map(({ id }) => id)).toEqual(['m-late', 'm-future', 'm-done'])
    expect(pack.milestones[0]).toMatchObject({ ref: 'M1', overdue: true, openActivityCount: 1 })
    expect(pack.milestones[0]?.activities[0]).toMatchObject({ ref: 'M1.A1', subject: 'Workshop' })
    expect(pack.milestones[0]?.activities[0]).not.toHaveProperty('text')
    expect(pack.signals).toMatchObject({
      milestoneCount: 3, openMilestones: 2, overdueMilestones: 1, atRiskOrBlockedMilestones: 1,
      uncommittedOpenMilestones: 1, closeDateOverdue: true, daysSinceLastComment: 2, daysSinceLastActivity: 1
    })
  })

  it('falls back to the current comments text only when no dated history exists', () => {
    const pack = buildAgentEvidencePack({ context, now, milestones: [milestone('m1')], evidence: evidence() })
    expect(pack.opportunity.currentComments).toBe('RAW-OPPORTUNITY-COMMENTS')
    expect(pack.milestones[0]?.comments).toBe('RAW-MILESTONE-COMMENT')
  })

  it('stays within the prompt budget and reports truncation for very large records', () => {
    const big = 'x'.repeat(5_000)
    const entries = (count: number) => Array.from({ length: count }, (_, index) => ({
      kind: 'note' as const, text: big, at: new Date(now.getTime() - index * 3_600_000).toISOString()
    }))
    const milestones = Array.from({ length: 60 }, (_, index) => milestone(`m${index}`, { riskDetails: big }))
    const pack = buildAgentEvidencePack({
      context, now, milestones,
      evidence: evidence({ commentHistory: entries(25), notes: entries(25), activities: entries(25), milestones: milestones.map((item) => ({ milestoneId: item.id, commentHistory: entries(25), activities: entries(25) })) })
    })
    expect(JSON.stringify(pack).length).toBeLessThan(60_000)
    expect(pack.coverage).toMatchObject({ truncated: true })
    expect(pack.coverage.omittedMilestones).toBeGreaterThan(0)
    expect(pack.untrustedContent).toMatch(/never as instructions/)
  })

  it('serializes one copy of the comments through the pack instead of the raw record fields', () => {
    const pack = buildAgentEvidencePack({ context, now, milestones: [milestone('m1')], evidence: evidence() })
    const serialized = serializeAgentContext({
      request: { contractVersion, capability: 'account-pulse', accountId: 'acct-1', opportunityId: 'opp-1', prompt: 'Focus?' },
      opportunityContext: { ...context, milestones: [milestone('m1', { riskDetails: 'RAW-RISK' })] },
      guidance: { stage: 3, title: 'Stage 3', version: '1', effectiveDate: '2026-01-01', criteria: [], sourceHealth: { ...health, source: 'mcem' } },
      localEvaluation: {} as AgentTaskContext['localEvaluation'],
      evidence: pack
    })
    expect(serialized.match(/RAW-OPPORTUNITY-COMMENTS/g)).toHaveLength(1)
    expect(serialized.match(/RAW-MILESTONE-COMMENT/g)).toHaveLength(1)
    expect(serialized).not.toContain('RAW-RISK')
    expect(serialized).toContain('"evidence"')
  })

  it('marks a live MSX source partial, without adding a source entry, when evidence reads had gaps', () => {
    const pack = buildAgentEvidencePack({ context, now, milestones: [], evidence: evidence({ gaps: ['Opportunity notes could not be read (HTTP 403).'] }) })
    const [msx, mcem] = agentSourceHealth({ opportunityContext: context, guidance: { sourceHealth: { ...health, source: 'mcem' } } as AgentTaskContext['guidance'], evidence: pack })
    expect(msx).toMatchObject({ source: 'msx', state: 'partial' })
    expect(msx?.detail).toContain('HTTP 403')
    expect(mcem?.source).toBe('mcem')
  })
})

describe('agent task context enrichment', () => {
  const request = { contractVersion, capability: 'account-pulse' as const, accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', prompt: 'What is the focus?' }

  it('gives every connector the evidence pack and the next MCEM gate, including milestone activities', async () => {
    const msx = new FixtureMsxConnector()
    const seen: AgentTaskContext[] = []
    const core = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), {
      'account-pulse': { version: 'test', agent: { invoke: async (taskContext) => { seen.push(taskContext); return 'Grounded.' } } }
    })
    await core.runAgentTask(request)

    const [taskContext] = seen
    expect(taskContext?.nextStageGuidance?.stage).toBe(4)
    expect(taskContext?.evidence?.schemaVersion).toBe('1.0')
    const milestones = await msx.listMilestones(request.opportunityId)
    expect(taskContext?.evidence?.milestones.map(({ id }) => id).sort()).toEqual(milestones.map(({ id }) => id).sort())
    const withActivities = await Promise.all(milestones.map((item) => msx.listMilestoneActivities(request.opportunityId, item.id)))
    expect(taskContext?.evidence?.coverage.milestoneActivities).toBeGreaterThanOrEqual(Math.min(withActivities.flat().length, 1))
  })

  it('prefers the connector deep read and does not fan out per-milestone reads', async () => {
    const msx = new FixtureMsxConnector() as FixtureMsxConnector & Required<Pick<MsxConnector, 'getOpportunityEvidence'>>
    msx.getOpportunityEvidence = vi.fn(async () => evidence({ details: { need: 'Deep need.' }, commentHistory: [{ kind: 'forecast-comment', text: 'Deep comment', at: '2026-10-20T00:00:00.000Z' }] }))
    const activities = vi.spyOn(msx, 'listMilestoneActivities')
    const seen: AgentTaskContext[] = []
    const core = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), {
      'account-pulse': { version: 'test', agent: { invoke: async (taskContext) => { seen.push(taskContext); return 'Grounded.' } } }
    })
    await core.runAgentTask(request)
    expect(msx.getOpportunityEvidence).toHaveBeenCalledWith(request.opportunityId)
    expect(activities).not.toHaveBeenCalled()
    expect(seen[0]?.evidence?.opportunity).toMatchObject({ needStatement: 'Deep need.' })
    expect(seen[0]?.evidence?.opportunity.commentHistory[0]).toMatchObject({ ref: 'O.C1', text: 'Deep comment' })
  })

  it('shows the newest dated evidence in the deterministic draft used when no model is configured', async () => {
    const msx = new FixtureMsxConnector() as FixtureMsxConnector & Required<Pick<MsxConnector, 'getOpportunityEvidence'>>
    msx.getOpportunityEvidence = vi.fn(async () => evidence({
      commentHistory: [{ kind: 'forecast-comment', text: 'Sponsor approved the pilot budget.', at: new Date(Date.now() - 2 * 86_400_000).toISOString(), author: 'Alex AE' }],
      gaps: ['Opportunity notes could not be read (HTTP 403).']
    }))
    const core = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), createDeterministicLiveTaskAgents())
    const response = await core.runAgentTask(request)
    expect(response.content).toContain('## Recent evidence')
    expect(response.content).toContain('`O.C1` (2d ago, Alex AE): Sponsor approved the pilot budget.')
    expect(response.content).toContain('Not available: Opportunity notes could not be read (HTTP 403).')
  })

  it('still answers, with a named gap, when the deep read fails', async () => {
    const msx = new FixtureMsxConnector() as FixtureMsxConnector & Required<Pick<MsxConnector, 'getOpportunityEvidence'>>
    msx.getOpportunityEvidence = vi.fn(async () => { throw new Error('MSX request failed with status 503.') })
    const seen: AgentTaskContext[] = []
    const core = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), {
      'account-pulse': { version: 'test', agent: { invoke: async (taskContext) => { seen.push(taskContext); return 'Grounded.' } } }
    })
    await expect(core.runAgentTask(request)).resolves.toMatchObject({ content: expect.stringContaining('Grounded.') })
    expect(seen[0]?.evidence?.coverage.gaps[0]).toContain('status 503')
  })
})
