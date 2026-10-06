import { describe, expect, it } from 'vitest'
import {
  milestoneSchema,
  milestoneTeamJoinResultSchema,
  milestoneTeamLeaveResultSchema
} from '../../packages/common/index.js'

describe('milestone-team membership contracts', () => {
  const baseMilestone = {
    id: 'ms-1',
    opportunityId: 'opp-1',
    name: 'Customer pilot',
    status: 'On Track'
  }

  it('accepts a milestone with or without the onMilestoneTeam flag', () => {
    expect(milestoneSchema.parse(baseMilestone).onMilestoneTeam).toBeUndefined()
    expect(milestoneSchema.parse({ ...baseMilestone, onMilestoneTeam: true }).onMilestoneTeam).toBe(true)
    expect(milestoneSchema.parse({ ...baseMilestone, onMilestoneTeam: false }).onMilestoneTeam).toBe(false)
  })

  it('rejects a non-boolean onMilestoneTeam flag', () => {
    expect(milestoneSchema.safeParse({ ...baseMilestone, onMilestoneTeam: 'yes' }).success).toBe(false)
  })

  it('locks the join result to onMilestoneTeam=true and rejects extra keys', () => {
    expect(milestoneTeamJoinResultSchema.parse({ opportunityId: 'opp-1', milestoneId: 'ms-1', onMilestoneTeam: true, alreadyMember: false }))
      .toEqual({ opportunityId: 'opp-1', milestoneId: 'ms-1', onMilestoneTeam: true, alreadyMember: false })
    expect(milestoneTeamJoinResultSchema.safeParse({ opportunityId: 'opp-1', milestoneId: 'ms-1', onMilestoneTeam: false, alreadyMember: false }).success).toBe(false)
    expect(milestoneTeamJoinResultSchema.safeParse({ opportunityId: 'opp-1', milestoneId: 'ms-1', onMilestoneTeam: true, alreadyMember: false, extra: 1 }).success).toBe(false)
  })

  it('locks the leave result to onMilestoneTeam=false', () => {
    expect(milestoneTeamLeaveResultSchema.parse({ opportunityId: 'opp-1', milestoneId: 'ms-1', onMilestoneTeam: false, alreadyAbsent: true }))
      .toEqual({ opportunityId: 'opp-1', milestoneId: 'ms-1', onMilestoneTeam: false, alreadyAbsent: true })
    expect(milestoneTeamLeaveResultSchema.safeParse({ opportunityId: 'opp-1', milestoneId: 'ms-1', onMilestoneTeam: true, alreadyAbsent: true }).success).toBe(false)
  })
})
