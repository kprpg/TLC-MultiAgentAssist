import { describe, expect, it } from 'vitest'
import {
  additionalSampleAccounts,
  additionalSampleMilestones,
  additionalSampleObservationsByOpportunity,
  additionalSampleOpportunities
} from '../../../packages/common/fixtures/additional-sample-portfolio.js'

describe('additional sample portfolio fixture', () => {
  it('has unique, fully connected account and opportunity records', () => {
    expect(additionalSampleAccounts).toHaveLength(4)
    expect(additionalSampleOpportunities).toHaveLength(8)
    expect(new Set(additionalSampleAccounts.map((account) => account.id)).size).toBe(4)
    expect(new Set(additionalSampleOpportunities.map((opportunity) => opportunity.id)).size).toBe(8)

    const accountIds = new Set(additionalSampleAccounts.map((account) => account.id))
    for (const opportunity of additionalSampleOpportunities) {
      expect(accountIds.has(opportunity.accountId)).toBe(true)
    }
  })

  it('provides three milestones and five criterion observations per opportunity', () => {
    expect(additionalSampleMilestones).toHaveLength(24)
    expect(new Set(additionalSampleMilestones.map((milestone) => milestone.id)).size).toBe(24)

    for (const opportunity of additionalSampleOpportunities) {
      expect(additionalSampleMilestones.filter((milestone) => milestone.opportunityId === opportunity.id)).toHaveLength(3)
      expect(additionalSampleObservationsByOpportunity[opportunity.id]).toHaveLength(5)
    }
  })

  it('covers varied stages, evidence, milestone states, ownership, and dates', () => {
    expect(new Set(additionalSampleOpportunities.map((opportunity) => opportunity.recordedStage))).toEqual(new Set([1, 2, 3, 4]))
    expect(new Set(additionalSampleMilestones.map((milestone) => milestone.status))).toEqual(
      new Set(['Completed', 'At Risk', 'On Track', 'In Progress', 'Blocked'])
    )
    expect(new Set(additionalSampleMilestones.map((milestone) => milestone.commitment))).toEqual(
      new Set(['Committed', 'Uncommitted'])
    )
    expect(additionalSampleMilestones.some((milestone) => milestone.owner === undefined)).toBe(true)
    expect(additionalSampleMilestones.some((milestone) => milestone.targetDate === undefined)).toBe(true)

    const evidenceStatuses = new Set(
      Object.values(additionalSampleObservationsByOpportunity)
        .flat()
        .map((observation) => observation.status)
    )
    expect(evidenceStatuses).toEqual(new Set(['met', 'partial', 'missing']))
  })
})
