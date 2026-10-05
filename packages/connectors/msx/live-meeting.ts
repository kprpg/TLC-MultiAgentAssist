import {
  meetingChangeSetApprovalSchema,
  meetingChangeSetProposalSchema,
  meetingChangeSetResultSchema,
  meetingTranscriptSchema,
  type MeetingChangeSetApproval,
  type MeetingChangeSetProposal,
  type MeetingChangeSetResult,
  type MeetingInjectItemResult,
  type MeetingSlot,
  type MeetingTranscript,
  type MeetingTranscriptSummary,
  type Milestone,
  type MilestoneUpdate
} from '../../common/index.js'
import type { MsxConnector } from '../common/index.js'
import {
  extractMeetingSignals,
  MEETING_FIELD_DICTIONARY,
  type ExtractorMilestoneSnapshot,
  type ExtractorOpportunitySnapshot,
  type MeetingExtractionContext
} from '../../agents/meeting-signal-extractor/src/index.js'

const MAX_COMMENTS = 30_000

/** Pluggable extractor (deterministic by default, or a Foundry model-backed one). */
export type MeetingExtractorFn = (ctx: MeetingExtractionContext, options: { changeSetId: string }) => MeetingChangeSetProposal | Promise<MeetingChangeSetProposal>

export interface LiveMeetingCaptureRequest {
  opportunityId: string
  transcriptId?: string
  transcript?: MeetingTranscript
  changeSetId?: string
}

function prepend(existing: string | undefined, entry: string): string {
  const combined = existing && existing.trim().length > 0 ? `${entry}\n\n${existing}` : entry
  return combined.length > MAX_COMMENTS ? combined.slice(0, MAX_COMMENTS) : combined
}

function datePrefix(when: Date): string {
  return `${when.getMonth() + 1}/${when.getDate()}/${when.getFullYear()}`
}

/**
 * Live-MSX meeting capture. Builds the extractor snapshot from live opportunity + milestone
 * reads, runs the (deterministic or Foundry) extractor, and injects back into MSX all-or-none:
 *  - milestone signals (commitment / risk) are written to the real milestone columns;
 *  - opportunity-field signals and recommended new milestones are captured into an additive,
 *    dated meeting note appended to the opportunity comments, because the live connector cannot
 *    write discrete qualification columns (budget/timeline/etc.).
 * MSX has no cross-entity transaction, so apply uses validate-all -> apply -> compensate.
 */
export class LiveMeetingCaptureConnector {
  constructor(private readonly msx: MsxConnector, private readonly now: () => Date = () => new Date()) {}

  /** Graph-based transcript discovery is a later step; the live path uses paste/upload today. */
  async listMeetingTranscripts(): Promise<MeetingTranscriptSummary[]> {
    return []
  }

  async getMeetingTranscript(): Promise<MeetingTranscript | undefined> {
    return undefined
  }

  private buildOpportunitySnapshot(name: string, id: string, value: number | undefined, comments: string | undefined): ExtractorOpportunitySnapshot {
    // Only `estimatedValue` and the additive comment are readable from the live Opportunity
    // contract; the remaining qualification fields are unknown (null) and will be captured
    // into the meeting note rather than written as discrete columns.
    return {
      id,
      name,
      fields: {
        estimatedValue: value ?? null,
        qualificationComments: comments ?? null,
        budgetAmount: null,
        budgetStatus: null,
        timeline: null,
        purchaseProcess: null,
        decisionMaker: null,
        need: null,
        customerNeed: null,
        proposedSolution: null,
        finalDecisionDate: null,
        identifyCompetitors: null,
        opportunityRating: null
      }
    }
  }

  private buildMilestoneSnapshot(milestone: Milestone): ExtractorMilestoneSnapshot {
    return {
      id: milestone.id,
      name: milestone.name,
      fields: {
        milestoneCommitment: milestone.commitment ?? null,
        milestoneRisk: milestone.riskDetails ?? null
      }
    }
  }

  async proposeMeetingChangeSet(request: LiveMeetingCaptureRequest, extractor?: MeetingExtractorFn): Promise<MeetingChangeSetProposal> {
    if (!request.transcript) {
      throw new Error('Live meeting capture needs a pasted or uploaded transcript (Graph acquisition is not wired yet).')
    }
    const transcript = meetingTranscriptSchema.parse(request.transcript)
    const context = await this.msx.getOpportunityContext(request.opportunityId)
    const milestones = await this.msx.listMilestones(request.opportunityId)
    const opportunity = this.buildOpportunitySnapshot(
      context.opportunity.name,
      context.opportunity.id,
      context.opportunity.value,
      context.opportunity.comments
    )
    const anchored: MeetingTranscript = { ...transcript, opportunityId: request.opportunityId }
    const changeSetId = request.changeSetId ?? `cs-${request.opportunityId}-${this.now().getTime().toString(36)}`
    const run: MeetingExtractorFn = extractor ?? ((ctx, options) => extractMeetingSignals(ctx, options))
    return run({ transcript: anchored, opportunity, milestones: milestones.map((milestone) => this.buildMilestoneSnapshot(milestone)) }, { changeSetId })
  }

