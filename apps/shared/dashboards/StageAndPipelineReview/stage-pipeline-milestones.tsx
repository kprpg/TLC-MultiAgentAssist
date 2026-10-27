import { useMemo, useState, type ReactElement } from 'react'
import {
    stagePipelineMilestoneStatuses, type StagePipelineMilestone, type StagePipelineMilestoneStatus, type StagePipelineOpportunity
} from '../../../../packages/common/contracts/stage-pipeline-review.js'
import {
    distinctSorted, emptyMilestoneFilters, filterMilestoneRows, formatDollars, isMilestonePastDue, milestoneCsv, milestoneKpis, milestoneStatusCounts,
    msxRecordUrl, type MilestoneFilters
} from './stage-pipeline-analysis.js'
import { MultiSelect } from './stage-pipeline-filters.js'
import { Kpi, Pill, downloadCsv } from './stage-pipeline-parts.js'
import { ReviewTable, type ReviewColumn } from './stage-pipeline-table.js'

const statusColor: Record<StagePipelineMilestoneStatus, string> = {
    'On Track': 'var(--sprv-brand)', 'At Risk': 'var(--sprv-blue)', Blocked: 'var(--sprv-green)', Completed: 'var(--sprv-salmon)',
    Cancelled: 'var(--sprv-purple)', 'Hygiene/Duplicate': 'var(--sprv-brand)', 'Lost to Competitor': 'var(--sprv-teal)'
}
const statusTone = (status: StagePipelineMilestoneStatus): 'good' | 'warn' | 'bad' | 'muted' =>
    status === 'On Track' ? 'good' : status === 'At Risk' ? 'warn' : status === 'Blocked' ? 'bad' : 'muted'

function CommentCell({ text }: { text: string }): ReactElement {
    const [expanded, setExpanded] = useState(false)
    if (!text) return <>—</>
    if (text.length <= 140) return <>{text}</>
    return <>{expanded ? text : `${text.slice(0, 140)}…`} <button type="button" className="sprv-link" onClick={() => setExpanded(!expanded)}>{expanded ? '(less)' : '(more)'}</button></>
}

function OpenMilestone({ row, parent }: { row: StagePipelineMilestone; parent: StagePipelineOpportunity | undefined }): ReactElement {
    const [target, setTarget] = useState<'milestone' | 'opportunity'>('milestone')
    const name = `sprv-open-${row.id}`
    const url = target === 'milestone' || !parent ? msxRecordUrl('msp_engagementmilestone', row.id) : msxRecordUrl('opportunity', parent.id)
    return <div className="sprv-open-milestone">
        <label><input type="radio" name={name} checked={target === 'milestone'} onChange={() => setTarget('milestone')} />Milestone</label>
        <label><input type="radio" name={name} checked={target === 'opportunity'} onChange={() => setTarget('opportunity')} />Opportunity</label>
        <a className="sprv-open-button" href={url} target="_blank" rel="noopener noreferrer">↗ Open</a>
    </div>
}

