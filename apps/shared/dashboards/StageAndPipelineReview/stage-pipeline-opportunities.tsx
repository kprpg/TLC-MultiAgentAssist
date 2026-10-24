import type { ReactElement } from 'react'
import type { StagePipelineOpportunity } from '../../../../packages/common/contracts/stage-pipeline-review.js'
import {
    alertSummary, formatDollars, formatMoney, opportunityCsv, opportunityKpis, reviewAlerts, sumConsumed,
    type OpportunityView, type ReviewAlert, type ReviewMarks
} from './stage-pipeline-analysis.js'
import { Kpi, Pill, RowActions, downloadCsv } from './stage-pipeline-parts.js'
import { ReviewTable, type ReviewColumn } from './stage-pipeline-table.js'

const alertTone: Record<ReviewAlert, string> = {
    overdue: 'red', closing90: 'amber', 'at-risk-commit': 'purple', 'non-azure': 'magenta', competitive: 'teal'
}
const alertGlyph: Record<ReviewAlert, string> = { overdue: '⏰', closing90: '⌛', 'at-risk-commit': '⚠', 'non-azure': '⚑', competitive: '⚔' }

export function AlertCards({ views, active, onSelect }: {
    views: readonly OpportunityView[]
    active: ReviewAlert | ''
    onSelect(alert: ReviewAlert | ''): void
}): ReactElement {
    const summary = alertSummary(views)
    return <div className="sprv-alerts" role="group" aria-label="Opportunity alerts">
        {reviewAlerts.map((alert) => <button key={alert.key} type="button" aria-pressed={active === alert.key}
            className={`sprv-alert sprv-alert--${alertTone[alert.key]}`} onClick={() => onSelect(active === alert.key ? '' : alert.key)}>
            <span className="sprv-alert-glyph" aria-hidden="true">{alertGlyph[alert.key]}</span>
            <strong>{summary[alert.key].count}</strong>
            <span className="sprv-alert-label">{alert.label}</span>
            <small>{formatMoney(summary[alert.key].consumed)} consumed · {alert.hint}</small>
        </button>)}
    </div>
}

export function OpportunityKpis({ views }: { views: readonly OpportunityView[] }): ReactElement {
    const kpis = opportunityKpis(views)
    return <div className="sprv-kpis">
        <Kpi tone="brand" value={formatMoney(kpis.recurring)} label="Recurring consumed" />
        <Kpi value={formatMoney(kpis.nonRecurring)} label="Non-recurring consumed" />
        <Kpi value={kpis.opportunities} label="Opportunities" />
        <Kpi tone="good" value={kpis.consuming} label="Actively consuming" />
        <Kpi tone="bad" value={kpis.overdue} label="Overdue close" />
        <Kpi value={formatMoney(kpis.macc)} label="MACC commit in pipeline" />
    </div>
}

export function OpportunityTable({ views, marks, onToggle, showOwner = false, onEdit }: {
    views: readonly OpportunityView[]
    marks: ReviewMarks
    onToggle(kind: keyof ReviewMarks, id: string): void
    showOwner?: boolean
    onEdit?: (row: StagePipelineOpportunity) => void
}): ReactElement {
    const columns: ReviewColumn<OpportunityView>[] = [
        { key: 'customer', label: 'Customer', value: (view) => view.row.customer },
        ...(showOwner ? [{ key: 'owner', label: 'Owner', value: (view: OpportunityView) => view.row.owner, render: (view: OpportunityView) => <>{view.row.owner || '—'}{!view.row.editable && <small className="sprv-threat">read-only</small>}</> }] : []),
        {
            key: 'opportunity', label: 'Opportunity', value: (view) => view.row.name,
            render: (view) => <><strong>{view.row.name}</strong>{view.row.notes && <small className="sprv-notes">{view.row.notes}</small>}</>
        },
        { key: 'stage', label: 'Stage', value: (view) => view.row.stage },
        { key: 'forecast', label: 'Forecast', value: (view) => view.row.forecast, render: (view) => <Pill tone={view.row.forecast === 'Committed' ? 'good' : 'muted'}>{view.row.forecast}</Pill> },
        { key: 'close', label: 'Close', value: (view) => view.row.closeDate, render: (view) => view.overdueDays > 0 ? <Pill tone="bad">{view.row.closeDate}</Pill> : view.row.closeDate },
        { key: 'days', label: 'Days', numeric: true, value: (view) => view.daysToClose },
        { key: 'consumed', label: 'Consumed', numeric: true, value: (view) => view.consumed, render: (view) => formatDollars(view.consumed) },
        {
            key: 'idle', label: 'Idle (d)', numeric: true, value: (view) => view.row.idleDays,
            render: (view) => view.row.idleDays === null ? '—' : view.row.idleDays >= 30 ? <Pill tone="muted">{view.row.idleDays}</Pill> : view.row.idleDays
        },
        { key: 'partner', label: 'Partner', value: (view) => view.row.partner, render: (view) => view.row.partner ?? '—' },
        {
            key: 'competitor', label: 'Competitor', value: (view) => view.row.competitor.name ?? view.row.competitor.threat,
            render: (view) => <>{view.row.competitor.name ?? 'None'} {view.row.competitor.threat !== 'None' || view.row.competitor.name ? <small className="sprv-threat">{view.row.competitor.threat}</small> : null}</>
        },
        {
            key: 'flags', label: 'Flags', value: (view) => view.overdueDays || view.row.daysInStage,
            render: (view) => <span className="sprv-flags">
                {view.overdueDays > 0 && <Pill tone="bad">Overdue {view.overdueDays}d</Pill>}
                {view.row.daysInStage >= 14 && <Pill tone="warn" title="Days in current stage">{view.row.daysInStage}d</Pill>}
                {view.overdueDays === 0 && view.row.daysInStage < 14 && '—'}
            </span>
        },
        { key: 'actions', label: 'Actions', value: () => null, render: (view) => <RowActions row={view.row} marks={marks} onToggle={onToggle} {...(onEdit ? { onEdit } : {})} /> }
    ]
    return <section className="sprv-card" aria-label="Opportunities">
        <div className="sprv-table-heading">
            <span>{views.length} shown · {formatDollars(sumConsumed(views))} consumed</span>
            <button type="button" onClick={() => downloadCsv('stage-and-pipeline-opportunities.csv', opportunityCsv(views, { includeOwner: showOwner }))}>Export CSV</button>
        </div>
        <ReviewTable caption="Opportunities" columns={columns} rows={views} rowKey={(view) => view.row.id}
            rowClass={(view) => marks.reviewed.has(view.row.id) ? 'sprv-reviewed' : view.overdueDays > 0 ? 'sprv-overdue' : undefined} />
    </section>
}
