import type { KeyboardEvent } from 'react'
import type { MomentumFocusQuery, MomentumSnapshot } from '../../../../packages/common/contracts/momentum-focus.js'

export function MomentumCharts({ snapshot, query, section, onChange, onFilter }: {
    snapshot: MomentumSnapshot
    query: MomentumFocusQuery
    section: 'traction' | 'milestones'
    onChange(changes: Partial<MomentumFocusQuery>): void
    onFilter(changes: Partial<MomentumFocusQuery>): void
}) {
    const charts = snapshot.charts
    const maxProgress = Math.max(1, ...charts.matrix.map((point) => point.progressCount))
    const maxSignals = Math.max(1, ...charts.matrix.map((point) => point.signalCount ?? 0))
    const maxAmount = Math.max(1, ...charts.matrix.map((point) => point.amount ?? 0))
    const accountMetric = (account: MomentumSnapshot['charts']['accounts'][number]) => query.accountSort === 'activity'
        ? account.signalCount : query.accountSort === 'review' ? account.reviewCount : account.advancingShare
    const maxAccountMetric = query.accountSort === 'traction' ? 1 : Math.max(1, ...charts.accounts.map((account) => accountMetric(account) ?? 0))
    const selectPoint = (point: Pick<MomentumSnapshot['charts']['matrix'][number], 'id' | 'entity'>) => onFilter(point.entity === 'opportunity'
        ? { entity: 'opportunity', opportunityIds: [point.id], milestoneIds: [] }
        : { entity: 'milestone', milestoneIds: [point.id], opportunityIds: [] })
    const keyActivate = (event: KeyboardEvent<SVGCircleElement>, action: () => void) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action() }
    }
    return <div className="momentum-charts">
        {section === 'traction' && <>
        <section className="momentum-chart" aria-labelledby="momentum-matrix-title">
            <h3 id="momentum-matrix-title">Progress versus signals</h3>
            <p>Blue: opportunities. Green: milestones. Dashed: partial history. Select a mark to open its priority records.</p>
            <details className="momentum-methodology"><summary>How to read this chart</summary>
                <p>Unknown history is not plotted at zero. Bubble sizes use only the selected currency and value basis. Points can overlap; use the table to inspect each record.</p>
                <p>Opportunity movement includes qualified linked milestone outcomes; milestone marks show their own outcomes. Do not sum progress across the two grains.</p>
            </details>
            <svg role="img" aria-label="Progress versus signals" viewBox="0 0 540 240" className="momentum-matrix">
                <line x1="45" y1="195" x2="510" y2="195" /><line x1="45" y1="195" x2="45" y2="25" />
                <text x="210" y="230">Qualified progress events (X)</text><text x="48" y="17">Dated signals (Y)</text>
                <text x="31" y="212">0</text><text x="490" y="212">{maxProgress}</text><text x="17" y="35">{maxSignals}</text>
                {charts.matrix.filter((point) => point.signalCount !== null).slice(0, 200).map((point) => <circle
                    key={point.key} cx={55 + point.progressCount / maxProgress * 430} cy={185 - point.signalCount! / maxSignals * 140}
                    r={point.amount === null ? 7 : 6 + Math.sqrt(point.amount / maxAmount) * 13}
                    className={`${point.entity} ${point.coverage}`} role="button" tabIndex={0}
                    aria-label={`Select ${point.name}: ${point.progressCount} progress, ${point.signalCount} signals (${point.entity}; ${point.coverage} history)`}
                    onClick={() => selectPoint(point)} onKeyDown={(event) => keyActivate(event, () => selectPoint(point))}>
                    <title>{`${point.name} (${point.entity})`}</title>
                </circle>)}
            </svg>
            <p>{charts.unknownHistoryKeys.length} records have insufficient history. Marks with unknown signal coverage are omitted. {charts.matrix.length > 200 && 'First 200 marks shown; totals and the queue use the full filtered cohort.'}</p>
            <details><summary>Insufficient-history records ({charts.unknownHistoryKeys.length})</summary>
                <button type="button" className="sprv-pill" onClick={() => onFilter({ lens: 'unknown-history' })}>View all insufficient-history records</button>
                <div className="momentum-table-scroll"><ul aria-label="Insufficient-history records">
                    {charts.unknownHistoryKeys.slice(0, 200).map((key) => {
                        const entity = key.startsWith('milestone:') ? 'milestone' : 'opportunity'
                        const id = key.slice(key.indexOf(':') + 1)
                        const name = (entity === 'milestone' ? snapshot.facets.milestones : snapshot.facets.opportunities).find((row) => row.id === id)?.name ?? id
                        return <li key={key}><button type="button" onClick={() => selectPoint({ id, entity })}>{name} ({entity}; unknown movement)</button></li>
                    })}
                </ul></div>
                {charts.unknownHistoryKeys.length > 200 && <p>First 200 references shown. View all to inspect the complete unknown-history queue with pagination.</p>}
            </details>
            <details><summary>Progress and signals table</summary><div className="momentum-table-scroll"><table className="sprv-table momentum-info-table" aria-label="Progress and signals table">
                <thead><tr><th>Entity</th><th>Grain / history coverage</th><th>Progress</th><th>Signals</th></tr></thead>
                <tbody>{charts.matrix.map((point) => <tr key={point.key}><td><button type="button" className="sprv-link" onClick={() => selectPoint(point)}>{point.name}</button></td><td>{point.entity} / {point.coverage}</td><td>{point.progressCount}</td><td>{point.signalCount ?? 'Unknown'}</td></tr>)}</tbody>
            </table></div></details>
        </section>
        <section className="momentum-chart" aria-labelledby="momentum-accounts-title">
            <h3 id="momentum-accounts-title">Top Accounts</h3>
            <label className="momentum-chart-control">Account chart lens<select className="sprv-select" aria-label="Account chart lens" value={query.accountSort} onChange={(event) => onChange({
                accountSort: event.currentTarget.value === 'activity' ? 'activity' : event.currentTarget.value === 'review' ? 'review' : 'traction'
            })}><option value="traction">Traction (advancing share)</option><option value="activity">Activity volume</option><option value="review">Needs review</option></select></label>
            <div className="momentum-account-bars">{charts.accounts.slice(0, 20).map((account) => <button
                type="button" key={account.accountId ?? 'Unknown'} aria-label={`Select ${account.name}: ${account.advancing} of ${account.eligible} eligible active opportunities advancing; ${query.accountSort} ${accountMetric(account) ?? 'Unknown'}`}
                onClick={() => onFilter({ accountIds: [account.accountId ?? 'Unknown'], opportunityIds: [], milestoneIds: [] })}>
                <span>{account.name}</span><strong>{query.accountSort === 'traction' ? account.advancingShare === null ? 'Unknown' : `${Math.round(account.advancingShare * 100)}%` : `${accountMetric(account)} ${query.accountSort === 'activity' ? 'signals' : 'review'}`}</strong>
                <span className="momentum-bar-track"><span style={{ width: `${(accountMetric(account) ?? 0) / maxAccountMetric * 100}%` }} /></span>
                <small>{account.advancing}/{account.eligible} eligible; {account.active} active; {account.signalCount} signals; {account.reviewCount} review</small>
            </button>)}</div>
            <details><summary>Account traction table</summary><div className="momentum-table-scroll"><table className="sprv-table momentum-info-table" aria-label="Account traction table">
                <thead><tr><th>Account</th><th>Advancing / eligible / active</th><th>Progress events</th><th>Latest movement</th></tr></thead>
                <tbody>{charts.accounts.map((account) => <tr key={account.accountId ?? 'Unknown'}><td>{account.name}</td><td>{account.advancing}/{account.eligible}/{account.active}</td><td>{account.progressCount}</td><td>{account.latestMovement ?? 'Unknown'}</td></tr>)}</tbody>
            </table></div></details>
        </section>
        </>}
        {section === 'milestones' && <>
        <section className="momentum-chart" aria-labelledby="momentum-heatmap-title">
            <h3 id="momentum-heatmap-title">Stage by milestone status</h3>
            <label className="momentum-chart-control">Heatmap measure<select className="sprv-select" aria-label="Heatmap measure" value={query.heatmap} onChange={(event) => onChange({ heatmap: event.currentTarget.value === 'value' ? 'value' : 'count' })}>
                <option value="count">Milestone count</option><option value="value" disabled={query.basis !== 'monthly-usage' || !query.currency}>Verified monthly potential (select basis/currency)</option>
            </select></label>
            <div className="momentum-heatmap">{charts.heatmap.map((cell) => <button type="button" key={`${cell.stage}:${cell.status}`}
                aria-label={`${cell.stage} / ${cell.status}: ${query.heatmap === 'count' ? `${cell.count} milestones` : `${cell.value ?? 'Unknown'} ${cell.unit}; ${cell.count} milestones; ${cell.missingValues} missing amounts`}`}
                onClick={() => onFilter({ entity: 'milestone', stages: [cell.stage === 'Unknown stage' ? 'Unknown' : cell.stage], milestoneStatuses: [cell.status === 'Unknown status' ? 'Unknown' : cell.status] })}>
                <span>{cell.stage}</span><span>{cell.status}</span><strong>{query.heatmap === 'count' ? cell.count : cell.value?.toLocaleString('en-US') ?? 'Unknown'}</strong>
                <small>{cell.unit}{cell.missingValues > 0 ? `; ${cell.missingValues} missing amounts` : ''}</small>
            </button>)}</div>
            <details><summary>Stage and status table</summary><div className="momentum-table-scroll"><table className="sprv-table momentum-info-table" aria-label="Stage and status table">
                <thead><tr><th>Parent stage</th><th>Milestone status</th><th>Count</th><th>Selected measure</th></tr></thead>
                <tbody>{charts.heatmap.map((cell) => <tr key={`${cell.stage}:${cell.status}`}><td>{cell.stage}</td><td>{cell.status}</td><td>{cell.count}</td><td>{query.heatmap === 'count' ? cell.count : cell.value ?? 'Unknown'} {cell.unit}</td></tr>)}</tbody>
            </table></div></details>
        </section>
        <section className="momentum-chart" aria-labelledby="momentum-deadlines-title">
            <h3 id="momentum-deadlines-title">Deadline distribution</h3>
            <p>Recorded CRM close/target dates only. Suggested review dates are excluded.</p>
            <div className="momentum-deadlines">{charts.deadlines.map((row) => <button type="button" key={row.bucket} onClick={() => onFilter({ deadline: row.bucket })}>
                <span>{row.bucket.replaceAll('-', ' ')}</span><strong>{row.opportunities + row.milestones}</strong>
                <small>{row.opportunities} opportunities</small>
                <meter min={0} max={Math.max(1, snapshot.total)} value={row.opportunities} aria-label={`${row.bucket} opportunity count`} />
                <small>{row.milestones} milestones</small>
                <meter min={0} max={Math.max(1, snapshot.total)} value={row.milestones} aria-label={`${row.bucket} milestone count`} />
            </button>)}</div>
            <div className="momentum-table-scroll"><table className="sprv-table momentum-info-table" aria-label="Deadline distribution table">
                <thead><tr><th>Recorded deadline</th><th>Opportunities</th><th>Milestones</th></tr></thead>
                <tbody>{charts.deadlines.map((row) => <tr key={row.bucket}><td>{row.bucket}</td><td>{row.opportunities}</td><td>{row.milestones}</td></tr>)}</tbody>
            </table></div>
        </section>
        </>}
    </div>
}
