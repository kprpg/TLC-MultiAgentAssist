import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    seReportingRequestSchema, seReportingResponseSchema,
    type SeAccess, type SeReportingRequest, type SeReportingResponse
} from '../../../../packages/common/contracts/se-reporting.js'
import { renderSeReportHtml } from '../../../../packages/documents/se-reporting.js'
import { SeReportSetup, type InvokeSeReporting } from './report-setup.js'
import { downloadSeReport, SeReportGeneration, SeReportPublication, SeReportReview } from './report-workflow.js'
import { InferenceNotice } from '../../inference-status.js'
import { uiFontScale } from '../../font-scale.js'

export function SeReportingDashboardPane({ invoke }: { invoke: InvokeSeReporting }) {
    const [state, setState] = useState<Extract<SeReportingResponse, { kind: 'state' }> | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [access, setAccess] = useState<SeAccess[]>([])
    const [profileId, setProfileId] = useState('')
    const [reportId, setReportId] = useState('')
    const [status, setStatus] = useState('')
    const [dark, setDark] = useState(false)
    const generation = useRef(0)
    const root = useRef<HTMLElement>(null)
    const perform = useCallback(async (request: SeReportingRequest) => {
        const current = ++generation.current
        setBusy(true); setError('')
        try {
            const response = seReportingResponseSchema.parse(await invoke(seReportingRequestSchema.parse(request)))
            if (current !== generation.current) return null
            if (response.kind === 'error') {
                setError(response.message)
                setAccess(response.access)
                if (/identity|sign-in|denied|expired/.test(response.code)) setState(null)
                return null
            }
            setState(response); setAccess(response.access)
            setProfileId((previous) => request.operation === 'setup' ? request.profile.id
                : response.profiles.some((row) => row.id === previous) ? previous : response.profiles[0]?.id ?? '')
            setReportId((previous) => response.run?.reports.some((report) => report.report_id === previous) ? previous : response.run?.reports.at(-1)?.report_id ?? '')
            return response
        } catch (cause) {
            if (current !== generation.current) return null
            setError(cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'The reporting response failed validation. No replacement data was accepted.')
            if (cause && typeof cause === 'object' && 'status' in cause && (cause.status === 401 || cause.status === 403)) setState(null)
            return null
        } finally { if (current === generation.current) setBusy(false) }
    }, [invoke])
    useEffect(() => {
        setState(null); setProfileId(''); setReportId(''); setAccess([])
        void perform({ contractVersion: '1.0', operation: 'get' })
        return () => { ++generation.current }
    }, [perform])
    useEffect(() => {
        const read = () => {
            const color = root.current ? getComputedStyle(root.current).backgroundColor : ''
            const channels = color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number)
            setDark(document.documentElement.dataset['theme'] === 'dark' || document.body.dataset['theme'] === 'dark' ||
                document.body.classList.contains('vscode-dark') || getComputedStyle(document.documentElement).colorScheme === 'dark' ||
                Boolean(channels?.length === 3 && channels.reduce((sum, value) => sum + value, 0) / 3 < 128))
        }
        const observer = new MutationObserver(read)
        observer.observe(document.documentElement, { attributes: true })
        observer.observe(document.body, { attributes: true })
        const fluent = root.current?.closest('.fui-FluentProvider')
        if (fluent) observer.observe(fluent, { attributes: true })
        read()
        return () => observer.disconnect()
    }, [])
    const selectedProfile = state?.profiles.find((profile) => profile.id === profileId)
    const activeRun = state?.run?.profileId === profileId ? state.run : null
    const selectedReport = activeRun?.reports.find((report) => report.report_id === reportId)
    const html = useMemo(() => selectedReport ? renderSeReportHtml(selectedReport, { customerStatus: status, dark, includeFilters: false, styleNonce: document.getElementById('root')?.dataset['cspNonce'] ?? '', fontScale: uiFontScale }) : '', [selectedReport, status, dark])
    return <section ref={root} className="se-reporting-dashboard" aria-label="SE Reporting Dashboard" aria-busy={busy}>
        <div className="se-report-shell">
            <header className="se-report-header"><div><p className="se-report-eyebrow">MONTHLY POD REPORTING</p><h1>SE Reporting Dashboard</h1>
                <p>Manager-scoped reporting, source-backed outcomes and reporter-owned asks.</p></div>
                <span className="se-report-mode">{state?.mode === 'sample' ? 'SYNTHETIC SAMPLE' : 'PRIVATE · DRAFT-FIRST'}</span>
            </header>
            {busy && <p role="status">Reporting operation in progress…</p>}
            {error && <div className="se-report-error" role="alert">{error}{state?.run && <p>The previous package remains visible; it is not a successful result of this operation.</p>}</div>}
            {state?.message && !error && <p className="se-report-notice" role="status">{state.message}</p>}
            <InferenceNotice execution={state?.inference} />
            <div className="se-report-actions">
                <label>Manager reporting profile<select value={profileId} onChange={(event) => {
                    setProfileId(event.target.value); setStatus(''); setAccess([]); setError('')
                    setState((previous) => previous ? { ...previous, message: '', publishPreview: null } : previous)
                }}>
                    {!state?.profiles.length && <option value="">No manager profiles configured</option>}
                    {state?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                </select></label>
                <button type="button" disabled={busy} onClick={() => void perform({ contractVersion: '1.0', operation: 'get' })}>Reload reporting workspace</button>
            </div>
            <SeReportSetup key={`setup:${selectedProfile?.id ?? 'new'}`} {...(selectedProfile ? { profile: selectedProfile } : {})} busy={busy} perform={perform} scope={state?.scope ?? null} />
            {selectedProfile && <details><summary>Add another manager profile</summary><SeReportSetup key="additional-profile" busy={busy} perform={perform} scope={state?.scope ?? null} /></details>}
            {access.length > 0 && <details className="se-report-access"><summary>Source access and reporting scope</summary><ul>
                {access.map((row) => <li key={row.source}><strong>{row.source.replaceAll('_', ' ')}</strong>: {row.state} — {row.detail}</li>)}
            </ul></details>}
            {selectedProfile && state && <SeReportGeneration key={`generation:${selectedProfile.id}`} profile={selectedProfile} scope={state.scope} access={access} mode={state.mode} busy={busy} perform={perform}
                detectedPillars={activeRun?.pillars ?? []}
                {...(state.mode === 'sample' && activeRun?.reports[0] ? { samplePeriod: activeRun.reports[0].period } : {})} />}
            {activeRun && state && <>
                <div className="se-report-actions">
                    <label>Report scope<select value={reportId} onChange={(event) => { setReportId(event.target.value); setStatus('') }}>
                        {activeRun.reports.map((report) => <option key={report.report_id} value={report.report_id}>
                            {report.artifact_type === 'person_monthly_summary' ? 'Person monthly summary · all ATUs' : `${report.atu} · ${report.pillar}`} · {report.period} · {report.status}
                        </option>)}
                    </select></label>
                    <label>Customer update status<select value={status} onChange={(event) => setStatus(event.target.value)}>
                        <option value="">All</option><option value="running_hot">Running hot</option><option value="with_blocker">With blocker</option><option value="advisory">Advisory</option><option value="watchlist">Watchlist</option>
                    </select></label>
                    {selectedReport && <><button type="button" onClick={() => downloadSeReport(selectedReport, 'json')}>Download report JSON</button>
                        <button type="button" onClick={() => downloadSeReport(selectedReport, 'html')}>Download report HTML</button></>}
                </div>
                <SeReportReview key={`${activeRun.id}:${activeRun.reports[0]?.review.approved_at ?? ''}`} run={activeRun} busy={busy} perform={perform} />
                <SeReportPublication state={state} busy={busy} perform={perform} />
            </>}
            {selectedReport && <iframe className="se-report-preview" title="SE monthly report" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" />}
            {!selectedReport && !busy && <p className="se-report-empty">Set up a manager profile, verify source access, and generate a reporting-month draft. No live report data is bundled or inferred.</p>}
        </div>
    </section>
}
