import { useMemo, useState, type ReactNode } from 'react'
import type {
    SellerDashboardMilestone, SellerDashboardOpportunity, SellerDashboardSnapshot
} from '../../packages/common/contracts/seller-dashboard.js'
import {
    sellerAccountGaps, sellerCommitment, sellerDate, sellerDaysSince, sellerIsActive,
    sellerMetricScenario, sellerMoney, sellerPercent,
    sellerPipelineSummary, sellerRatio, sellerStage, type SellerDashboardView
} from './seller-dashboard-analysis.js'
import { SellerDashboardTable, type SellerDashboardColumn } from './seller-dashboard-table.js'

export type SellerDashboardSection = 'pipeline' | 'earnings' | 'consumption' | 'conversion'
export const sellerDashboardSections: readonly { id: SellerDashboardSection; label: string }[] = [
    { id: 'pipeline', label: 'Pipeline & Hygiene' },
    { id: 'earnings', label: 'ACR & Insights' },
    { id: 'consumption', label: 'Consumption & Growth' },
    { id: 'conversion', label: 'U2C Progress' }
]

export function SellerDashboardCard({ label, value, detail, tone }: {
    label: string; value: ReactNode; detail: string; tone?: 'warning' | 'success'
}) {
    return <article className={`sd-card${tone ? ` sd-card--${tone}` : ''}`}>
        <span className="sd-card-label">{label}</span>
        <strong className="sd-card-value">{value}</strong>
        <p>{detail}</p>
    </article>
}

