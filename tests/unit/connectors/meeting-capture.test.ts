import { describe, expect, it } from 'vitest'
import {
  LocalStore,
  LocalStoreMsxConnector,
  type ProposeMeetingChangeSetRequest
} from '../../../packages/connectors/local-store/index.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'
import type { MeetingChangeSetApproval, MeetingChangeSetProposal } from '../../../packages/common/index.js'

function connector(): LocalStoreMsxConnector {
  return new LocalStoreMsxConnector(new LocalStore())
}

function approveAll(proposal: MeetingChangeSetProposal, reason = 'Reviewed on the call'): MeetingChangeSetApproval {
  return {
    changeSetId: proposal.changeSetId,
    opportunityId: proposal.opportunityId,
    approvedSlotIds: proposal.slots.filter((slot) => !slot.blocked).map((slot) => slot.slotId),
    approvedNewMilestoneTempIds: proposal.newMilestones.map((milestone) => milestone.tempId),
    selectedMilestoneIds: proposal.suggestedMilestoneIds,
    reason
  }
}

describe('meeting capture connector methods', () => {
  it('lists seeded meeting transcripts for an opportunity', async () => {
    const msx = connector()
    const transcripts = await msx.listMeetingTranscripts('opp-cloud-security-readiness')
    expect(transcripts.map((transcript) => transcript.id)).toContain('tr-cloud-security')
    expect(transcripts[0]?.segmentCount).toBeGreaterThan(0)
    expect(transcripts[0]?.opportunityName).toBe('Cloud security readiness')
  })

  it('proposes gap-filling field updates from a seeded transcript', async () => {
    const msx = connector()
    const proposal = await msx.proposeMeetingChangeSet({
      opportunityId: 'opp-cloud-security-readiness',
      transcriptId: 'tr-cloud-security'
    })
    const fields = proposal.slots.map((slot) => slot.targetField)
    expect(fields).toContain('budgetAmount')
    expect(fields).toContain('timeline')
    expect(fields).toContain('purchaseProcess')
    expect(proposal.newMilestones.length).toBeGreaterThan(0)
  })

  it('applies an approved change set atomically and writes an audit comment', async () => {
    const msx = connector()
    const proposal = await msx.proposeMeetingChangeSet({
      opportunityId: 'opp-cloud-security-readiness',
      transcriptId: 'tr-cloud-security'
    })
    const result = await msx.applyMeetingChangeSet({ proposal, approval: approveAll(proposal) })
    expect(result.state).toBe('applied')
    expect(result.items.some((item) => item.state === 'applied')).toBe(true)

    const context = await msx.getOpportunityContext('opp-cloud-security-readiness')
    expect(context.opportunity.comments).toContain('Meeting inject')

    const milestones = await msx.listMilestones('opp-cloud-security-readiness')
    expect(milestones.length).toBeGreaterThan(0)
  })

  it('persists the injected budget amount after apply', async () => {
    const store = new LocalStore()
    const msx = new LocalStoreMsxConnector(store)
    const proposal = await msx.proposeMeetingChangeSet({
      opportunityId: 'opp-cloud-security-readiness',
      transcriptId: 'tr-cloud-security'
    })
    await msx.applyMeetingChangeSet({ proposal, approval: approveAll(proposal) })
    const budget = store.get('SELECT budget_amount FROM opportunity WHERE id = ?', 'opp-cloud-security-readiness')
    expect(Number(budget?.['budget_amount'])).toBe(900_000)
  })

  it('rolls back the whole set when a field changed since review (conflict)', async () => {
    const store = new LocalStore()
    const msx = new LocalStoreMsxConnector(store)
    const proposal = await msx.proposeMeetingChangeSet({
      opportunityId: 'opp-cloud-security-readiness',
      transcriptId: 'tr-cloud-security'
    })
    // Someone else sets the budget between review and apply.
    store.run('UPDATE opportunity SET budget_amount = ? WHERE id = ?', 123_456, 'opp-cloud-security-readiness')

    const result = await msx.applyMeetingChangeSet({ proposal, approval: approveAll(proposal) })
    expect(result.state).toBe('rolled-back')
    expect(result.items.some((item) => item.state === 'conflict')).toBe(true)

    // Nothing else was applied: timeline remains unset.
    const row = store.get('SELECT timeline, budget_amount FROM opportunity WHERE id = ?', 'opp-cloud-security-readiness')
    expect(row?.['timeline']).toBeNull()
    expect(Number(row?.['budget_amount'])).toBe(123_456)
  })

  it('accepts an inline transcript parsed from an actual recording paste', async () => {
    const msx = connector()
    const transcript = parseTranscriptContent(
      'Priya Nair: We have sign-off to spend 750 thousand this quarter.\nDaniel Reyes: Our committee decides; it is a must-have.',
      { meetingType: 'customer' }
    )
    const request: ProposeMeetingChangeSetRequest = { opportunityId: 'opp-cloud-security-readiness', transcript }
    const proposal = await msx.proposeMeetingChangeSet(request)
    const budgetSlot = proposal.slots.find((slot) => slot.targetField === 'budgetAmount')
    expect(budgetSlot?.after).toBe(750_000)
  })

  it('only updates selected milestones and reports others as skipped', async () => {
    const msx = connector()
    const proposal = await msx.proposeMeetingChangeSet({
      opportunityId: 'opp-cloud-security-readiness',
      transcriptId: 'tr-cloud-security'
    })
    const approval = approveAll(proposal)
    const result = await msx.applyMeetingChangeSet({ proposal, approval })
    expect(result.state).toBe('applied')
  })
})
