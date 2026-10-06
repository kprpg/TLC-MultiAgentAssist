import { describe, expect, it } from 'vitest'
import { evaluateMcemProgress } from '../../../packages/agents/mcem-coach/index.js'
import {
  milestoneRecommendations,
  summarizeMilestones
} from '../../../packages/agents/mcem-coach/src/milestone-signals.js'
import { mcemResponseSchema } from '../../../packages/common/index.js'
import type { OpportunityContext, StageGuidance } from '../../../packages/connectors/common/index.js'

const guidance: StageGuidance = {
  stage: 3,
  title: 'MCEM Stage 3',
  version: '1.0.0',
  effectiveDate: '2026-01-01',
  criteria: [
    { id: 'customer-outcome', label: 'Customer outcome', ownerRole: 'ATS', actionWhenMissing: 'Quantify the outcome.', rationale: 'Outcomes anchor the deal.' },
    { id: 'business-case', label: 'Business case', ownerRole: 'Specialist / SSP', actionWhenMissing: 'Validate the business case.', rationale: 'Finance must confirm value.' }
  ],
  sourceHealth: { source: 'mcem', state: 'sample', detail: 'Bundled guidance.', checkedAt: '2026-10-05T00:00:00.000Z' }
}

function contextWith(milestones: OpportunityContext['milestones']): OpportunityContext {
  return {
    account: { id: 'account-1', name: 'Account', segment: 'Enterprise' },
    opportunity: { id: 'opp-1', accountId: 'account-1', name: 'Opportunity', recordedStage: 3, value: 100, currency: 'USD', closeDate: '2027-01-01' },
    observations: [
      { criterionId: 'customer-outcome', status: 'met', detail: 'Outcome agreed.' },
      { criterionId: 'business-case', status: 'met', detail: 'Finance validated.' }
    ],
    ...(milestones ? { milestones } : {}),
    retrievedAt: '2026-10-05T00:00:00.000Z',
    sourceHealth: { source: 'msx', state: 'sample', detail: 'Sample.', checkedAt: '2026-10-05T00:00:00.000Z' }
  }
}

describe('milestone signals', () => {
  it('flags At Risk, Blocked, and Uncommitted milestones and ignores healthy ones', () => {
    const summary = summarizeMilestones([
      { name: 'Healthy', status: 'On Track', commitment: 'Committed' },
      { name: 'Delivery gate', status: 'Blocked', commitment: 'Best case' },
      { name: 'Pilot scope', status: 'At Risk', commitment: 'Committed' },
      { name: 'Funding', status: 'In Progress', commitment: 'Uncommitted' }
    ])

    expect(summary.attention.map((item) => item.name)).toEqual(['Delivery gate', 'Pilot scope', 'Funding'])
    expect(summary.attention[0]?.ownerRole).toBe('Solution Engineer')
    expect(summary.attention[0]?.confidence).toBe('high')
    expect(summary.attention[2]?.ownerRole).toBe('Account Executive')
    expect(summary.headline).toContain('need attention')
  })

  it('returns no attention and an empty headline when every milestone is healthy', () => {
    const summary = summarizeMilestones([
      { name: 'A', status: 'On Track', commitment: 'Committed' },
      { name: 'B', status: 'Completed', commitment: 'Committed' }
    ])
    expect(summary.attention).toHaveLength(0)
    expect(summary.headline).toBe('')
  })

  it('builds schema-valid, uniquely identified recommendations that cite evidence', () => {
    const summary = summarizeMilestones([
      { name: 'Delivery gate', status: 'Blocked' },
      { name: 'Funding', status: 'In Progress', commitment: 'Uncommitted' }
    ])
    const recs = milestoneRecommendations(summary, ['msx-1', 'mcem-1'])
    expect(recs).toHaveLength(2)
    expect(new Set(recs.map((rec) => rec.id)).size).toBe(2)
    expect(recs.every((rec) => rec.evidenceIds.length > 0 && !rec.assumption)).toBe(true)
    expect(recs[0]?.action).toContain('Delivery gate')
  })
})

describe('evaluateMcemProgress with milestones', () => {
  it('appends milestone-driven recommendations and a summary headline', () => {
    const result = evaluateMcemProgress(
      contextWith([
        { id: 'ms-1', opportunityId: 'opp-1', name: 'Security review', status: 'Blocked', commitment: 'Uncommitted', targetDate: '2026-12-01' }
      ]),
      guidance,
      '00000000-0000-4000-8000-000000000010'
    )

    expect(mcemResponseSchema.safeParse(result).success).toBe(true)
    const milestoneRec = result.recommendations.find((rec) => rec.id.startsWith('recommendation-milestone-'))
    expect(milestoneRec?.ownerRole).toBe('Solution Engineer')
    expect(milestoneRec?.action).toContain('Security review')
    expect(result.summary).toContain('need attention')
  })

  it('leaves the recommendation shape unchanged when milestones are healthy or absent', () => {
    const withHealthy = evaluateMcemProgress(
      contextWith([{ id: 'ms-2', opportunityId: 'opp-1', name: 'Rollout', status: 'On Track', commitment: 'Committed' }]),
      guidance,
      '00000000-0000-4000-8000-000000000011'
    )
    const without = evaluateMcemProgress(contextWith(undefined), guidance, '00000000-0000-4000-8000-000000000012')

    expect(withHealthy.recommendations.some((rec) => rec.id.startsWith('recommendation-milestone-'))).toBe(false)
    expect(without.recommendations.some((rec) => rec.id.startsWith('recommendation-milestone-'))).toBe(false)
    expect(withHealthy.summary).not.toContain('need attention')
  })
})
