import { z } from 'zod'

/**
 * Contracts for the meeting-signal extraction → review → injection flow.
 * See docs/MeetingCapture.md (Parts B, D, H). The transcript is untrusted input; the
 * proposal/approval/result mirror the generic change-set contract with the fields the
 * review UI needs (MCEM criterion, confidence, evidence, target kind).
 */

export const meetingTypeSchema = z.enum(['customer', 'internal'])
export const meetingSourceSchema = z.enum(['teams', 'upload', 'paste'])
export const meetingTargetKindSchema = z.enum(['opportunity', 'milestone', 'new-milestone'])
export const meetingValueTypeSchema = z.enum(['text', 'money', 'date', 'optionset', 'boolean', 'percent'])
export const mcemCriterionSchema = z.enum([
    'customer-outcome', 'decision-team', 'technical-validation', 'business-case',
    'next-step', 'risk', 'sentiment', 'stage', 'notes'
])

/** A meeting candidate shown in the launcher's picker. */
export const meetingTranscriptSummarySchema = z.object({
    id: z.string().min(1),
    subject: z.string().min(1),
    occurredAt: z.string().datetime(),
    meetingType: meetingTypeSchema,
    source: meetingSourceSchema,
    opportunityId: z.string().min(1).optional(),
    opportunityName: z.string().min(1).optional(),
    segmentCount: z.number().int().nonnegative()
}).strict()

export const meetingTranscriptSegmentSchema = z.object({
    segmentId: z.string().min(1),
    startMs: z.number().int().nonnegative().optional(),
    endMs: z.number().int().nonnegative().optional(),
    speaker: z.string().min(1).optional(),
    speakerRole: meetingTypeSchema.optional(),
    text: z.string().min(1)
}).strict()

export const meetingTranscriptSchema = z.object({
    id: z.string().min(1),
    opportunityId: z.string().min(1).optional(),
    meetingType: meetingTypeSchema,
    title: z.string().min(1).optional(),
    source: meetingSourceSchema,
    segments: z.array(meetingTranscriptSegmentSchema)
}).strict()

/** One proposed field change, rendered as a review-table row. */
export const meetingSlotSchema = z.object({
    slotId: z.string().min(1),
    label: z.string().min(1),
    mcemCriterion: mcemCriterionSchema,
    targetKind: meetingTargetKindSchema,
    targetRecordId: z.string().min(1).optional(),
    targetField: z.string().min(1),
    valueType: meetingValueTypeSchema,
    before: z.unknown().optional(),
    after: z.unknown(),
    displayBefore: z.string().optional(),
    displayAfter: z.string().min(1),
    confidence: z.number().min(0).max(1),
    checkedByDefault: z.boolean(),
    blocked: z.boolean(),
    blockedReason: z.string().min(1).optional(),
    sensitive: z.boolean(),
    rationale: z.string().min(1),
    evidence: z.array(z.string().min(1))
}).strict()

export const meetingNewMilestoneSchema = z.object({
    tempId: z.string().min(1),
    name: z.string().min(1),
    milestoneDate: z.string().date().optional(),
    ownerName: z.string().min(1).optional(),
    commitment: z.enum(['Uncommitted', 'Committed']).optional(),
    confidence: z.number().min(0).max(1),
    checkedByDefault: z.boolean(),
    evidence: z.array(z.string().min(1))
}).strict()

export const meetingUnmappedSignalSchema = z.object({
    label: z.string().min(1),
    text: z.string().min(1),
    mcemCriterion: mcemCriterionSchema,
    evidence: z.array(z.string().min(1))
}).strict()

export const meetingChangeSetProposalSchema = z.object({
    changeSetId: z.string().min(1),
    transcriptId: z.string().min(1),
    opportunityId: z.string().min(1),
    meetingType: meetingTypeSchema,
    slots: z.array(meetingSlotSchema),
    newMilestones: z.array(meetingNewMilestoneSchema),
    suggestedMilestoneIds: z.array(z.string().min(1)),
    unmappedSignals: z.array(meetingUnmappedSignalSchema),
    proposedAt: z.string().datetime()
}).strict()

export const meetingChangeSetApprovalSchema = z.object({
    changeSetId: z.string().min(1),
    opportunityId: z.string().min(1),
    approvedSlotIds: z.array(z.string().min(1)),
    approvedNewMilestoneTempIds: z.array(z.string().min(1)),
    selectedMilestoneIds: z.array(z.string().min(1)),
    reason: z.string().trim().min(3).max(1000)
}).strict()

export const meetingInjectItemResultSchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['field', 'new-milestone']),
    state: z.enum(['applied', 'conflict', 'failed', 'skipped']),
    detail: z.string().min(1)
}).strict()

export const meetingChangeSetResultSchema = z.object({
    changeSetId: z.string().min(1),
    state: z.enum(['applied', 'rolled-back']),
    items: z.array(meetingInjectItemResultSchema),
    auditNote: z.string().min(1)
}).strict()

export type MeetingType = z.infer<typeof meetingTypeSchema>
export type MeetingSource = z.infer<typeof meetingSourceSchema>
export type MeetingTargetKind = z.infer<typeof meetingTargetKindSchema>
export type MeetingValueType = z.infer<typeof meetingValueTypeSchema>
export type McemCriterion = z.infer<typeof mcemCriterionSchema>
export type MeetingTranscriptSummary = z.infer<typeof meetingTranscriptSummarySchema>
export type MeetingTranscriptSegment = z.infer<typeof meetingTranscriptSegmentSchema>
export type MeetingTranscript = z.infer<typeof meetingTranscriptSchema>
export type MeetingSlot = z.infer<typeof meetingSlotSchema>
export type MeetingNewMilestone = z.infer<typeof meetingNewMilestoneSchema>
export type MeetingUnmappedSignal = z.infer<typeof meetingUnmappedSignalSchema>
export type MeetingChangeSetProposal = z.infer<typeof meetingChangeSetProposalSchema>
export type MeetingChangeSetApproval = z.infer<typeof meetingChangeSetApprovalSchema>
export type MeetingInjectItemResult = z.infer<typeof meetingInjectItemResultSchema>
export type MeetingChangeSetResult = z.infer<typeof meetingChangeSetResultSchema>
