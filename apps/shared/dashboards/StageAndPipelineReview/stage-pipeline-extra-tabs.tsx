import type { ReactElement } from 'react'
import { formatDollars, formatMoney, sumConsumed, type OpportunityView, type ReviewAction, type ReviewMarks } from './stage-pipeline-analysis.js'
import { Kpi, OpenInMsx, Pill, RowActions } from './stage-pipeline-parts.js'
import { ReviewTable, type ReviewColumn } from './stage-pipeline-table.js'

type Toggle = (kind: keyof ReviewMarks, id: string) => void

export function ActionsTab({ actions, views }: { actions: readonly ReviewAction[]; views: readonly OpportunityView[] }): ReactElement {
    const byId = new Map(views.map((view) => [view.row.id, view]))
    const columns: ReviewColumn<ReviewAction>[] = [
        { key: 'priority', label: 'Priority', value: (action) => ({ High: 0, Medium: 1, Low: 2 })[action.priority], render: (action) => <Pill tone={action.priority === 'High' ? 'bad' : action.priority === 'Medium' ? 'warn' : 'muted'}>{action.priority}</Pill> },
        { key: 'customer', label: 'Customer', value: (action) => byId.get(action.opportunityId)?.row.customer ?? '' },
        { key: 'opportunity', label: 'Opportunity', value: (action) => byId.get(action.opportunityId)?.row.name ?? '' },
        { key: 'action', label: 'Recommended action', value: (action) => action.title, render: (action) => <strong>{action.title}</strong> },
        { key: 'reason', label: 'Why', value: (action) => action.reason },
        { key: 'due', label: 'Close date', value: (action) => action.due },
        { key: 'consumed', label: 'Consumed', numeric: true, value: (action) => byId.get(action.opportunityId)?.consumed ?? 0, render: (action) => formatDollars(byId.get(action.opportunityId)?.consumed ?? 0) },
        { key: 'open', label: 'Open in MSX', value: () => null, render: (action) => <OpenInMsx entity="opportunity" id={action.opportunityId} /> }
    ]
    const counts = { High: 0, Medium: 0, Low: 0 }
    for (const action of actions) counts[action.priority] += 1
    return <>
        <p className="sprv-muted">Next-best actions derived from the opportunity alerts in the current scope. Each row is a prompt to review, not a CRM change.</p>
        <div className="sprv-kpis">
            <Kpi value={actions.length} label="Actions" />
            <Kpi tone="bad" value={counts.High} label="High priority" />
            <Kpi tone="warn" value={counts.Medium} label="Medium priority" />
            <Kpi value={counts.Low} label="Low priority" />
        </div>
        <section className="sprv-card" aria-label="Actions"><ReviewTable caption="Actions" columns={columns} rows={actions} rowKey={(action) => action.id} /></section>
    </>
}