  private composeMeetingNote(proposal: MeetingChangeSetProposal, oppSlots: MeetingSlot[], approvedNewMilestones: string[], reason: string): string {
    const lines = [`MEETING CAPTURE (${proposal.meetingType}) ${datePrefix(this.now())} — ${reason}`]
    if (oppSlots.length > 0) {
      lines.push('Signals:')
      for (const slot of oppSlots) lines.push(`- ${slot.label}: ${slot.displayAfter} [${slot.mcemCriterion}]`)
    }
    if (approvedNewMilestones.length > 0) {
      lines.push('Recommended next steps:')
      for (const name of approvedNewMilestones) lines.push(`- ${name}`)
    }
    return lines.join('\n')
  }

  async applyMeetingChangeSet(input: { proposal: MeetingChangeSetProposal; approval: MeetingChangeSetApproval }): Promise<MeetingChangeSetResult> {
    const proposal = meetingChangeSetProposalSchema.parse(input.proposal)
    const approval = meetingChangeSetApprovalSchema.parse(input.approval)
    if (approval.changeSetId !== proposal.changeSetId) throw new Error('Approval does not match the proposal.')
    if (approval.opportunityId !== proposal.opportunityId) throw new Error('Approval targets a different opportunity.')

    const approvedSlots = proposal.slots.filter((slot) => approval.approvedSlotIds.includes(slot.slotId))
    const oppSlots = approvedSlots.filter((slot) => slot.targetKind === 'opportunity')
    const milestoneSlots = approvedSlots.filter((slot) => slot.targetKind === 'milestone' && slot.targetRecordId && approval.selectedMilestoneIds.includes(slot.targetRecordId))
    const approvedNewMilestoneNames = proposal.newMilestones
      .filter((milestone) => approval.approvedNewMilestoneTempIds.includes(milestone.tempId))
      .map((milestone) => milestone.name)

    // Phase 1: validate milestone concurrency against the current live values.
    const current = await this.msx.listMilestones(proposal.opportunityId)
    const currentById = new Map(current.map((milestone) => [milestone.id, milestone]))
    const conflicts = new Set<string>()
    for (const slot of milestoneSlots) {
      const entry = MEETING_FIELD_DICTIONARY[slot.targetField]
      if (!entry || entry.append) continue
      const milestone = currentById.get(slot.targetRecordId as string)
      const liveValue = slot.targetField === 'milestoneCommitment' ? milestone?.commitment ?? null : milestone?.riskDetails ?? null
      const before = slot.before === null || slot.before === undefined ? '' : String(slot.before).trim()
      if (before !== String(liveValue ?? '').trim()) conflicts.add(slot.slotId)
    }
    if (conflicts.size > 0) {
      return meetingChangeSetResultSchema.parse({
        changeSetId: proposal.changeSetId,
        state: 'rolled-back',
        items: this.buildResultItems(proposal, approval, { applied: new Set(), conflicts, appliedNewMilestones: false }),
        auditNote: `Rolled back: ${conflicts.size} milestone field(s) changed in MSX since review; no updates applied.`
      })
    }

    // Build one MilestoneUpdate per selected milestone, capturing before-values for compensation.
    const updatesByMilestone = new Map<string, { update: MilestoneUpdate; before: MilestoneUpdate }>()
    for (const slot of milestoneSlots) {
      const milestoneId = slot.targetRecordId as string
      const milestone = currentById.get(milestoneId)
      const bucket = updatesByMilestone.get(milestoneId) ?? { update: {}, before: this.captureMilestoneBefore(milestone) }
      if (slot.targetField === 'milestoneCommitment') {
        bucket.update = { ...bucket.update, customerCommitment: slot.after === 'Committed' ? 'Committed' : 'Uncommitted' }
      } else if (slot.targetField === 'milestoneRisk') {
        bucket.update = { ...bucket.update, riskDetails: prepend(milestone?.riskDetails, String(slot.after)) }
      }
      updatesByMilestone.set(milestoneId, bucket)
    }

    // Phase 2: apply with best-effort compensation (MSX has no multi-entity transaction).
    const appliedMilestoneIds: string[] = []
    let oppCommentsBefore: string | undefined
    let oppCommentApplied = false
    try {
      for (const [milestoneId, { update }] of updatesByMilestone) {
        if (Object.keys(update).length === 0) continue
        await this.msx.updateMilestone(proposal.opportunityId, milestoneId, update)
        appliedMilestoneIds.push(milestoneId)
      }
      const note = this.composeMeetingNote(proposal, oppSlots, approvedNewMilestoneNames, approval.reason)
      if (oppSlots.length > 0 || approvedNewMilestoneNames.length > 0) {
        oppCommentsBefore = (await this.msx.getOpportunityContext(proposal.opportunityId)).opportunity.comments
        await this.msx.updateOpportunity(proposal.opportunityId, { comments: prepend(oppCommentsBefore, note) })
        oppCommentApplied = true
      }
    } catch (error) {
      for (const milestoneId of appliedMilestoneIds.reverse()) {
        const before = updatesByMilestone.get(milestoneId)?.before
        if (before && Object.keys(before).length > 0) {
          await this.msx.updateMilestone(proposal.opportunityId, milestoneId, before).catch(() => { /* best-effort */ })
        }
      }
      if (oppCommentApplied) {
        await this.msx.updateOpportunity(proposal.opportunityId, { comments: oppCommentsBefore ?? '' }).catch(() => { /* best-effort */ })
      }
      return meetingChangeSetResultSchema.parse({
        changeSetId: proposal.changeSetId,
        state: 'rolled-back',
        items: this.buildResultItems(proposal, approval, { applied: new Set(), conflicts: new Set(), appliedNewMilestones: false, failure: error instanceof Error ? error.message : String(error) }),
        auditNote: `Rolled back after a write failed: ${error instanceof Error ? error.message : String(error)}.`
      })
    }

    const appliedSlotIds = new Set<string>([...oppSlots.map((slot) => slot.slotId), ...milestoneSlots.filter((slot) => appliedMilestoneIds.includes(slot.targetRecordId as string)).map((slot) => slot.slotId)])
    return meetingChangeSetResultSchema.parse({
      changeSetId: proposal.changeSetId,
      state: 'applied',
      items: this.buildResultItems(proposal, approval, { applied: appliedSlotIds, conflicts: new Set(), appliedNewMilestones: true }),
      auditNote: `Meeting inject (${proposal.meetingType}): updated ${appliedMilestoneIds.length} milestone(s) and captured ${oppSlots.length} opportunity signal(s) in the opportunity notes. Reason: ${approval.reason}`
    })
  }

