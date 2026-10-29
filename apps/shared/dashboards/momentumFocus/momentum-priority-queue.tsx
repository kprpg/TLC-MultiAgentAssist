import type { MomentumFocusQuery, MomentumSnapshot } from '../../../../packages/common/contracts/momentum-focus.js'
import { momentumTierLabels, momentumValue } from './momentum-format.js'

export function MomentumPriorityQueue({ snapshot, query, busy, onChange, onSelect }: {
    snapshot: MomentumSnapshot
    query: MomentumFocusQuery
    busy: boolean
    onChange(changes: Partial<MomentumFocusQuery>): void
    onSelect(key: string): void
}) {
    return <section aria-labelledby="momentum-queue-title" className="momentum-queue">
        <div className="sprv-table-heading momentum-queue-heading">
            <div><h2 id="momentum-queue-title">Priority queue</h2><span data-testid="momentum-total">{snapshot.total} filtered records</span></div>
            <label className="momentum-page-size">Rows per page<select className="sprv-select" aria-label="Rows per page" value={query.pageSize}
                onChange={(event) => onChange({ pageSize: Number(event.currentTarget.value) })}>
                {[2, 10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select></label>
        </div>
        <div className="sprv-table-wrap momentum-queue-scroll" tabIndex={0} role="region" aria-label="Priority queue; scrollable">
            <table className="sprv-table momentum-queue-table" aria-label="Momentum priority queue">
                <colgroup><col className="momentum-col-entity" /><col className="momentum-col-stage" /><col className="momentum-col-date" />
                    <col className="momentum-col-value" /><col className="momentum-col-priority" /><col className="momentum-col-evidence" /><col className="momentum-col-action" /></colgroup>
                <thead><tr><th scope="col">Entity / customer</th><th scope="col">Stage / status</th><th scope="col">Recorded date</th>
                    <th scope="col">Value</th><th scope="col">Priority / why now</th><th scope="col">Evidence</th><th scope="col">Next step</th></tr></thead>
                <tbody>{snapshot.rows.map((row) => <tr key={row.key} className={row.tier === 'act-now' ? 'sprv-overdue' : undefined}>
                    <th scope="row">
                        <button type="button" className="sprv-link momentum-entity-link" title={row.name} onClick={() => onSelect(row.key)} aria-label={`Why ${row.name}?`}>
                            <span className="momentum-clamp">{row.name}</span>
                        </button>
                        <small className="momentum-ellipsis" title={`${row.entity} / ${row.accountName ?? 'Unknown account'}`}>{row.entity} / {row.accountName ?? 'Unknown account'}</small>
                    </th>
                    <td><span className="momentum-clamp">{row.stage ?? 'Unknown stage'}</span><small>{row.status ?? 'Unknown status'}</small></td>
                    <td className="momentum-date">{row.dueDate ?? 'Unknown'}{row.reviewDate && <small>Review {row.reviewDate}<br />(suggested, not CRM)</small>}</td>
                    <td><span className="momentum-amount">{momentumValue(row.value)}</span><small>{row.value.basis === 'pipeline' ? 'Pipeline value' : 'Monthly rate'}</small></td>
                    <td><span className={`sprv-badge momentum-tier ${row.tier}`}>{momentumTierLabels[row.tier]}</span>
                        <small className="momentum-clamp" title={row.reasons[0]?.text}>{row.reasons[0]?.text ?? 'Verify the next source-backed checkpoint.'}</small></td>
                    <td><span>{row.progressCount ?? 'Unknown'} progress / {row.signalCount ?? 'Unknown'} signals</span>
                        <small>{row.sourceQuality} sources</small><small>{row.historyCoverage} history</small></td>
                    <td><span className="momentum-clamp" title={row.nextAction}>{row.nextAction}</span></td>
                </tr>)}</tbody>
            </table>
            {snapshot.total === 0 && <p className="sprv-empty">No records match the current authorized selection. Clear filters or refresh; no scope is widened automatically.</p>}
        </div>
        <div className="sprv-table-footer momentum-pagination">
            <span>Page {query.page} of {Math.max(1, Math.ceil(snapshot.total / query.pageSize))}. Ordered by shared priority rules.</span>
            <div><button type="button" disabled={query.page <= 1 || busy} onClick={() => onChange({ page: query.page - 1 })}>Previous page</button>
                <button type="button" disabled={query.page * query.pageSize >= snapshot.total || busy} onClick={() => onChange({ page: query.page + 1 })}>Next page</button></div>
        </div>
    </section>
}
