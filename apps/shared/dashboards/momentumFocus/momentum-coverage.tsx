import type { MomentumSnapshot } from '../../../../packages/common/contracts/momentum-focus.js'

export function MomentumCoverage({ snapshot }: { snapshot: MomentumSnapshot }) {
    return <div className="momentum-coverage">
        <section className="momentum-card" aria-labelledby="momentum-financial-title">
            <h2 id="momentum-financial-title">Separate financial groups</h2>
            <p className="sprv-muted">Native source currency is preserved. Pipeline value and a monthly rate are different measures, never combined or converted implicitly.</p>
            <div className="sprv-table-wrap momentum-table-scroll"><table className="sprv-table momentum-info-table" aria-label="Financial groups table">
                <thead><tr><th scope="col">Value basis</th><th scope="col">Currency</th><th scope="col" className="sprv-numeric">Amount</th><th scope="col">Unit</th><th scope="col" className="sprv-numeric">Records</th></tr></thead>
                <tbody>{snapshot.charts.values.map((group) => <tr key={`${group.basis}:${group.currency}`}>
                    <th scope="row">{group.basis === 'pipeline' ? 'Pipeline value' : 'Milestone monthly rate'}</th><td>{group.currency}</td>
                    <td className="sprv-numeric">{group.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                    <td>{group.basis === 'pipeline' ? 'Opportunity value' : 'Per month'}</td><td className="sprv-numeric">{group.records}</td>
                </tr>)}</tbody>
            </table></div>
            <p className="sprv-footnote">Filtered records excluded from monetary sums because their amount or currency is unknown: {snapshot.charts.unknownValues}. Currency/value filters also exclude unattributed records.</p>
        </section>
        <section className="momentum-card" aria-labelledby="momentum-sources-title">
            <h2 id="momentum-sources-title">Source and history coverage</h2>
            <p className="sprv-muted">Observation capture is not continuous monitoring. Unknown history is not zero progress. M365 remains unconnected.</p>
            <div className="sprv-table-wrap momentum-table-scroll"><table className="sprv-table momentum-info-table" aria-label="Source coverage table">
                <thead><tr><th scope="col">Source</th><th scope="col">State</th><th scope="col">Records</th><th scope="col">Checked at</th><th scope="col">Coverage / limitations</th></tr></thead>
                <tbody>{snapshot.sources.map((source) => <tr key={source.source}>
                    <th scope="row">{source.source}</th><td><span className={`sprv-badge sprv-badge--${source.state === 'complete' ? 'good' : source.state === 'denied' ? 'bad' : source.state === 'partial' || source.state === 'capped' ? 'warn' : 'muted'}`}>{source.state}</span></td>
                    <td>{source.count ?? 'Unknown'}</td><td className="momentum-date">{source.checkedAt}</td><td>{source.detail}</td>
                </tr>)}</tbody>
            </table></div>
            <details className="momentum-methodology"><summary>Methodology and financial safeguards</summary>
                <p>Pipeline value is not recognized revenue. Milestone potential is a monthly rate. Unlike currencies and units are never added.</p>
                <p>Chart totals use the complete filtered read model, not the visible table page. Unknown is never silently replaced with zero.</p>
                <p>Focus: {snapshot.focusWindow.from} to {snapshot.focusWindow.to} ({snapshot.query.timezone}). Evidence: {snapshot.evidenceWindow.from} to {snapshot.evidenceWindow.to}. {snapshot.ruleVersion}.</p>
            </details>
        </section>
    </div>
}
