import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { milestoneActivityPrioritySchema, taskCategorySchema, type CreateMilestoneActivityRequest, type MilestoneUpdate } from '../../../../packages/common/contracts/index.js'
import type { StagePipelineMilestone, StagePipelineMilestoneStatus, StagePipelineOpportunity } from '../../../../packages/common/contracts/stage-pipeline-review.js'
import { OpenInMsx } from './stage-pipeline-parts.js'
import { buildMilestoneUpdate, composeComment, writableMilestoneStatuses } from './stage-pipeline-writes.js'

export type WriteTarget =
    | { kind: 'comment'; opportunity: StagePipelineOpportunity }
    | { kind: 'milestone'; milestone: StagePipelineMilestone; opportunity: StagePipelineOpportunity }
    | { kind: 'task'; milestone: StagePipelineMilestone; opportunity: StagePipelineOpportunity }

export type WriteAction =
    | { kind: 'comment'; opportunityId: string; comments: string }
    | { kind: 'milestone'; opportunityId: string; milestoneId: string; update: MilestoneUpdate }
    | { kind: 'task'; opportunityId: string; milestoneId: string; request: CreateMilestoneActivityRequest }

const titles = { comment: 'Add forecast comment', milestone: 'Update milestone', task: 'Create milestone task' } as const

export function WriteDialog({ target, today, busy, error, onCancel, onSubmit }: {
    target: WriteTarget
    today: string
    busy: boolean
    error: string
    onCancel(): void
    onSubmit(action: WriteAction): void
}): ReactElement {
    useEffect(() => {
        const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel() }
        document.addEventListener('keydown', close)
        return () => document.removeEventListener('keydown', close)
    }, [busy, onCancel])
    const titleId = `sprv-dialog-title-${target.kind}`
    return <div className="sprv-dialog-backdrop">
        <div className="sprv-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <header>
                <h2 id={titleId}>{titles[target.kind]}</h2>
                <p className="sprv-muted">
                    <strong>{target.opportunity.name}</strong> · {target.opportunity.customer} <OpenInMsx entity="opportunity" id={target.opportunity.id} />
                    {target.kind !== 'comment' && <> · milestone <strong>{target.milestone.name}</strong></>}
                </p>
            </header>
            {target.kind === 'comment' && <CommentForm target={target} today={today} busy={busy} onSubmit={onSubmit} />}
            {target.kind === 'milestone' && <MilestoneForm target={target} today={today} busy={busy} onSubmit={onSubmit} />}
            {target.kind === 'task' && <TaskForm target={target} busy={busy} onSubmit={onSubmit} />}
            {error && <p className="sprv-error" role="alert">{error}</p>}
            <footer className="sprv-dialog-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></footer>
        </div>
    </div>
}

function Submit({ disabled, busy, label }: { disabled: boolean; busy: boolean; label: string }): ReactElement {
    return <button type="submit" className="sprv-primary" disabled={disabled || busy}>{busy ? 'Saving…' : label}</button>
}

function CommentForm({ target, today, busy, onSubmit }: { target: Extract<WriteTarget, { kind: 'comment' }>; today: string; busy: boolean; onSubmit(action: WriteAction): void }): ReactElement {
    const [text, setText] = useState('')
    const preview = useMemo(() => {
        try { return { value: text.trim() ? composeComment(target.opportunity.notes, text, today) : '', error: '' } } catch (error) {
            return { value: '', error: error instanceof Error ? error.message : 'Invalid update.' }
        }
    }, [text, target.opportunity.notes, today])
    return <form onSubmit={(event) => { event.preventDefault(); if (preview.value) onSubmit({ kind: 'comment', opportunityId: target.opportunity.id, comments: preview.value }) }}>
        <label className="sprv-field">New update
            <textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} rows={3} maxLength={2000} />
        </label>
        {preview.error && <p className="sprv-error" role="alert">{preview.error}</p>}
        <div className="sprv-review" aria-label="Review the resulting comment">
            <strong>Resulting forecast comment</strong>
            <pre>{preview.value || 'Type an update to preview the resulting comment. Earlier history is kept below the new line.'}</pre>
        </div>
        <Submit disabled={!preview.value} busy={busy} label="Save to MSX" />
    </form>
}

