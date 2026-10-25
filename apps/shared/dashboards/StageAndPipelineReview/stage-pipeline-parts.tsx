import { useState, type ReactElement, type ReactNode } from 'react'
import type { StagePipelineOpportunity } from '../../../../packages/common/contracts/stage-pipeline-review.js'
import { msxRecordUrl, type ReviewMarks } from './stage-pipeline-analysis.js'

export function Kpi({ value, label, tone }: { value: ReactNode; label: string; tone?: 'brand' | 'good' | 'warn' | 'bad' }): ReactElement {
    return <div className={`sprv-kpi${tone ? ` sprv-kpi--${tone}` : ''}`}><strong>{value}</strong><span>{label}</span></div>
}

export function Pill({ tone, children, title }: { tone: 'good' | 'warn' | 'bad' | 'muted' | 'info'; children: ReactNode; title?: string }): ReactElement {
    return <span className={`sprv-badge sprv-badge--${tone}`} title={title}>{children}</span>
}

export function downloadCsv(fileName: string, content: string): void {
    const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
}

export function OpenInMsx({ entity, id, label = 'Open in MSX' }: { entity: 'opportunity' | 'msp_engagementmilestone'; id: string; label?: string }): ReactElement {
    return <a className="sprv-open" href={msxRecordUrl(entity, id)} target="_blank" rel="noopener noreferrer" title={`${label} (opens in your browser)`} aria-label={`${label}: ${id}`}>↗</a>
}

export function RowActions({ row, marks, onToggle, onEdit }: {
    row: StagePipelineOpportunity
    marks: ReviewMarks
    onToggle(kind: keyof ReviewMarks, id: string): void
    onEdit?: (row: StagePipelineOpportunity) => void
}): ReactElement {
    const [copied, setCopied] = useState(false)
    const copy = () => {
        void globalThis.navigator?.clipboard?.writeText(`${row.number} ${row.name}`).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        }, () => undefined)
    }
    return <span className="sprv-row-actions">
        <OpenInMsx entity="opportunity" id={row.id} />
        {onEdit && row.editable && <button type="button" aria-label={`Add forecast comment to ${row.name}`} title="Add forecast comment" onClick={() => onEdit(row)}>✎</button>}
        <button type="button" aria-pressed={marks.focus.has(row.id)} aria-label={`${marks.focus.has(row.id) ? 'Remove focus from' : 'Focus'} ${row.name}`} title="Focus" onClick={() => onToggle('focus', row.id)}>{marks.focus.has(row.id) ? '★' : '☆'}</button>
        <button type="button" aria-pressed={marks.reviewed.has(row.id)} aria-label={`${marks.reviewed.has(row.id) ? 'Unmark' : 'Mark'} ${row.name} as reviewed`} title="Reviewed" onClick={() => onToggle('reviewed', row.id)}>{marks.reviewed.has(row.id) ? '✔' : '✓'}</button>
        <a className="sprv-mail" href={`mailto:?subject=${encodeURIComponent(`${row.customer} - ${row.name}`)}`} aria-label={`Email about ${row.name}`} title="Email">✉</a>
        <button type="button" aria-label={`Copy ${row.number}`} title={copied ? 'Copied' : 'Copy number and name'} onClick={copy}>{copied ? '✓' : '⧉'}</button>
    </span>
}
