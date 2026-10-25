import type { CreateMilestoneActivityRequest, MilestoneUpdate } from '../../../../packages/common/contracts/index.js'
import type {
    StagePipelineMilestone, StagePipelineMilestoneStatus, StagePipelineOpportunity, StagePipelineSnapshot
} from '../../../../packages/common/contracts/stage-pipeline-review.js'

export interface StagePipelineWrites {
    updateOpportunity(opportunityId: string, update: { comments: string }): Promise<unknown>
    updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<unknown>
    createMilestoneActivity(opportunityId: string, milestoneId: string, request: CreateMilestoneActivityRequest): Promise<unknown>
}

export const writableMilestoneStatuses = ['On Track', 'At Risk', 'Blocked', 'Completed', 'Cancelled'] as const satisfies readonly StagePipelineMilestoneStatus[]

const commentLimit = 30_000
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function commentDate(isoDate: string): string {
    return `${isoDate.slice(8, 10)}/${months[Number(isoDate.slice(5, 7)) - 1] ?? ''}`
}

/** Prepends a dated line to the existing comment so earlier history is never truncated or lost. */
export function composeComment(existing: string, text: string, isoDate: string): string {
    const line = text.trim()
    if (!line) throw new Error('Enter an update.')
    const combined = [`${commentDate(isoDate)} - ${line}`, existing.trim()].filter(Boolean).join('\n')
    if (combined.length > commentLimit) throw new Error('The comment would exceed 30,000 characters. Shorten the update.')
    return combined
}

export type MilestoneEdit = {
    status: StagePipelineMilestoneStatus
    commitment: StagePipelineMilestone['commitment']
    date: string
    comment: string
    reason: string
}
export type MilestoneChange = { field: 'Status' | 'Commitment' | 'Milestone date' | 'Comment'; from: string; to: string }
export type MilestoneUpdateResult = { ok: true; update: MilestoneUpdate; changes: MilestoneChange[] } | { ok: false; error: string }

export function buildMilestoneUpdate(milestone: StagePipelineMilestone, edit: MilestoneEdit, isoToday: string): MilestoneUpdateResult {
    if (edit.date && !/^\d{4}-\d{2}-\d{2}$/.test(edit.date)) return { ok: false, error: 'Enter the milestone date as YYYY-MM-DD.' }
    const changes: MilestoneChange[] = []
    const update: MilestoneUpdate = {}
    if (edit.status !== milestone.status) { changes.push({ field: 'Status', from: milestone.status, to: edit.status }); update.status = edit.status }
    if (edit.commitment !== milestone.commitment) { changes.push({ field: 'Commitment', from: milestone.commitment, to: edit.commitment }); update.customerCommitment = edit.commitment }
    if (edit.date && edit.date !== (milestone.date ?? '')) { changes.push({ field: 'Milestone date', from: milestone.date ?? 'none', to: edit.date }); update.targetDate = edit.date }
    const tracked = changes.length > 0
    const reason = edit.reason.trim()
    if (tracked && reason.length < 3) return { ok: false, error: 'Enter a reason of at least 3 characters for a status, commitment or date change.' }
    if (!tracked && !edit.comment.trim()) return { ok: false, error: 'Change at least one field.' }
    const text = [edit.comment.trim() || `Updated ${changes.map((change) => change.field.toLowerCase()).join(', ')}`, tracked ? `Reason: ${reason}` : ''].filter(Boolean).join('. ')
    try {
        update.comments = composeComment(milestone.comment, text, isoToday)
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'The comment is invalid.' }
    }
    if (edit.comment.trim()) changes.push({ field: 'Comment', from: milestone.comment ? 'existing' : 'none', to: edit.comment.trim() })
    return { ok: true, update, changes }
}

function requireEditable(snapshot: StagePipelineSnapshot, opportunityId: string): StagePipelineOpportunity {
    const row = snapshot.opportunities.find((item) => item.id === opportunityId)
    if (!row) throw new Error('The opportunity is not in the current view.')
    if (!row.editable) throw new Error('This opportunity is read-only in this view.')
    return row
}

export function applySampleOpportunityComment(snapshot: StagePipelineSnapshot, opportunityId: string, comments: string): StagePipelineSnapshot {
    requireEditable(snapshot, opportunityId)
    return { ...snapshot, opportunities: snapshot.opportunities.map((row) => row.id === opportunityId ? { ...row, notes: comments } : row) }
}

export function applySampleMilestoneUpdate(snapshot: StagePipelineSnapshot, milestoneId: string, update: MilestoneUpdate): StagePipelineSnapshot {
    const target = snapshot.milestones.find((row) => row.id === milestoneId)
    if (!target) throw new Error('The milestone is not in the current view.')
    requireEditable(snapshot, target.opportunityId)
    return {
        ...snapshot,
        milestones: snapshot.milestones.map((row) => row.id !== milestoneId ? row : {
            ...row,
            ...(update.status && (writableMilestoneStatuses as readonly string[]).includes(update.status) ? { status: update.status as StagePipelineMilestoneStatus } : {}),
            ...(update.customerCommitment ? { commitment: update.customerCommitment } : {}),
            ...(update.targetDate ? { date: update.targetDate } : {}),
            ...(update.comments !== undefined ? { comment: update.comments } : {})
        })
    }
}