function MilestoneForm({ target, today, busy, onSubmit }: { target: Extract<WriteTarget, { kind: 'milestone' }>; today: string; busy: boolean; onSubmit(action: WriteAction): void }): ReactElement {
    const { milestone } = target
    const [status, setStatus] = useState<StagePipelineMilestoneStatus>(milestone.status)
    const [commitment, setCommitment] = useState(milestone.commitment)
    const [date, setDate] = useState(milestone.date ?? '')
    const [comment, setComment] = useState('')
    const [reason, setReason] = useState('')
    const result = useMemo(() => buildMilestoneUpdate(milestone, { status, commitment, date, comment, reason }, today), [milestone, status, commitment, date, comment, reason, today])
    const statuses: StagePipelineMilestoneStatus[] = (writableMilestoneStatuses as readonly string[]).includes(milestone.status) ? [...writableMilestoneStatuses] : [milestone.status, ...writableMilestoneStatuses]
    return <form onSubmit={(event) => { event.preventDefault(); if (result.ok) onSubmit({ kind: 'milestone', opportunityId: target.opportunity.id, milestoneId: milestone.id, update: result.update }) }}>
        <div className="sprv-form-grid">
            <label className="sprv-field">Status
                <select value={status} onChange={(event) => setStatus(event.target.value as StagePipelineMilestoneStatus)}>
                    {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
            </label>
            <label className="sprv-field">Commitment
                <select value={commitment} onChange={(event) => setCommitment(event.target.value as typeof commitment)}>
                    <option value="Uncommitted">Uncommitted</option><option value="Committed">Committed</option>
                </select>
            </label>
            <label className="sprv-field">Milestone date
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
        </div>
        <label className="sprv-field">Comment (optional)
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} maxLength={2000} />
        </label>
        <label className="sprv-field">Reason (required for status, commitment or date changes)
            <input type="text" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} />
        </label>
        <div className="sprv-review" aria-label="Review the changes">
            <strong>Changes</strong>
            {result.ok
                ? <ul>{result.changes.map((change) => <li key={change.field}>{change.field}: <em>{change.from}</em> → <strong>{change.to}</strong></li>)}</ul>
                : <p className="sprv-muted">{result.error}</p>}
        </div>
        <Submit disabled={!result.ok} busy={busy} label="Save to MSX" />
    </form>
}

function TaskForm({ target, busy, onSubmit }: { target: Extract<WriteTarget, { kind: 'task' }>; busy: boolean; onSubmit(action: WriteAction): void }): ReactElement {
    const [subject, setSubject] = useState('')
    const [category, setCategory] = useState('')
    const [priority, setPriority] = useState<'Low' | 'Normal' | 'High'>('Normal')
    const [due, setDue] = useState('')
    const [description, setDescription] = useState('')
    const valid = subject.trim().length > 0
    return <form onSubmit={(event) => {
        event.preventDefault()
        if (!valid) return
        const parsedCategory = taskCategorySchema.safeParse(category)
        onSubmit({
            kind: 'task', opportunityId: target.opportunity.id, milestoneId: target.milestone.id,
            request: {
                subject: subject.trim(), priority,
                ...(parsedCategory.success ? { taskCategory: parsedCategory.data } : {}),
                ...(due ? { due } : {}), ...(description.trim() ? { description: description.trim() } : {})
            }
        })
    }}>
        <label className="sprv-field">Subject
            <input type="text" autoFocus value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} />
        </label>
        <div className="sprv-form-grid">
            <label className="sprv-field">Category
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option value="">No category</option>
                    {taskCategorySchema.options.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
            </label>
            <label className="sprv-field">Priority
                <select value={priority} onChange={(event) => setPriority(milestoneActivityPrioritySchema.parse(event.target.value))}>
                    {milestoneActivityPrioritySchema.options.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
            </label>
            <label className="sprv-field">Due
                <input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </label>
        </div>
        <label className="sprv-field">Description (optional)
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={2000} />
        </label>
        <Submit disabled={!valid} busy={busy} label="Create task in MSX" />
    </form>
}
