import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
    sellerDashboardContractVersion, sellerDashboardRequestSchema, sellerDashboardResponseSchema,
    type SellerDashboardRequest, type SellerDashboardResponse, type SellerDashboardSnapshot
} from '../../packages/common/contracts/seller-dashboard.js'
import {
    defaultSellerDashboardFilters, emptySellerDashboardFilters, filterSellerDashboard,
    sellerDate, sellerFiscalQuarters, type SellerDashboardFilters
} from './seller-dashboard-analysis.js'
import {
    SellerDashboardNotice, SellerDashboardOverview, SellerDashboardSectionContent,
    sellerDashboardSections, type SellerDashboardSection
} from './seller-dashboard-sections.js'

export type InvokeSellerDashboard = (request: SellerDashboardRequest) => Promise<SellerDashboardResponse>

function localReportingDate(): string {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function RefreshConfirmation({ onClose, onConfirm }: { onClose(): void; onConfirm(asOf: string): void }) {
    const dialog = useRef<HTMLDialogElement>(null)
    const [asOf, setAsOf] = useState(localReportingDate)
    useEffect(() => {
        if (dialog.current && !dialog.current.open) dialog.current.showModal()
    }, [])
    return <dialog ref={dialog} className="sd-dialog" aria-labelledby="sd-refresh-title" onCancel={(event) => {
        event.preventDefault()
        onClose()
    }}>
        <form onSubmit={(event) => { event.preventDefault(); onConfirm(asOf) }}>
            <h2 id="sd-refresh-title">Refresh live seller sources</h2>
            <p>This calls the explicitly configured trusted collector under your own identity. Corporate sign-in may open in Edge. The collector validates your own quota export and retains the last successful encrypted snapshot if reconciliation fails.</p>
            <p>No CRM records are changed. Nothing is emailed, uploaded or shared.</p>
            <label>Reporting as-of date<input aria-label="Refresh reporting date" type="date" required value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label>
            <label className="sd-check"><input type="checkbox" required />This profile contains my own official export, and I authorize this read-only refresh.</label>
            <div className="sd-dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="sd-primary" type="submit">Confirm source refresh</button></div>
        </form>
    </dialog>
}

function SourcesAndMethod({ snapshot }: { snapshot: SellerDashboardSnapshot }) {
    const { report, supplement } = snapshot
    return <details className="sd-methodology">
        <summary>Sources, freshness & methodology</summary>
        <div className="sd-source-grid">
            <article><h3>Official MSX Earnings</h3><p>{snapshot.mode === 'sample' ? 'Synthetic fixture' : report.sources.earnings.status}</p>
                <p>Refreshed {sellerDate(report.sources.earnings.refreshedAt)} · {report.sources.earnings.ageDays ?? 'unknown'} days old at capture</p></article>
            <article><h3>Quota by Accounts</h3><p>{report.sources.quota.name}</p><p>{report.sources.quota.rows} validated rows · {report.sources.quota.accounts} accounts</p></article>
            <article><h3>Accessible MSX pipeline</h3><p>{report.sources.pipeline.status} · as of {sellerDate(report.sources.pipeline.asOf)}</p>
                <p>Quota-TPID scope, not a substitute deal-team-only roster.</p></article>
            <article><h3>Supplemental evidence</h3><p>Consumption: {supplement?.consumption?.source.status ?? 'unavailable'}</p>
                <p>U2C history: {supplement?.conversion?.source.status ?? 'unavailable'}</p></article>
        </div>
        <h3>Source warnings</h3><ul>{[...report.warnings, ...report.sources.pipeline.errors].map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        <h3>Accounting and privacy</h3><ul>{report.methodology.map((rule, index) => <li key={index}>{rule}</li>)}</ul>
        <p>No prompt, financial data, customer identifier or token is sent to telemetry by this pane. No dashboard exports or browser persistence are provided.</p>
    </details>
}

export function SellerDashboardPane({ invoke }: { invoke: InvokeSellerDashboard }) {
    const [snapshot, setSnapshot] = useState<SellerDashboardSnapshot | null>(null)
    const [unavailable, setUnavailable] = useState<Extract<SellerDashboardResponse, { kind: 'unavailable' }> | null>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [section, setSection] = useState<SellerDashboardSection>('pipeline')
    const [filters, setFilters] = useState<SellerDashboardFilters>(emptySellerDashboardFilters)
    const [scenario, setScenario] = useState(false)
    const [confirmRefresh, setConfirmRefresh] = useState(false)
    const generation = useRef(0)
    const loadedFiscalYear = useRef<number | null>(null)
    const load = useCallback(async (request: SellerDashboardRequest) => {
        const current = ++generation.current
        setBusy(true)
        setError('')
        try {
            const response = sellerDashboardResponseSchema.parse(await invoke(sellerDashboardRequestSchema.parse(request)))
            if (current !== generation.current) return
            if (response.kind === 'unavailable') {
                setUnavailable(response)
                setError(response.message)
                setSnapshot((previous) => previous && ['runtime-failed', 'invalid-snapshot'].includes(response.code)
                    ? { ...previous, state: 'stale', message: 'Reload failed. The last validated view is retained with unchanged source timestamps.' } : null)
                return
            }
            setUnavailable(null)
            setSnapshot(response)
            const resetFilters = loadedFiscalYear.current !== response.report.plan.fiscalYear
            setFilters((previous) => {
                if (resetFilters) return defaultSellerDashboardFilters(response.report)
                return {
                    ...previous,
                    account: response.report.accounts.some((row) => row.tpid === previous.account) ? previous.account : '',
                    bucket: response.report.official.buckets.some((row) => row.name === previous.bucket) ? previous.bucket : '',
                    metric: response.report.official.metrics.some((row) => row.name === previous.metric) ? previous.metric : ''
                }
            })
            loadedFiscalYear.current = response.report.plan.fiscalYear
        } catch (cause) {
            if (current !== generation.current) return
            const denied = cause instanceof Error && 'status' in cause && (cause.status === 401 || cause.status === 403)
            const message = cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'The dashboard response failed validation. No replacement data was accepted.'
            setError(message)
            setSnapshot((previous) => previous && !denied ? { ...previous, state: 'stale', message: 'Reload failed. This is the last validated view, not fresh source data.' } : null)
        } finally {
            if (current === generation.current) setBusy(false)
        }
    }, [invoke])
    useEffect(() => {
        setSnapshot(null)
        loadedFiscalYear.current = null
        void load({ contractVersion: sellerDashboardContractVersion, operation: 'get' })
        return () => { ++generation.current }
    }, [load])
    const view = useMemo(() => snapshot ? filterSellerDashboard(snapshot.report, filters) : null, [snapshot, filters])
    const update = (key: keyof SellerDashboardFilters, value: string) => setFilters((previous) => ({
        ...previous, [key]: value, ...(key === 'bucket' ? { metric: '' } : {})
    }))
    const changeSectionByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
        const last = sellerDashboardSections.length - 1
        const next = event.key === 'ArrowRight' ? (index + 1) % (last + 1)
            : event.key === 'ArrowLeft' ? (index + last) % (last + 1)
                : event.key === 'Home' ? 0 : event.key === 'End' ? last : null
        if (next === null) return
        event.preventDefault()
        const selected = sellerDashboardSections[next]
        if (!selected) return
        setSection(selected.id)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    }
    return <section className="seller-dashboard" aria-label="Seller Dashboard" aria-busy={busy}>
        <div className="sd-inner">
            <header className="sd-header">
                <div><p className="sd-eyebrow">MCAPS · WEEKLY BUSINESS REVIEW</p><h1>Seller Dashboard</h1>
                    <p>{snapshot ? `FY${snapshot.report.plan.fiscalYear % 100} · as of ${sellerDate(snapshot.report.period.today)}` : 'Official attainment, account gaps, pipeline and growth — without changing your existing workspace.'}</p></div>
                <div className="sd-header-actions">
                    <span className="sd-chip">{snapshot?.mode === 'sample' ? 'SYNTHETIC SAMPLE' : 'PRIVATE · READ-ONLY'}</span>
                    <button type="button" disabled={busy} onClick={() => void load({ contractVersion: sellerDashboardContractVersion, operation: 'get' })}>{busy ? 'Loading…' : 'Reload dashboard'}</button>
                    {snapshot?.mode === 'live' && <button type="button" className="sd-primary" disabled={busy} onClick={() => setConfirmRefresh(true)}>Refresh live sources</button>}
                </div>
            </header>
            {busy && <p className="sd-loading" role="status">{snapshot ? 'Updating the view; the previous snapshot remains visible.' : 'Loading the validated seller dashboard…'}</p>}
            {error && <div className="sd-error" role="alert">{error}</div>}
            {snapshot?.state === 'stale' && <div className="sd-stale" role="status"><strong>Stale / retained snapshot.</strong> {snapshot.message}</div>}
            {!snapshot && !busy && <section className="sd-source-missing">
                <span className="sd-chip sd-chip--warning">{unavailable?.code ?? 'Load failed'}</span>
                <h2>Connect your own seller-performance sources</h2>
                <p>The live dashboard never borrows another seller’s export or substitutes opportunity values for official earnings.</p>
                <ol><li>Download your own fiscal-year <strong>Quota by Accounts CSV</strong> from MSX Earnings.</li>
                    <li>Use the trusted Python collector to validate and set up your own Windows-user-encrypted profile, tenant, MSX organization and installed MCP runtime.</li>
                    <li>Complete one explicit successful source refresh.</li>
                    <li>Configure <code>TLC_SELLER_DASHBOARD_SKILL_ROOT</code>, <code>TLC_SELLER_DASHBOARD_PROFILE</code> and <code>TLC_SELLER_DASHBOARD_OWNER_EMAIL</code> in the local host’s environment, then reload.</li></ol>
                <p>Hosted multi-user Web never reads a server user’s private profile. Consumption and U2C require their own validated source evidence. Sample mode remains available for an offline feature walkthrough.</p>
            </section>}
            {snapshot && view && <>
                {snapshot.mode === 'sample' && <SellerDashboardNotice>{snapshot.message}</SellerDashboardNotice>}
                <SellerDashboardOverview snapshot={snapshot} />
                {snapshot.report.sources.pipeline.status !== 'complete' && <SellerDashboardNotice warning>
                    Pipeline source is {snapshot.report.sources.pipeline.status}. Returned inventory is not complete coverage; missing access is not zero pipeline.
                </SellerDashboardNotice>}
                {!snapshot.report.plan.sourceUnitsVerified && <SellerDashboardNotice warning>
                    Optional MINT unit metadata is unverified. USD denomination relies on the validated own-quota export and monetary reconciliation, not an invented source unit.
                </SellerDashboardNotice>}
                {snapshot.report.warnings.length > 0 && <details className="sd-warning-summary">
                    <summary>{snapshot.report.warnings.length} source-quality / methodology warnings</summary>
                    <ul>{snapshot.report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                </details>}
                <section className="sd-filters" aria-label="Seller Dashboard filters">
                    <div className="sd-filter-heading"><h2>Explore the working view</h2><button type="button" onClick={() => setFilters(defaultSellerDashboardFilters(snapshot.report))}>Reset filters</button></div>
                    <div className="sd-filter-grid">
                        <label>Account<select aria-label="Seller account" value={filters.account} onChange={(event) => update('account', event.target.value)}><option value="">All accounts</option>
                            {snapshot.report.accounts.map((row) => <option value={row.tpid} key={row.tpid}>{row.name}</option>)}</select></label>
                        <label>Microsoft fiscal quarter<select aria-label="Seller fiscal quarter" value={filters.quarter} onChange={(event) => update('quarter', event.target.value)}><option value="all">All FY{snapshot.report.plan.fiscalYear % 100} quarters</option>
                            {sellerFiscalQuarters(snapshot.report.plan.fiscalYear).map((row) => <option value={row.value} key={row.value}>{row.label}</option>)}</select></label>
                        <label>Bucket<select aria-label="Seller bucket" value={filters.bucket} onChange={(event) => update('bucket', event.target.value)}><option value="">All buckets</option>
                            {snapshot.report.official.buckets.map((row) => <option key={row.name}>{row.name}</option>)}</select></label>
                        <label>Metric<select aria-label="Seller metric" value={filters.metric} onChange={(event) => update('metric', event.target.value)}><option value="">All metrics</option>
                            {snapshot.report.official.metrics.filter((row) => !filters.bucket || row.bucket === filters.bucket).map((row) => <option key={row.name}>{row.name}</option>)}</select></label>
                        <label>Pipeline state<select aria-label="Seller pipeline state" value={filters.state} onChange={(event) => update('state', event.target.value)}>
                            <option value="">All available inventory</option><option value="in-quarter">Remaining official period</option><option value="overdue">Overdue</option><option value="future">After official period</option>
                            <option value="undated">Unknown date</option><option value="committed">Committed milestones</option><option value="uncommitted">Uncommitted milestones</option>
                            <option value="production">Production candidates</option><option value="no-pipeline">No recorded pipeline</option><option value="no-quarter">No remaining-quarter candidate</option>
                            <option value="partial">Partial source</option><option value="unavailable">Unavailable source</option>
                        </select></label>
                        <label className="sd-search">Search this view<input type="search" aria-label="Search Seller Dashboard" placeholder="Account, owner, milestone or workload" value={filters.search} onChange={(event) => update('search', event.target.value)} autoComplete="off" /></label>
                    </div>
                    <p className="sd-footnote">The quarter selector dates inventory only. Official earnings remain {sellerDate(snapshot.report.period.start)}–{sellerDate(snapshot.report.period.end)}. Metric/workload matches are tentative; source financial amounts are never prorated by filters.</p>
                </section>
                <nav className="sd-tabs" role="tablist" aria-label="Seller Dashboard report sections">
                    {sellerDashboardSections.map((item, index) => <button key={item.id} id={`sd-tab-${item.id}`} type="button" role="tab"
                        aria-selected={section === item.id} aria-controls={`sd-panel-${item.id}`} tabIndex={section === item.id ? 0 : -1}
                        className={section === item.id ? 'active' : undefined} onClick={() => setSection(item.id)}
                        onKeyDown={(event) => changeSectionByKeyboard(event, index)}>{item.label}</button>)}
                </nav>
                <p className="sd-scope" aria-live="polite">{view.accounts.length} of {snapshot.report.accounts.length} accounts · {view.opportunities.length} opportunities · {view.milestones.length} milestones in this working view</p>
                <div id={`sd-panel-${section}`} role="tabpanel" aria-labelledby={`sd-tab-${section}`} className="sd-report-panel">
                    <SellerDashboardSectionContent section={section} snapshot={snapshot} view={view} scenario={scenario} onScenarioChange={setScenario} />
                </div>
                <SourcesAndMethod snapshot={snapshot} />
            </>}
            {confirmRefresh && <RefreshConfirmation onClose={() => setConfirmRefresh(false)} onConfirm={(asOf) => {
                setConfirmRefresh(false)
                void load({ contractVersion: sellerDashboardContractVersion, operation: 'refresh', confirmed: true, asOf })
            }} />}
        </div>
    </section>
}