export function MilestonesTab({ scopeRows, filters, onFilters, asOf, opportunities, actions }: {
    scopeRows: readonly StagePipelineMilestone[]
    filters: MilestoneFilters
    onFilters(next: MilestoneFilters): void
    asOf: string
    opportunities: ReadonlyMap<string, StagePipelineOpportunity>
    actions?: { onUpdate(row: StagePipelineMilestone): void; onTask(row: StagePipelineMilestone): void }
}): ReactElement {
    const rows = useMemo(() => filterMilestoneRows(scopeRows, filters, asOf), [scopeRows, filters, asOf])
    const kpis = milestoneKpis(rows, asOf)
    const totals = milestoneStatusCounts(scopeRows)
    const visible = milestoneStatusCounts(rows)
    const max = Math.max(1, ...Object.values(totals))
    const overdueCount = milestoneKpis(scopeRows, asOf).pastDue
    const owners = distinctSorted(scopeRows.map((row) => row.owner))
    const toggleStatus = (status: StagePipelineMilestoneStatus) => onFilters({
        ...filters, statuses: filters.statuses.includes(status) ? filters.statuses.filter((item) => item !== status) : [...filters.statuses, status]
    })
    const columns: ReviewColumn<StagePipelineMilestone>[] = [
        { key: 'account', label: 'Account', value: (row) => opportunities.get(row.opportunityId)?.customer ?? '' },
        {
            key: 'opportunity', label: 'Opportunity', value: (row) => opportunities.get(row.opportunityId)?.name ?? '',
            render: (row) => <><strong>{opportunities.get(row.opportunityId)?.name}</strong><small className="sprv-notes">{opportunities.get(row.opportunityId)?.number}</small></>
        },
        { key: 'milestone', label: 'Milestone', value: (row) => row.name, render: (row) => <><strong>{row.name}</strong><small className="sprv-notes">{row.number}{row.workload ? ` · ${row.workload}` : ''}</small></> },
        { key: 'acr', label: 'Est. ACR / mo', numeric: true, value: (row) => row.estimatedMonthlyAcr, render: (row) => formatDollars(row.estimatedMonthlyAcr) },
        { key: 'commitment', label: 'Commitment', value: (row) => row.commitment, render: (row) => <Pill tone={row.commitment === 'Committed' ? 'good' : 'muted'}>{row.commitment}</Pill> },
        { key: 'status', label: 'Status', value: (row) => row.status, render: (row) => <Pill tone={statusTone(row.status)}>{row.status}</Pill> },
        { key: 'date', label: 'Milestone date', value: (row) => row.date, render: (row) => row.date ? isMilestonePastDue(row, asOf) ? <Pill tone="bad">{row.date}</Pill> : row.date : '—' },
        { key: 'comment', label: 'Milestone comment', value: (row) => row.comment, render: (row) => <CommentCell text={row.comment} /> },
        { key: 'owner', label: 'Owner', value: (row) => row.owner },
        { key: 'open', label: 'Open in MSX', value: () => null, render: (row) => <OpenMilestone row={row} parent={opportunities.get(row.opportunityId)} /> },
        ...(actions ? [{
            key: 'write', label: 'Actions', value: () => null,
            render: (row: StagePipelineMilestone) => opportunities.get(row.opportunityId)?.editable
                ? <span className="sprv-row-actions">
                    <button type="button" aria-label={`Update milestone ${row.name}`} title="Update milestone" onClick={() => actions.onUpdate(row)}>✎</button>
                    <button type="button" aria-label={`Create task for ${row.name}`} title="Create task" onClick={() => actions.onTask(row)}>＋</button>
                </span>
                : <span className="sprv-muted">read-only</span>
        } satisfies ReviewColumn<StagePipelineMilestone>] : [])
    ]
    return <>
        <p className="sprv-muted">Milestones under the opportunities in the current scope (the top filters, scope and slicers apply). ACR = Est. change in monthly usage. Pick Milestone or Opportunity on a row, then click ↗ to open it in MSX.</p>
        <div className="sprv-kpis">
            <Kpi value={kpis.shown} label="Milestones shown" />
            <Kpi tone="brand" value={formatDollars(kpis.openAcr)} label="Open est. monthly ACR" />
            <Kpi tone="good" value={kpis.committed} label="Open · committed" />
            <Kpi value={kpis.uncommitted} label="Open · uncommitted" />
            <Kpi tone="warn" value={kpis.atRisk} label="At risk / blocked" />
            <Kpi tone="bad" value={kpis.pastDue} label="Past due (still open)" />
        </div>
        <section className="sprv-card" aria-label="Milestones by status">
            <h2>Milestones by status <span className="sprv-muted sprv-aside">click to filter</span></h2>
            <ul className="sprv-bars">
                {stagePipelineMilestoneStatuses.map((status) => <li key={status} className={filters.statuses.includes(status) ? 'active' : undefined}>
                    <button type="button" aria-pressed={filters.statuses.includes(status)} aria-label={`Filter milestones by ${status}`} onClick={() => toggleStatus(status)}>
                        <span className="sprv-bar-name">{status}</span>
                        <span className="sprv-bar-track"><span className="sprv-bar-fill" style={{ width: `${Math.max(totals[status] > 0 ? 2 : 0, (totals[status] / max) * 100)}%`, background: statusColor[status] }} /></span>
                        <span className="sprv-bar-count">{visible[status]} <small>· {totals[status]}</small></span>
                    </button>
                </li>)}
            </ul>
        </section>
        <section className="sprv-card" aria-label="Milestone list">
            <div className="sprv-milestone-filters">
                <MultiSelect<StagePipelineMilestoneStatus> label="Statuses" allLabel="All statuses" selected={filters.statuses} onChange={(statuses) => onFilters({ ...filters, statuses })}
                    options={stagePipelineMilestoneStatuses.map((status) => ({ value: status, count: totals[status] }))} />
                <select className="sprv-select" aria-label="Commitment" value={filters.commitment} onChange={(event) => onFilters({ ...filters, commitment: event.target.value })}>
                    <option value="">All commitments</option><option value="Committed">Committed</option><option value="Uncommitted">Uncommitted</option>
                </select>
                <select className="sprv-select" aria-label="Owner" value={filters.owner} onChange={(event) => onFilters({ ...filters, owner: event.target.value })}>
                    <option value="">All owners</option>{owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
                </select>
                <button type="button" className={filters.openOnly ? 'sprv-pill sprv-pill--active' : 'sprv-pill'} aria-pressed={filters.openOnly} onClick={() => onFilters({ ...filters, openOnly: !filters.openOnly })}>Open milestones only</button>
                <button type="button" className={filters.overdueOnly ? 'sprv-pill sprv-pill--active' : 'sprv-pill'} aria-pressed={filters.overdueOnly} onClick={() => onFilters({ ...filters, overdueOnly: !filters.overdueOnly })}>⏰ Overdue milestones ({overdueCount})</button>
                <button type="button" className="sprv-reset" onClick={() => onFilters(emptyMilestoneFilters)}>Clear milestone filters</button>
                <button type="button" className="sprv-push" onClick={() => downloadCsv('stage-and-pipeline-milestones.csv', milestoneCsv(rows, opportunities))}>Export CSV</button>
            </div>
            <p className="sprv-summary">{kpis.shown} milestones across {kpis.opportunities} opportunities · {formatDollars(kpis.openAcr)} open est. monthly ACR</p>
            <ReviewTable caption="Milestones" columns={columns} rows={rows} rowKey={(row) => row.id} />
        </section>
    </>
}
