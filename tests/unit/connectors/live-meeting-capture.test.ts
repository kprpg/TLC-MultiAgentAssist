import { describe, expect, it } from 'vitest'
import { LiveMeetingCaptureConnector } from '../../../packages/connectors/msx/index.js'
import type { MsxConnector } from '../../../packages/connectors/common/index.js'
import type { MeetingChangeSetProposal, Milestone, Opportunity } from '../../../packages/common/index.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'

class FakeMsx {
  opportunity: Opportunity = { id: 'opp-1', accountId: 'acc-1', name: 'Grid modernization', recordedStage: 2, value: 500_000, currency: 'USD', closeDate: '2026-12-01' }
  milestones: Milestone[] = [
    { id: 'ms-1', opportunityId: 'opp-1', name: 'Technical validation', status: 'On Track', commitment: 'Uncommitted' },
    { id: 'ms-2', opportunityId: 'opp-1', name: 'Security review', status: 'At Risk', commitment: 'Uncommitted', riskDetails: 'Waiting on security team' }
  ]
  failOpportunityWrite = false
  updateMilestoneCalls = 0

  async getOpportunityContext(): Promise<{ opportunity: Opportunity }> {
    return { opportunity: { ...this.opportunity } }
  }
  async listMilestones(): Promise<Milestone[]> {
    return this.milestones.map((milestone) => ({ ...milestone }))
  }
  async updateMilestone(_opportunityId: string, milestoneId: string, update: { customerCommitment?: string; riskDetails?: string; status?: string; targetDate?: string }): Promise<Milestone> {
    this.updateMilestoneCalls += 1
    const milestone = this.milestones.find((candidate) => candidate.id === milestoneId)
    if (!milestone) throw new Error('unknown milestone')
    if (update.customerCommitment) milestone.commitment = update.customerCommitment
    if (update.riskDetails !== undefined) milestone.riskDetails = update.riskDetails
    if (update.status) milestone.status = update.status
    if (update.targetDate) milestone.targetDate = update.targetDate
    return { ...milestone }
  }
  async updateOpportunity(_opportunityId: string, update: { comments: string }): Promise<Opportunity> {
    if (this.failOpportunityWrite) throw new Error('MSX write rejected')
    this.opportunity = { ...this.opportunity, comments: update.comments }
    return { ...this.opportunity }
  }
}

function connector(fake: FakeMsx): LiveMeetingCaptureConnector {
  return new LiveMeetingCaptureConnector(fake as unknown as MsxConnector, () => new Date('2026-10-04T00:00:00Z'))
}

function milestoneCommitmentProposal(): MeetingChangeSetProposal {
  return {
    changeSetId: 'cs-live-1',
    transcriptId: 'tr-live',
    opportunityId: 'opp-1',
    meetingType: 'customer',
    slots: [
      {
        slotId: 'slot-1-milestoneCommitment', label: 'Milestone commitment', mcemCriterion: 'next-step',
        targetKind: 'milestone', targetRecordId: 'ms-1', targetField: 'milestoneCommitment', valueType: 'optionset',
        before: 'Uncommitted', after: 'Committed', displayBefore: 'Uncommitted', displayAfter: 'Committed',
        confidence: 0.9, checkedByDefault: true, blocked: false, sensitive: false, rationale: 'Customer committed to the milestone.', evidence: ['s1']
      },
      {
        slotId: 'slot-2-timeline', label: 'Purchase timeline', mcemCriterion: 'next-step',
        targetKind: 'opportunity', targetRecordId: 'opp-1', targetField: 'timeline', valueType: 'optionset',
        before: null, after: 'This Quarter', displayBefore: '(empty)', displayAfter: 'This Quarter',
        confidence: 0.8, checkedByDefault: true, blocked: false, sensitive: false, rationale: 'Buying this quarter.', evidence: ['s2']
      }
    ],
    newMilestones: [],
    suggestedMilestoneIds: ['ms-1'],
    unmappedSignals: [],
    proposedAt: '2026-10-04T00:00:00.000Z'
  }
}

function approveAll(proposal: MeetingChangeSetProposal) {
  return {
    changeSetId: proposal.changeSetId,
    opportunityId: proposal.opportunityId,
    approvedSlotIds: proposal.slots.map((slot) => slot.slotId),
    approvedNewMilestoneTempIds: proposal.newMilestones.map((milestone) => milestone.tempId),
    selectedMilestoneIds: proposal.suggestedMilestoneIds,
    reason: 'Reviewed on the live call'
  }
}

describe('LiveMeetingCaptureConnector', () => {
  it('builds a proposal from live opportunity + milestone reads for a pasted transcript', async () => {
    const fake = new FakeMsx()
    const transcript = parseTranscriptContent('Priya Nair: We have sign-off to spend 900 thousand this quarter.', { meetingType: 'customer' })
    const proposal = await connector(fake).proposeMeetingChangeSet({ opportunityId: 'opp-1', transcript })
    expect(proposal.opportunityId).toBe('opp-1')
    expect(proposal.slots.some((slot) => slot.targetField === 'budgetAmount')).toBe(true)
  })

  it('writes milestone commitment and captures opportunity signals in the notes', async () => {
    const fake = new FakeMsx()
    const proposal = milestoneCommitmentProposal()
    const result = await connector(fake).applyMeetingChangeSet({ proposal, approval: approveAll(proposal) })

    expect(result.state).toBe('applied')
    expect(fake.milestones.find((milestone) => milestone.id === 'ms-1')?.commitment).toBe('Committed')
    expect(fake.opportunity.comments).toContain('MEETING CAPTURE')
    expect(fake.opportunity.comments).toContain('Purchase timeline')
  })

  it('rolls back the whole set when a milestone changed in MSX since review', async () => {
    const fake = new FakeMsx()
    const milestone = fake.milestones.find((candidate) => candidate.id === 'ms-1')
    if (milestone) milestone.commitment = 'Committed' // someone committed it already
    const proposal = milestoneCommitmentProposal()
    const result = await connector(fake).applyMeetingChangeSet({ proposal, approval: approveAll(proposal) })

    expect(result.state).toBe('rolled-back')
    expect(result.items.some((item) => item.state === 'conflict')).toBe(true)
    expect(fake.opportunity.comments).toBeUndefined()
  })

  it('compensates applied milestone writes when the opportunity note write fails', async () => {
    const fake = new FakeMsx()
    fake.failOpportunityWrite = true
    const proposal = milestoneCommitmentProposal()
    const result = await connector(fake).applyMeetingChangeSet({ proposal, approval: approveAll(proposal) })

    expect(result.state).toBe('rolled-back')
    // The milestone write was reverted to its pre-apply value.
    expect(fake.milestones.find((milestone) => milestone.id === 'ms-1')?.commitment).toBe('Uncommitted')
    expect(fake.opportunity.comments).toBeUndefined()
  })
})