  private captureMilestoneBefore(milestone: Milestone | undefined): MilestoneUpdate {
    if (!milestone) return {}
    return {
      ...(milestone.commitment === 'Committed' || milestone.commitment === 'Uncommitted' ? { customerCommitment: milestone.commitment } : {}),
      ...(milestone.riskDetails ? { riskDetails: milestone.riskDetails } : {})
    }
  }

  private buildResultItems(
    proposal: MeetingChangeSetProposal,
    approval: MeetingChangeSetApproval,
    outcome: { applied: ReadonlySet<string>; conflicts: ReadonlySet<string>; appliedNewMilestones: boolean; failure?: string }
  ): MeetingInjectItemResult[] {
    const items: MeetingInjectItemResult[] = []
    for (const slot of proposal.slots) {
      if (!approval.approvedSlotIds.includes(slot.slotId)) continue
      let state: MeetingInjectItemResult['state']
      let detail: string
      if (outcome.conflicts.has(slot.slotId)) {
        state = 'conflict'
        detail = `"${slot.label}" changed in MSX since review; no update applied.`
      } else if (outcome.applied.has(slot.slotId)) {
        state = 'applied'
        detail = slot.targetKind === 'opportunity'
          ? `${slot.label}: ${slot.displayAfter} (captured in opportunity notes)`
          : `${slot.label}: ${slot.displayAfter}`
      } else if (slot.targetKind === 'milestone' && slot.targetRecordId && !approval.selectedMilestoneIds.includes(slot.targetRecordId)) {
        state = 'skipped'
        detail = `${slot.label}: milestone not selected.`
      } else {
        state = 'skipped'
        detail = outcome.failure ? `${slot.label}: not applied (rolled back).` : `${slot.label}: not applied.`
      }
      items.push({ id: slot.slotId, kind: 'field', state, detail })
    }
    for (const milestone of proposal.newMilestones) {
      if (!approval.approvedNewMilestoneTempIds.includes(milestone.tempId)) continue
      items.push({
        id: milestone.tempId,
        kind: 'new-milestone',
        state: outcome.appliedNewMilestones ? 'applied' : 'skipped',
        detail: outcome.appliedNewMilestones ? `"${milestone.name}" recorded in opportunity notes as a recommended next step.` : `"${milestone.name}" not recorded (rolled back).`
      })
    }
    return items
  }
}
