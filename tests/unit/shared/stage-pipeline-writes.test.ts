import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createSampleStagePipelineReview } from '../../../packages/common/fixtures/stage-pipeline-review.js'
import {
    applySampleMilestoneUpdate, applySampleOpportunityComment, buildMilestoneUpdate, commentDate, composeComment, writableMilestoneStatuses
} from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-writes.js'
import { WriteDialog } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-write-dialog.js'
import { dispatchWrite } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-dispatch.js'
import { RowActions } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-parts.js'
import { emptyMarks } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-storage.js'

const snapshot = createSampleStagePipelineReview()
const milestone = snapshot.milestones.find((row) => row.status === 'On Track' && row.commitment === 'Uncommitted')!

describe('forecast comment composition', () => {
    it('prepends a dated line and preserves earlier history', () => {
        expect(commentDate('2026-10-21')).toBe('21/Oct')
        expect(composeComment('earlier note', 'Customer confirmed scope', '2026-10-21')).toBe('21/Oct - Customer confirmed scope\nearlier note')
        expect(composeComment('', '  First update  ', '2026-01-05')).toBe('05/Jan - First update')
    })

    it('rejects empty or oversized updates', () => {
        expect(() => composeComment('x', '   ', '2026-10-21')).toThrow(/enter an update/i)
        expect(() => composeComment('x'.repeat(29_990), 'y'.repeat(50), '2026-10-21')).toThrow(/30,000/)
    })
})

describe('milestone edit review', () => {
    it('only offers statuses the connector can write', () => {
        expect(writableMilestoneStatuses).toEqual(['On Track', 'At Risk', 'Blocked', 'Completed', 'Cancelled'])
    })

    it('lists changed fields, requires a reason for status, commitment and date changes and records it in the comment', () => {
        const none = buildMilestoneUpdate(milestone, { status: milestone.status, commitment: milestone.commitment, date: milestone.date ?? '', comment: '', reason: '' }, '2026-10-21')
        expect(none).toEqual({ ok: false, error: 'Change at least one field.' })
        const noReason = buildMilestoneUpdate(milestone, { status: 'At Risk', commitment: milestone.commitment, date: milestone.date ?? '', comment: '', reason: '' }, '2026-10-21')
        expect(noReason).toEqual({ ok: false, error: 'Enter a reason of at least 3 characters for a status, commitment or date change.' })
        const result = buildMilestoneUpdate(milestone, { status: 'At Risk', commitment: 'Committed', date: '2026-12-31', comment: 'Waiting on customer', reason: 'Budget review' }, '2026-10-21')
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.changes.map((change) => change.field)).toEqual(['Status', 'Commitment', 'Milestone date', 'Comment'])
        expect(result.update).toMatchObject({ status: 'At Risk', customerCommitment: 'Committed', targetDate: '2026-12-31' })
        expect(result.update.comments).toBe(`21/Oct - Waiting on customer. Reason: Budget review${milestone.comment ? `\n${milestone.comment}` : ''}`)
    })

    it('allows a comment-only change without a reason and rejects an invalid date', () => {
        const comment = buildMilestoneUpdate(milestone, { status: milestone.status, commitment: milestone.commitment, date: milestone.date ?? '', comment: 'FYI', reason: '' }, '2026-10-21')
        expect(comment.ok && Object.keys(comment.update)).toEqual(['comments'])
        expect(buildMilestoneUpdate(milestone, { status: milestone.status, commitment: milestone.commitment, date: '31/12/2026', comment: '', reason: 'x'.repeat(5) }, '2026-10-21'))
            .toEqual({ ok: false, error: 'Enter the milestone date as YYYY-MM-DD.' })
    })
})