export function ConsumptionTab({ views, marks, onToggle }: { views: readonly OpportunityView[]; marks: ReviewMarks; onToggle: Toggle }): ReactElement {
    const consuming = views.filter((view) => view.consumed > 0)
    const byCustomer = [...consuming.reduce((map, view) => map.set(view.row.customer, (map.get(view.row.customer) ?? 0) + view.consumed), new Map<string, number>())]
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
    const max = Math.max(1, ...byCustomer.map(([, value]) => value))
    const columns: ReviewColumn<OpportunityView>[] = [
        { key: 'customer', label: 'Customer', value: (view) => view.row.customer },
        { key: 'opportunity', label: 'Opportunity', value: (view) => view.row.name, render: (view) => <strong>{view.row.name}</strong> },
        { key: 'stage', label: 'Stage', value: (view) => view.row.stage },
        { key: 'recurring', label: 'Recurring', numeric: true, value: (view) => view.row.consumedRecurring, render: (view) => formatDollars(view.row.consumedRecurring) },
        { key: 'non', label: 'Non-recurring', numeric: true, value: (view) => view.row.consumedNonRecurring, render: (view) => formatDollars(view.row.consumedNonRecurring) },
        { key: 'total', label: 'Total consumed', numeric: true, value: (view) => view.consumed, render: (view) => formatDollars(view.consumed) },
        { key: 'idle', label: 'Idle (d)', numeric: true, value: (view) => view.row.idleDays, render: (view) => view.row.idleDays !== null && view.row.idleDays >= 30 ? <Pill tone="muted">{view.row.idleDays}</Pill> : view.row.idleDays ?? '—' },
        { key: 'actions', label: 'Actions', value: () => null, render: (view) => <RowActions row={view.row} marks={marks} onToggle={onToggle} /> }
    ]
    return <>
        <p className="sprv-muted">Opportunities that are actively consuming Azure in the current scope, using MSX Consumption Consumed fields.</p>
        <div className="sprv-kpis">
            <Kpi tone="good" value={consuming.length} label="Actively consuming" />
            <Kpi tone="brand" value={formatMoney(sumConsumed(consuming))} label="Total consumed" />
            <Kpi value={consuming.filter((view) => view.row.idleDays !== null && view.row.idleDays >= 30).length} label="Idle 30+ days" />
        </div>
        <section className="sprv-card" aria-label="Top customers by consumption">
            <h2>Top customers by consumed $</h2>
            <ul className="sprv-bars">{byCustomer.map(([customer, value]) => <li key={customer}>
                <div><span className="sprv-bar-name">{customer}</span>
                    <span className="sprv-bar-track"><span className="sprv-bar-fill" style={{ width: `${(value / max) * 100}%`, background: 'var(--sprv-brand)' }} /></span>
                    <span className="sprv-bar-count">{formatMoney(value)}</span></div>
            </li>)}</ul>
        </section>
        <section className="sprv-card" aria-label="Consumption"><ReviewTable caption="Consumption" columns={columns} rows={consuming} rowKey={(view) => view.row.id} /></section>
    </>
}

export function MaccTab({ views, marks, onToggle }: { views: readonly OpportunityView[]; marks: ReviewMarks; onToggle: Toggle }): ReactElement {
    const macc = views.filter((view) => view.row.maccCommit > 0)
    const committed = macc.filter((view) => view.row.forecast === 'Committed')
    const columns: ReviewColumn<OpportunityView>[] = [
        { key: 'customer', label: 'Customer', value: (view) => view.row.customer },
        { key: 'opportunity', label: 'Opportunity', value: (view) => view.row.name, render: (view) => <strong>{view.row.name}</strong> },
        { key: 'macc', label: 'MACC commit', numeric: true, value: (view) => view.row.maccCommit, render: (view) => formatDollars(view.row.maccCommit) },
        { key: 'consumed', label: 'Consumed', numeric: true, value: (view) => view.consumed, render: (view) => formatDollars(view.consumed) },
        { key: 'burn', label: 'Burn', numeric: true, value: (view) => view.consumed / view.row.maccCommit, render: (view) => `${((view.consumed / view.row.maccCommit) * 100).toFixed(1)}%` },
        { key: 'forecast', label: 'Forecast', value: (view) => view.row.forecast, render: (view) => <Pill tone={view.row.forecast === 'Committed' ? 'good' : 'muted'}>{view.row.forecast}</Pill> },
        { key: 'close', label: 'Close', value: (view) => view.row.closeDate, render: (view) => view.overdueDays > 0 ? <Pill tone="bad">{view.row.closeDate}</Pill> : view.row.closeDate },
        { key: 'actions', label: 'Actions', value: () => null, render: (view) => <RowActions row={view.row} marks={marks} onToggle={onToggle} /> }
    ]
    return <>
        <p className="sprv-muted">Opportunities carrying a MACC (Microsoft Azure Consumption Commitment) in the current scope. Burn = consumed ÷ commit.</p>
        <div className="sprv-kpis">
            <Kpi value={macc.length} label="MACC opportunities" />
            <Kpi tone="brand" value={formatMoney(macc.reduce((sum, view) => sum + view.row.maccCommit, 0))} label="MACC commit in pipeline" />
            <Kpi tone="good" value={committed.length} label="Committed forecast" />
            <Kpi value={formatMoney(sumConsumed(macc))} label="Consumed on MACC opps" />
        </div>
        <section className="sprv-card" aria-label="MACC and commits"><ReviewTable caption="MACC and commits" columns={columns} rows={macc} rowKey={(view) => view.row.id} /></section>
    </>
}