export function SellerDashboardNotice({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
    return <div className={`sd-notice${warning ? ' sd-notice--warning' : ''}`} role="note">{children}</div>
}

export function SellerDashboardSourceMissing({ title, children }: { title: string; children: ReactNode }) {
    return <section className="sd-source-missing">
        <span className="sd-chip sd-chip--warning">Source unavailable</span>
        <h2>{title}</h2><p>{children}</p>
        <p>Unknown is not zero. No figures are inferred from current opportunities or another seller’s report.</p>
    </section>
}

export function SellerDashboardOverview({ snapshot }: { snapshot: SellerDashboardSnapshot }) {
    const { report } = snapshot
    return <section className="sd-overview" aria-label="Official MSX Earnings">
        <div className="sd-overview-heading">
            <div><p className="sd-eyebrow">PORTFOLIO · SOURCE-REPORTED RESULTS</p><h2>Official MSX Earnings</h2></div>
            <span className={`sd-chip${snapshot.state === 'stale' ? ' sd-chip--warning' : ''}`}>
                {snapshot.mode === 'sample' ? 'Synthetic sample' : snapshot.state === 'stale' ? 'Stale snapshot' : 'Protected snapshot'}
            </span>
        </div>
        <div className="sd-headline-grid">
            <div className="sd-headline">
                <span>Official weighted attainment</span>
                <strong data-testid="seller-official-attainment">{sellerPercent(report.official.weightedAttainment)}</strong>
                <p>{report.period.label} · {sellerDate(report.period.start)}–{sellerDate(report.period.end)}</p>
            </div>
            <div className="sd-comparison">
                <span>Closed-month adjusted comparison</span>
                <strong>{sellerPercent(report.official.closedMonthAttainment)}</strong>
                <p>Closed through {report.official.closedThrough ?? 'an unknown month'}.</p>
                <small>Calculated comparison, not official payout or a quarter-end forecast.</small>
            </div>
            <div className="sd-headline-note">
                <strong>One honest view of performance</strong>
                <p>Posted earnings stay fixed while you inspect the working view. Deal value and monthly run-rate are not earnings credit.</p>
                <span className="sd-chip">Read-only · private review</span>
            </div>
        </div>
        <div className="sd-bucket-grid">{report.official.buckets.map((bucket) => <article className="sd-bucket" key={bucket.name}>
            <div><h3>{bucket.name}</h3><span>{sellerPercent(bucket.weight * 100)} weight</span></div>
            <strong>{sellerPercent(bucket.attainment)}</strong>
            <div className="sd-progress" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, bucket.attainment))}%` }} /></div>
            <dl><div><dt>Posted gap</dt><dd>{sellerMoney(bucket.gap, true)}</dd></div>
                <div><dt>Recurring baseline</dt><dd>{sellerMoney(bucket.recurring, true)}</dd></div></dl>
        </article>)}</div>
        <p className="sd-footnote">Buckets can overlap: dollar gaps are kept separate. Posted gap includes ordinary earnings still to post; it is not entirely net-new pipeline required.</p>
    </section>
}

function inventoryMoney(value: number | null | undefined, currency: string): string {
    if (value === null || value === undefined) return 'Unknown'
    return /^[A-Z]{3}$/.test(currency) ? sellerMoney(value, false, currency)
        : `${value.toLocaleString('en-US')} · currency unverified`
}

function recordDetails(name: string, number: string, comments: string, extra?: ReactNode) {
    return <details className="sd-record-details"><summary><strong>{name}</strong><small>{number || 'Record ID unavailable'}</small></summary>
        <p>{comments || 'No source comments recorded.'}</p>{extra}</details>
}

const pipelineQueues = [
    { id: 'qualified', label: 'Qualified uncommitted' },
    { id: 'overdue', label: 'Past due' },
    { id: 'stale', label: 'Stale 45+ days' },
    { id: 'early', label: 'Stage 1 early pipeline' },
    { id: 'committed', label: 'Committed inventory' },
    { id: 'recent', label: 'Recently committed' },
    { id: 'blocked', label: 'Blocked milestones' },
    { id: 'all', label: 'All milestones' },
    { id: 'macc', label: 'MACC opportunities' },
    { id: 'sql', label: 'SQL billed opportunities' }
]

function PipelineSection({ snapshot, view }: { snapshot: SellerDashboardSnapshot; view: SellerDashboardView }) {
    const [queue, setQueue] = useState('qualified')
    const report = snapshot.report
    const summary = sellerPipelineSummary(view, report.period.today, view.range.end < report.period.end ? view.range.end : report.period.end)
    const parents = useMemo(() => new Map(report.opportunities.map((row) => [row.id, row])), [report])
    const rows = useMemo(() => view.milestones.filter((row) => {
        const active = sellerIsActive(row)
        const parent = parents.get(row.opportunityId)
        const stage = parent ? sellerStage(parent) : null
        const uncommitted = sellerCommitment(row.commitment) === 'uncommitted'
        if (queue === 'qualified') return active && uncommitted && stage !== null && stage >= 2
        if (queue === 'overdue') return active && uncommitted && row.date !== null && row.date < report.period.today
        if (queue === 'stale') return active && uncommitted && (sellerDaysSince(parent?.modifiedAt, report.period.today) ?? -1) >= 45
        if (queue === 'early') return active && stage === 1
        if (queue === 'committed') return active && sellerCommitment(row.commitment) === 'committed'
        if (queue === 'recent') {
            const days = sellerDaysSince(row.commitmentChangedAt, report.period.today)
            return active && sellerCommitment(row.commitment) === 'committed' && days !== null && days >= 0 && days <= 45
        }
        if (queue === 'blocked') return active && row.status === 'Blocked'
        return true
    }), [parents, queue, report.period.today, view.milestones])
    const milestoneColumns: SellerDashboardColumn<SellerDashboardMilestone>[] = [
        { key: 'account', label: 'Account', value: (row) => row.account },
        { key: 'opportunity', label: 'Opportunity', value: (row) => row.opportunityName },
        { key: 'name', label: 'Milestone / evidence', value: (row) => row.name,
            render: (row) => recordDetails(row.name, row.number || row.id, row.forecastComments,
                <><p>{row.mappingBasis}</p><p>{row.riskDetails || 'No blocker detail captured.'}</p><p>Region: {row.region || 'Not captured'}</p></>) },
        { key: 'stage', label: 'Stage', value: (row) => parents.get(row.opportunityId)?.stage ?? null },
        { key: 'status', label: 'Status', value: (row) => row.status,
            render: (row) => <span className={`sd-chip${row.status === 'Blocked' || row.status === 'At Risk' || row.active === null ? ' sd-chip--warning' : ''}`}>{row.status}</span> },
        { key: 'date', label: 'Due date', value: (row) => row.date, render: (row) => sellerDate(row.date) },
        { key: 'monthly', label: 'Est. monthly usage', value: (row) => row.monthly, render: (row) => inventoryMoney(row.monthly, row.currency), numeric: true },
        { key: 'commitment', label: 'Commitment', value: (row) => sellerCommitment(row.commitment), render: (row) => row.commitment || 'Unknown' },
        { key: 'workload', label: 'Workload', value: (row) => row.workload || null },
        { key: 'owner', label: 'Owner', value: (row) => row.owner || null },
        { key: 'updated', label: 'Days since update', value: (row) => sellerDaysSince(row.modifiedAt, report.period.today), numeric: true }
    ]
    const opportunityRows = useMemo(() => view.opportunities.filter((row) =>
        queue === 'macc' ? /\bmacc\b/i.test(`${row.intent} ${row.salesPlay}`)
            : /\bsql\b/i.test(`${row.intent} ${row.salesPlay}`)), [queue, view.opportunities])
    const opportunityColumns: SellerDashboardColumn<SellerDashboardOpportunity>[] = [
        { key: 'account', label: 'Account', value: (row) => row.account },
        { key: 'name', label: 'Opportunity / evidence', value: (row) => row.name,
            render: (row) => recordDetails(row.name, row.number || row.id, row.forecastComments) },
        { key: 'value', label: 'Nominal deal value', value: (row) => row.estimatedValue, render: (row) => inventoryMoney(row.estimatedValue, row.currency), numeric: true },
        { key: 'billed', label: 'Source billed estimate', value: (row) => row.estimatedBilledRevenue ?? null, render: (row) => inventoryMoney(row.estimatedBilledRevenue, row.currency), numeric: true },
        { key: 'sql', label: 'Source SQL estimate', value: (row) => row.estimatedSqlRevenue ?? null, render: (row) => inventoryMoney(row.estimatedSqlRevenue, row.currency), numeric: true },
        { key: 'date', label: 'Close date', value: (row) => row.closeDate, render: (row) => sellerDate(row.closeDate) },
        { key: 'stage', label: 'Stage', value: (row) => row.stage },
        { key: 'state', label: 'State', value: (row) => row.state },
        { key: 'owner', label: 'Owner', value: (row) => row.owner || null }
    ]
    const noPipeline = view.accounts.filter((row) => row.pipeline.status === 'complete' &&
        report.sources.pipeline.status !== 'unavailable' &&
        !report.opportunities.some((opportunity) => opportunity.tpid === row.tpid) &&
        !report.milestones.some((milestone) => milestone.tpid === row.tpid))
    const unknownUpdates = view.opportunities.filter((row) => !row.modifiedAt).length
    return <>
        <div className="sd-section-heading"><div><p className="sd-eyebrow">WORKING VIEW · ACCESSIBLE INVENTORY</p><h2>Pipeline coverage snapshot</h2></div>
            <span className="sd-chip">{view.accounts.length} accounts · {view.opportunities.length} opportunities</span></div>
        <div className="sd-card-grid">
            <SellerDashboardCard label="Qualified open pipeline" value={sellerMoney(summary.qualifiedNominal, true)}
                detail={`${summary.qualifiedCount} USD open opportunities at Stage 2+ · nominal value, not period credit`} />
            <SellerDashboardCard label="Stage 1 early pipeline" value={sellerMoney(summary.earlyNominal, true)}
                detail={`${summary.earlyCount} early-stage opportunities · qualify the next customer outcome`} />
            <SellerDashboardCard label="Committed production" value={`${sellerMoney(summary.committedMonthly, true)}/mo`}
                detail="Remaining-period USD production candidates · blocked milestones excluded" tone="success" />
            <SellerDashboardCard label="Uncommitted production" value={`${sellerMoney(summary.uncommittedMonthly, true)}/mo`}
                detail="Remaining-period USD monthly inventory · credit and commitment need validation" />
        </div>
        <div className="sd-insight-grid">
            <section className="sd-panel"><h3>Pipeline & territory insights</h3><ul className="sd-insights">
                <li><strong>{summary.overdueCount} overdue milestones</strong><span>Reconfirm dates and owners; past-due milestones are not remaining-period candidates.</span></li>
                <li><strong>{sellerMoney(summary.blockedMonthly, true)}/mo blocked exposure</strong><span>Inspect the source blocker notes and capacity/region dependencies.</span></li>
                <li><strong>{sellerPercent(summary.concentration)} top-account concentration</strong><span>Share of qualified nominal pipeline; a diversification signal, not risk-adjusted earnings.</span></li>
            </ul></section>
            <section className="sd-panel"><h3>Evidence gaps & next moves</h3><ul className="sd-insights">
                <li><strong>{noPipeline.length} accounts with no recorded pipeline</strong><span>{noPipeline.map((row) => row.name).join(', ') || 'No absence asserted outside complete retrieval.'}</span></li>
                <li><strong>{summary.candidateCount} production candidates</strong><span>Workload mappings and incremental period credit remain unverified.</span></li>
                <li><strong>Unknown commitment: {sellerMoney(summary.unknownCommitmentMonthly, true)}/mo</strong><span>Unknown is neither committed nor uncommitted. Won parents can support active milestones, but their deal value is excluded from open pipeline.</span></li>
            </ul></section>
        </div>
        {report.sources.pipeline.status !== 'complete' && <SellerDashboardNotice warning>
            Pipeline retrieval is {report.sources.pipeline.status}. Inventory totals describe returned records only; incomplete access cannot establish zero pipeline or complete coverage.
        </SellerDashboardNotice>}
        <section className="sd-panel">
            <div className="sd-section-heading"><div><h3>Pipeline & hygiene queues</h3><p>Inspect owners, workloads, dates, statuses and source record details without writing to CRM.</p></div>
                <label className="sd-inline-label">Inventory view<select aria-label="Pipeline inventory view" value={queue} onChange={(event) => setQueue(event.target.value)}>
                    {pipelineQueues.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select></label></div>
            {(queue === 'stale' || queue === 'recent') && <SellerDashboardNotice>
                These queues require source update/commitment-change timestamps. {unknownUpdates} returned opportunities have no update timestamp; missing history is not zero days or proof of recent activity.
            </SellerDashboardNotice>}
            {queue === 'sql' || queue === 'macc'
                ? <SellerDashboardTable caption={queue === 'sql' ? 'SQL billed opportunities' : 'MACC opportunities'} rows={opportunityRows} columns={opportunityColumns} rowKey={(row) => row.id} />
                : <SellerDashboardTable caption={pipelineQueues.find((row) => row.id === queue)?.label ?? 'Milestone inventory'} rows={rows} columns={milestoneColumns} rowKey={(row) => row.id} />}
            <p className="sd-footnote">Monthly usage and nominal value are separate units. “Qualified” here means a recorded Stage 2+ opportunity, not verified compensation credit. Ownership filters can use the search field; the collector does not supply a signed-in-user ownership flag.</p>
        </section>
    </>
}

function EarningsSection({ snapshot, view, scenario, onScenarioChange }: {
    snapshot: SellerDashboardSnapshot; view: SellerDashboardView; scenario: boolean; onScenarioChange(value: boolean): void
}) {
    const gaps = sellerAccountGaps(view)
    const accountIds = new Set(view.accounts.map((row) => row.tpid))
    const metricNames = new Set(view.metrics.map((row) => row.name))
    const accountRows = useMemo(() => view.accounts.flatMap((account) => account.metrics
        .filter((metric) => view.metrics.some((row) => row.name === metric.metric))
        .map((metric) => ({ ...metric, tpid: account.tpid, account: account.name, status: account.pipeline.status, action: account.nextAction }))), [view.accounts, view.metrics])
    type Metric = SellerDashboardView['metrics'][number]
    const metricColumns: SellerDashboardColumn<Metric>[] = [
        { key: 'name', label: 'Metric', value: (row) => row.name },
        { key: 'bucket', label: 'Bucket', value: (row) => row.bucket },
        { key: 'attainment', label: 'Reported attainment', value: (row) => row.attainment, render: (row) => sellerPercent(row.attainment), numeric: true },
        { key: 'actual', label: 'Credited actual', value: (row) => row.actual, render: (row) => sellerMoney(row.actual), numeric: true },
        { key: 'quota', label: 'Gross quota', value: (row) => row.quota, render: (row) => sellerMoney(row.quota), numeric: true },
        { key: 'recurring', label: 'Recurring baseline', value: (row) => row.recurring, render: (row) => sellerMoney(row.recurring), numeric: true },
        { key: 'calcActual', label: 'Calculated actual', value: (row) => row.calcActual, render: (row) => sellerMoney(row.calcActual), numeric: true },
        { key: 'calcQuota', label: 'Calculated quota', value: (row) => row.calcQuota, render: (row) => sellerMoney(row.calcQuota), numeric: true },
        { key: 'gap', label: 'Posted gap', value: (row) => row.gap, render: (row) => sellerMoney(row.gap), numeric: true }
    ]
    type AccountRow = typeof accountRows[number]
    const accountColumns: SellerDashboardColumn<AccountRow>[] = [
        { key: 'account', label: 'Account', value: (row) => row.account },
        { key: 'metric', label: 'Metric / bucket', value: (row) => row.metric, render: (row) => <span>{row.metric}<small className="sd-subtext">{row.bucket}</small></span> },
        { key: 'quota', label: 'Account quota', value: (row) => row.quota, render: (row) => sellerMoney(row.quota), numeric: true },
        { key: 'actual', label: 'Credited actual', value: (row) => row.actual, render: (row) => sellerMoney(row.actual), numeric: true },
        { key: 'gap', label: 'Account gap', value: (row) => row.gap, render: (row) => sellerMoney(row.gap), numeric: true },
        { key: 'quality', label: 'Pipeline quality', value: (row) => row.status },
        { key: 'action', label: 'Next move', value: (row) => row.action }
    ]
    const actions = snapshot.report.actions.filter((row) => accountIds.has(row.tpid) && metricNames.has(row.metric))
    const scenarioRows = view.metrics.map((metric) => ({ metric, ...sellerMetricScenario(snapshot.report, view, metric) }))
    return <>
        <div className="sd-section-heading"><div><p className="sd-eyebrow">ACCOUNT DOLLARS · BUCKETS KEPT SEPARATE</p><h2>Remaining account gaps</h2></div></div>
        <div className="sd-bucket-grid">{gaps.map((gap) => <SellerDashboardCard key={gap.bucket} label={gap.bucket}
            value={sellerMoney(gap.gap, true)} detail={`${sellerMoney(gap.actual, true)} credited / ${sellerMoney(gap.quota, true)} selected account quota · net before clamping`}
            {...(gap.gap === null || gap.gap > 0 ? { tone: 'warning' as const } : { tone: 'success' as const })} />)}</div>
        <SellerDashboardNotice>Account weighted attainment is not inferred. A missing actual keeps the selected bucket gap unknown; account surpluses offset shortfalls before the gap is clamped. Quarter/state filters select inventory/accounts, not a prorated quota.</SellerDashboardNotice>
        <section className="sd-panel"><h3>Official metric reconciliation</h3><p>Portfolio reference: account, date, state and search filters never recalculate these source figures.</p>
            <SellerDashboardTable caption="Official metric reconciliation" rows={view.metrics} columns={metricColumns} rowKey={(row) => row.name} />
        </section>
        <section className="sd-panel"><h3>Account gaps & recovery priorities</h3>
            <SellerDashboardTable caption="Account gaps" rows={accountRows} columns={accountColumns} rowKey={(row) => `${row.tpid}:${row.metric}`} />
        </section>
        <section className="sd-panel">
            <div className="sd-section-heading"><div><h3>Illustrative production-ramp scenario</h3><p>Off by default. This calculation is separate from official earnings and source-reported attainment.</p></div>
                <label className="sd-check"><input type="checkbox" checked={scenario} onChange={(event) => onScenarioChange(event.target.checked)} />Enable illustrative scenario</label></div>
            {scenario ? <>
                <SellerDashboardNotice warning>Assumes every eligible selected USD production run-rate is entirely new, incremental, correctly mapped, and starts flat on its production date; any blockers are resolved by that date. Calendar days are prorated through the official period end. This is not a forecast, guaranteed credit, or payout. Unknown mapping, commitment or source completeness remains unknown.</SellerDashboardNotice>
                <SellerDashboardTable caption="Illustrative scenario — not a forecast" rows={scenarioRows} rowKey={(row) => row.metric.name} columns={[
                    { key: 'metric', label: 'Metric', value: (row) => row.metric.name },
                    { key: 'gap', label: 'Portfolio posted gap', value: (row) => row.metric.gap, render: (row) => sellerMoney(row.metric.gap), numeric: true },
                    { key: 'committed', label: 'Assumed committed credit', value: (row) => row.committed, render: (row) => sellerMoney(row.committed), numeric: true },
                    { key: 'uncommitted', label: 'Assumed uncommitted credit', value: (row) => row.uncommitted, render: (row) => sellerMoney(row.uncommitted), numeric: true },
                    { key: 'remaining', label: 'Illustrative balance', value: (row) => row.remaining, render: (row) => sellerMoney(row.remaining), numeric: true },
                    { key: 'state', label: 'Assumption status', value: (row) => row.state }
                ]} />
                <p className="sd-footnote">The balance compares the fixed portfolio metric gap with only the selected candidate scenario. It is not an account-level compensation result.</p>
            </> : <p className="sd-footnote">No opportunity value or monthly usage is currently subtracted from a posted earnings gap.</p>}
        </section>
        <section className="sd-panel"><h3>Prioritized next actions</h3><div className="sd-action-grid">{actions.map((action, index) => <article className="sd-action" key={`${action.tpid}:${action.metric}:${index}`}>
            <span className={`sd-chip${action.priority === 'High' ? ' sd-chip--warning' : ''}`}>{action.priority} priority</span>
            <h4>{action.account}</h4><strong>{action.issue}</strong><p>{action.action}</p><small>{action.owner} · {action.metric}</small>
        </article>)}</div>{actions.length === 0 && <p>No source actions match this working view.</p>}</section>
    </>
}

function ConsumptionSection({ snapshot, view }: { snapshot: SellerDashboardSnapshot; view: SellerDashboardView }) {
    const consumption = snapshot.supplement?.consumption
    if (!consumption || consumption.source.status === 'unavailable') return <SellerDashboardSourceMissing title="Consumption & growth need a Fabric source">
        The supplied MINT/Dataverse collector does not include SL4 consumption, service movers, subscriptions, strategic-pillar growth or Arc/SQL reclassification. A validated consumption supplement is required.
    </SellerDashboardSourceMissing>
    if (consumption.source.end < view.range.start || consumption.source.start > view.range.end) return <SellerDashboardSourceMissing title="No consumption snapshot for this fiscal quarter">
        The available source covers {sellerDate(consumption.source.start)}–{sellerDate(consumption.source.end)}. It is not extended or prorated into a different quarter.
    </SellerDashboardSourceMissing>
    const accounts = new Set(view.accounts.map((row) => row.tpid))
    const accountNames = new Map(snapshot.report.accounts.map((row) => [row.tpid, row.name]))
    const rows = consumption.accounts.filter((row) => accounts.has(row.tpid))
    if (rows.length === 0 && accounts.size > 0) return <SellerDashboardSourceMissing title="Selected accounts have no returned consumption evidence">
        The available source does not establish consumption for this selected account scope.
    </SellerDashboardSourceMissing>
    const services = consumption.services.filter((row) => accounts.has(row.tpid))
    const movers = services.filter((row) => !row.isNew).sort((a, b) => Math.abs(b.currentDaily - b.previousDaily) - Math.abs(a.currentDaily - a.previousDaily))
    const actual = rows.reduce((sum, row) => sum + row.actual, 0)
    const averageDaily = rows.reduce((sum, row) => sum + row.averageDaily, 0)
    const projected = rows.some((row) => row.projected === null) ? null : rows.reduce((sum, row) => sum + (row.projected ?? 0), 0)
    const pillars = new Map<string, number>()
    for (const row of rows) for (const pillar of row.pillars) pillars.set(pillar.name, (pillars.get(pillar.name) ?? 0) + pillar.actual)
    return <>
        <div className="sd-section-heading"><div><p className="sd-eyebrow">FABRIC SOURCE · NOT COMPENSATION ATTAINMENT</p><h2>Customer consumption & growth</h2><p>{sellerDate(consumption.source.start)}–{sellerDate(consumption.source.end)} · source as of {sellerDate(consumption.source.asOf)}</p></div>
            <span className="sd-chip">{consumption.source.status}</span></div>
        <div className="sd-card-grid">
            <SellerDashboardCard label="Posted consumption" value={sellerMoney(actual, true)} detail="Actual source-period ACR · never substituted for MINT attainment" />
            <SellerDashboardCard label="Average daily ACR" value={`${sellerMoney(averageDaily, true)}/day`} detail="Source-supplied daily rate for the posted period" />
            <SellerDashboardCard label="Illustrative period landing" value={sellerMoney(projected, true)} detail="Source projection only · no guaranteed earnings or compensation credit" />
            <SellerDashboardCard label="New services" value={services.filter((row) => row.isNew).length} detail="New-service records in the selected source/account scope" tone="success" />
        </div>
        <SellerDashboardNotice warning>{consumption.source.detail} The source period stays fixed; account selection applies, while earnings metrics are not used to invent service-to-credit mappings. Partial periods are not compared as if they were complete months.</SellerDashboardNotice>
        <section className="sd-panel"><h3>Strategic-pillar allocation</h3><div className="sd-pillar-grid">{Array.from(pillars).map(([name, value]) => <div key={name}><span>{name}</span><strong>{sellerMoney(value, true)}</strong>
            <div className="sd-progress" aria-hidden="true"><span style={{ width: `${sellerRatio(value, actual) ?? 0}%` }} /></div>
            <small>{sellerPercent(sellerRatio(value, actual))} of posted consumption</small></div>)}</div></section>
        <section className="sd-panel"><h3>Average daily ACR & projected landing</h3>
            <SellerDashboardTable caption="Account consumption" rows={rows} rowKey={(row) => row.tpid} columns={[
                { key: 'account', label: 'Account', value: (row) => accountNames.get(row.tpid) ?? row.tpid },
                { key: 'actual', label: 'Posted ACR', value: (row) => row.actual, render: (row) => sellerMoney(row.actual), numeric: true },
                { key: 'days', label: 'Days posted', value: (row) => row.daysPosted, numeric: true },
                { key: 'daily', label: 'Avg. daily ACR', value: (row) => row.averageDaily, render: (row) => sellerMoney(row.averageDaily), numeric: true },
                { key: 'previous', label: 'Source previous-period ACR', value: (row) => row.previousActual, render: (row) => sellerMoney(row.previousActual), numeric: true },
                { key: 'projected', label: 'Illustrative landing', value: (row) => row.projected, render: (row) => sellerMoney(row.projected), numeric: true }
            ]} />
        </section>
        <section className="sd-panel"><h3>Top service movers</h3>
            <SellerDashboardTable caption="Service movers" rows={movers} rowKey={(row) => row.id} columns={[
                { key: 'account', label: 'Account', value: (row) => accountNames.get(row.tpid) ?? row.tpid },
                { key: 'name', label: 'Service', value: (row) => row.name },
                { key: 'pillar', label: 'Strategic pillar', value: (row) => row.pillar },
                { key: 'prior', label: 'Prior avg. daily', value: (row) => row.previousDaily, render: (row) => sellerMoney(row.previousDaily), numeric: true },
                { key: 'current', label: 'Current avg. daily', value: (row) => row.currentDaily, render: (row) => sellerMoney(row.currentDaily), numeric: true },
                { key: 'delta', label: 'Daily change', value: (row) => row.currentDaily - row.previousDaily,
                    render: (row) => <span className={row.currentDaily >= row.previousDaily ? 'sd-positive' : 'sd-negative'}>{sellerMoney(row.currentDaily - row.previousDaily)}</span>, numeric: true },
                { key: 'growth', label: 'Daily growth', value: (row) => sellerRatio(row.currentDaily - row.previousDaily, row.previousDaily),
                    render: (row) => sellerPercent(sellerRatio(row.currentDaily - row.previousDaily, row.previousDaily)), numeric: true }
            ]} />
        </section>
        <div className="sd-insight-grid">
            <section className="sd-panel"><h3>New services</h3><ul className="sd-insights">{services.filter((row) => row.isNew).map((row) => <li key={row.id}>
                <strong>{row.name} · {accountNames.get(row.tpid)}</strong><span>{row.pillar} · {sellerMoney(row.currentDaily)}/day</span>
            </li>)}</ul></section>
            <section className="sd-panel"><h3>New subscriptions</h3><ul className="sd-insights">{consumption.subscriptions.filter((row) => accounts.has(row.tpid)).map((row) => <li key={row.id}>
                <strong>{row.name}</strong><span>{accountNames.get(row.tpid)} · created {sellerDate(row.created)} · {sellerMoney(row.averageDaily)}/day</span>
            </li>)}</ul></section>
        </div>
        <section className="sd-panel"><h3>Azure Arc & SQL reclassification</h3>
            <SellerDashboardTable caption="SQL reclassification review" rows={consumption.sqlReclassification.filter((row) => accounts.has(row.tpid))} rowKey={(row) => row.id} columns={[
                { key: 'account', label: 'Account', value: (row) => accountNames.get(row.tpid) ?? row.tpid },
                { key: 'workload', label: 'Workload', value: (row) => row.workload },
                { key: 'monthly', label: 'Monthly opportunity', value: (row) => row.monthlyOpportunity, render: (row) => `${sellerMoney(row.monthlyOpportunity)}/mo`, numeric: true },
                { key: 'evidence', label: 'Source evidence / required review', value: (row) => row.evidence }
            ]} />
        </section>
    </>
}

function ConversionSection({ snapshot, view }: { snapshot: SellerDashboardSnapshot; view: SellerDashboardView }) {
    const conversion = snapshot.supplement?.conversion
    if (!conversion || conversion.source.status === 'unavailable') return <SellerDashboardSourceMissing title="U2C progress requires historical commitment evidence">
        The supplied collector returns current commitment state, not a starting uncommitted cohort or dated conversion events. Current committed dollars cannot establish uncommitted-to-committed progress.
    </SellerDashboardSourceMissing>
    if (conversion.source.end < view.range.start || conversion.source.start > view.range.end) return <SellerDashboardSourceMissing title="No U2C baseline for this fiscal quarter">
        The available history covers {sellerDate(conversion.source.start)}–{sellerDate(conversion.source.end)}. A matching dated cohort is required.
    </SellerDashboardSourceMissing>
    const accounts = new Set(view.accounts.map((row) => row.tpid))
    const names = new Map(snapshot.report.accounts.map((row) => [row.tpid, row.name]))
    const rows = conversion.accounts.filter((row) => accounts.has(row.tpid))
    if (rows.length === 0 && accounts.size > 0) return <SellerDashboardSourceMissing title="Selected accounts have no returned U2C baseline">
        The available history does not establish a starting cohort for this selected account scope.
    </SellerDashboardSourceMissing>
    const starting = rows.reduce((sum, row) => sum + row.startingMonthly, 0)
    const converted = rows.reduce((sum, row) => sum + row.convertedMonthly, 0)
    const inQuarter = rows.reduce((sum, row) => sum + row.inQuarterMonthly, 0)
    const shifted = rows.reduce((sum, row) => sum + row.shiftedOutMonthly, 0)
    const startingCount = rows.reduce((sum, row) => sum + row.startingCount, 0)
    const convertedCount = rows.reduce((sum, row) => sum + row.convertedCount, 0)
    return <>
        <div className="sd-section-heading"><div><p className="sd-eyebrow">HISTORICAL COHORT · COMMITMENT CONVERSION</p><h2>Uncommitted to committed progress</h2><p>{sellerDate(conversion.source.start)}–{sellerDate(conversion.source.end)} · source as of {sellerDate(conversion.source.asOf)}</p></div>
            <span className="sd-chip">{conversion.source.status}</span></div>
        <div className="sd-card-grid">
            <SellerDashboardCard label="Starting uncommitted cohort" value={`${sellerMoney(starting, true)}/mo`} detail={`${startingCount} starting milestones · historical baseline`} />
            <SellerDashboardCard label="Converted to committed" value={sellerPercent(sellerRatio(converted, starting))}
                detail={`${sellerMoney(converted, true)}/mo converted · source-reported cohort`} tone="success" />
            <SellerDashboardCard label="Milestone conversion" value={sellerPercent(sellerRatio(convertedCount, startingCount))}
                detail={`${convertedCount} of ${startingCount} starting milestones converted`} />
            <SellerDashboardCard label="Shifted out of quarter" value={`${sellerMoney(shifted, true)}/mo`}
                detail={`${sellerMoney(inQuarter, true)}/mo conversion retained in quarter`} tone="warning" />
        </div>
        <SellerDashboardNotice>{conversion.source.detail} Conversion amounts are monthly inventory, not reporting-period earnings. Zero baseline denominators remain unknown; partial history is not a complete conversion result.</SellerDashboardNotice>
        <section className="sd-panel"><h3>Account conversion pace</h3><div className="sd-conversion-bars">{rows.map((row) => <div key={row.tpid}>
            <span>{names.get(row.tpid)}</span><div className="sd-progress" aria-hidden="true"><span style={{ width: `${sellerRatio(row.convertedMonthly, row.startingMonthly) ?? 0}%` }} /></div>
            <strong>{sellerPercent(sellerRatio(row.convertedMonthly, row.startingMonthly))}</strong>
        </div>)}</div></section>
        <section className="sd-panel"><h3>Azure uncommitted-to-committed detail</h3>
            <SellerDashboardTable caption="U2C historical cohort" rows={rows} rowKey={(row) => row.tpid} columns={[
                { key: 'account', label: 'Account', value: (row) => names.get(row.tpid) ?? row.tpid },
                { key: 'territory', label: 'Territory', value: (row) => row.territory },
                { key: 'starting', label: 'Starting uncommitted /mo', value: (row) => row.startingMonthly, render: (row) => sellerMoney(row.startingMonthly), numeric: true },
                { key: 'converted', label: 'Converted /mo', value: (row) => row.convertedMonthly, render: (row) => sellerMoney(row.convertedMonthly), numeric: true },
                { key: 'quarter', label: 'Retained in quarter /mo', value: (row) => row.inQuarterMonthly, render: (row) => sellerMoney(row.inQuarterMonthly), numeric: true },
                { key: 'shifted', label: 'Shifted out /mo', value: (row) => row.shiftedOutMonthly, render: (row) => sellerMoney(row.shiftedOutMonthly), numeric: true },
                { key: 'percent', label: 'Dollar conversion', value: (row) => sellerRatio(row.convertedMonthly, row.startingMonthly),
                    render: (row) => sellerPercent(sellerRatio(row.convertedMonthly, row.startingMonthly)), numeric: true },
                { key: 'count', label: 'Converted / starting milestones', value: (row) => row.convertedCount, render: (row) => `${row.convertedCount} / ${row.startingCount}`, numeric: true },
                { key: 'countPercent', label: 'Milestone conversion', value: (row) => sellerRatio(row.convertedCount, row.startingCount),
                    render: (row) => sellerPercent(sellerRatio(row.convertedCount, row.startingCount)), numeric: true }
            ]} />
        </section>
    </>
}

export function SellerDashboardSectionContent({ section, snapshot, view, scenario, onScenarioChange }: {
    section: SellerDashboardSection; snapshot: SellerDashboardSnapshot; view: SellerDashboardView;
    scenario: boolean; onScenarioChange(value: boolean): void
}) {
    if (section === 'pipeline') return <PipelineSection snapshot={snapshot} view={view} />
    if (section === 'earnings') return <EarningsSection snapshot={snapshot} view={view} scenario={scenario} onScenarioChange={onScenarioChange} />
    if (section === 'consumption') return <ConsumptionSection snapshot={snapshot} view={view} />
    return <ConversionSection snapshot={snapshot} view={view} />
}