describe('sample-mode write simulation', () => {
    it('updates only the targeted opportunity comment in memory', () => {
        const target = snapshot.opportunities[2]!
        const updated = applySampleOpportunityComment(snapshot, target.id, 'new text')
        expect(updated.opportunities[2]!.notes).toBe('new text')
        expect(updated.opportunities.filter((row, index) => index !== 2 && row.notes !== snapshot.opportunities[index]!.notes)).toHaveLength(0)
        expect(snapshot.opportunities[2]!.notes).not.toBe('new text')
    })

    it('applies milestone updates and refuses read-only report rows', () => {
        const updated = applySampleMilestoneUpdate(snapshot, milestone.id, { status: 'Blocked', customerCommitment: 'Committed', targetDate: '2027-01-31', comments: 'c' })
        const row = updated.milestones.find((item) => item.id === milestone.id)!
        expect(row).toMatchObject({ status: 'Blocked', commitment: 'Committed', date: '2027-01-31', comment: 'c' })
        const manager = createSampleStagePipelineReview({ scope: 'both' })
        const readOnly = manager.milestones.find((item) => item.id.startsWith('sample-rpt-'))!
        expect(() => applySampleMilestoneUpdate(manager, readOnly.id, { comments: 'x' })).toThrow(/read-only/i)
        expect(() => applySampleOpportunityComment(manager, manager.opportunities.find((row) => !row.editable)!.id, 'x')).toThrow(/read-only/i)
    })
})

describe('write dialog and row actions', () => {
    it('dispatches reviewed actions to the existing MSX write operations only', async () => {
        const writes = { updateOpportunity: vi.fn(async () => undefined), updateMilestone: vi.fn(async () => undefined), createMilestoneActivity: vi.fn(async () => undefined) }
        await dispatchWrite(writes, { kind: 'comment', opportunityId: 'o1', comments: 'c' })
        await dispatchWrite(writes, { kind: 'milestone', opportunityId: 'o1', milestoneId: 'm1', update: { status: 'At Risk', comments: 'x' } })
        await dispatchWrite(writes, { kind: 'task', opportunityId: 'o1', milestoneId: 'm1', request: { subject: 'Demo', priority: 'Normal' } })
        expect(writes.updateOpportunity).toHaveBeenCalledWith('o1', { comments: 'c' })
        expect(writes.updateMilestone).toHaveBeenCalledWith('o1', 'm1', { status: 'At Risk', comments: 'x' })
        expect(writes.createMilestoneActivity).toHaveBeenCalledWith('o1', 'm1', { subject: 'Demo', priority: 'Normal' })
        writes.updateOpportunity.mockRejectedValueOnce(new Error('MSX update failed with status 412.'))
        await expect(dispatchWrite(writes, { kind: 'comment', opportunityId: 'o1', comments: 'c' })).rejects.toThrow('412')
    })

    const noop = vi.fn()
    it('renders a review dialog for a forecast comment with the resulting comment preview', () => {
        const row = snapshot.opportunities[0]!
        const markup = renderToStaticMarkup(createElement(WriteDialog, {
            target: { kind: 'comment', opportunity: row }, today: '2026-10-21', busy: false, error: '', onCancel: noop, onSubmit: noop
        }))
        expect(markup).toContain('role="dialog"')
        expect(markup).toContain('aria-modal="true"')
        expect(markup).toContain('Add forecast comment')
        expect(markup).toContain(row.name)
        expect(markup).toContain('Open in MSX')
        expect(markup).toContain('disabled')
    })

    it('renders milestone and task dialogs with only writable statuses', () => {
        const parent = snapshot.opportunities.find((row) => row.id === milestone.opportunityId)!
        const edit = renderToStaticMarkup(createElement(WriteDialog, { target: { kind: 'milestone', milestone, opportunity: parent }, today: '2026-10-21', busy: false, error: '', onCancel: noop, onSubmit: noop }))
        for (const status of writableMilestoneStatuses) expect(edit).toContain(`>${status}<`)
        expect(edit).not.toContain('>Lost to Competitor<')
        const task = renderToStaticMarkup(createElement(WriteDialog, { target: { kind: 'task', milestone, opportunity: parent }, today: '2026-10-21', busy: false, error: 'Save failed', onCancel: noop, onSubmit: noop }))
        expect(task).toContain('Create milestone task')
        expect(task).toContain('Save failed')
    })

    it('shows write actions only for editable rows when writes are available', () => {
        const row = snapshot.opportunities[0]!
        const withEdit = renderToStaticMarkup(createElement(RowActions, { row, marks: emptyMarks, onToggle: noop, onEdit: noop }))
        expect(withEdit).toContain(`Add forecast comment to ${row.name}`)
        const readOnly = renderToStaticMarkup(createElement(RowActions, { row: { ...row, editable: false }, marks: emptyMarks, onToggle: noop, onEdit: noop }))
        expect(readOnly).not.toContain('Add forecast comment')
        expect(renderToStaticMarkup(createElement(RowActions, { row, marks: emptyMarks, onToggle: noop }))).not.toContain('Add forecast comment')
    })
})
