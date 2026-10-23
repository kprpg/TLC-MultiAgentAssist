import { useState } from 'react'
import type { SeAccess, SeReportingProfile, SeReportingResponse, SeReportingRun, SeReportingSource } from '../../../../packages/common/contracts/se-reporting.js'
import { seReportingSourceSchema } from '../../../../packages/common/contracts/se-reporting.js'
import { renderSeReportHtml } from '../../../../packages/documents/se-reporting.js'
import type { PerformSeReporting } from './report-setup.js'

function previousMonth(): string {
    const now = new Date()
    return new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1)).toISOString().slice(0, 7)
}

export function SeReportGeneration({ profile, scope, access, mode, busy, perform, samplePeriod, detectedPillars }: {
    profile: SeReportingProfile; scope: Extract<SeReportingResponse, { kind: 'state' }>['scope']
    access: SeAccess[]; mode: 'sample' | 'live'; busy: boolean; perform: PerformSeReporting; samplePeriod?: string; detectedPillars: string[]
}) {
    const [period, setPeriod] = useState(mode === 'sample' ? samplePeriod ?? previousMonth() : previousMonth())
    const [pillar, setPillar] = useState('')
    const [allowed, setAllowed] = useState<SeReportingSource[]>([])
    const [testContract, setTestContract] = useState<{ name: string; text: string } | null>(null)
    const [fileError, setFileError] = useState('')
    const [testMode, setTestMode] = useState(false)
    const pillars = scope?.profileId === profile.id ? scope.pillars : detectedPillars
    const missing = access.filter((row) => row.state === 'unavailable' && seReportingSourceSchema.safeParse(row.source).success)
    return <form className="se-report-generation" onSubmit={(event) => {
        event.preventDefault()
        void perform({ contractVersion: '1.0', operation: 'run', profileId: profile.id, period, pillar: pillar || pillars[0] || '',
            allowUnavailable: allowed, confirmed: true, ...(testMode && testContract ? { testContract } : {}) })
    }}>
        <div className="se-report-actions">
            <label>Reporting month<input type="month" required value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
            <label>Reporting pillar<select required value={pillar || pillars[0] || ''} onChange={(event) => setPillar(event.target.value)}>
                {!pillars.length && <option value="">Check access to resolve your workloads</option>}
                {pillars.map((value) => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <button type="button" disabled={busy} onClick={() => void perform({ contractVersion: '1.0', operation: 'check-access', profileId: profile.id })}>Check source access</button>
            <button type="submit" disabled={busy || !pillars.length || (testMode && !testContract)}>Generate draft package</button>
        </div>
        <p>Generation reads the live contract and refreshes current assignments. It does not write CRM records, overwrite reports or publish anything.</p>
        {missing.length > 0 && <fieldset><legend>Unavailable evidence — explicit degraded-mode approval</legend>
            {missing.map((row) => <label key={row.source} className="se-report-check"><input type="checkbox" checked={allowed.includes(seReportingSourceSchema.parse(row.source))}
                onChange={(event) => {
                    const source = seReportingSourceSchema.parse(row.source)
                    setAllowed((previous) => event.target.checked ? [...previous, source] : previous.filter((value) => value !== source))
                }} />Continue without {row.source.replaceAll('_', ' ')} for this run: {row.detail}</label>)}
            <p>Alternatively disable a source in the profile or stop. Manager, assignment and MSX access cannot be bypassed.</p>
        </fieldset>}
        {mode === 'live' && <details><summary>Isolated local-contract test</summary>
            <label className="se-report-check"><input type="checkbox" checked={testMode} onChange={(event) => setTestMode(event.target.checked)} />Use an explicitly selected test contract instead of the live contract for this run only</label>
            {testMode && <label>Test contract file<input type="file" accept=".md,.txt" onChange={(event) => {
                const file = event.target.files?.[0]
                setTestContract(null); setFileError('')
                if (!file) return
                if (file.size > 150000) { setFileError('The test contract exceeds the 150 KB limit.'); return }
                void file.text().then((text) => setTestContract({ name: file.name, text }), () => setFileError('The selected test contract could not be read.'))
            }} /></label>}
            <p>Test output remains draft, can only be downloaded locally, and cannot replace a shared contract or be published.</p>
            {fileError && <p role="alert">{fileError}</p>}
        </details>}
    </form>
}

export function SeReportReview({ run, busy, perform }: { run: SeReportingRun; busy: boolean; perform: PerformSeReporting }) {
    const reports = run.reports.filter((report) => report.artifact_type === 'person_pillar_report')
    const [asks, setAsks] = useState<Record<string, string>>(() => Object.fromEntries(reports.map((report) => [report.report_id, report.asks_for_manager.map((row) => row.ask).join('\n')])))
    const [confirmed, setConfirmed] = useState(false)
    const [approve, setApprove] = useState(false)
    const testMode = run.reports.some((report) => report.schema_contract.test_mode)
    return <details className="se-report-review">
        <summary>Reporter review and manager asks</summary>
        <form onSubmit={(event) => {
            event.preventDefault()
            void perform({ contractVersion: '1.0', operation: 'review', runId: run.id,
                asks: reports.map((report) => ({ reportId: report.report_id, text: asks[report.report_id] ?? '' })), approve, confirmed: true })
        }}>
            <p>Asks are yours alone. They are never generated, inferred, ranked or rewritten. Leave a field empty to explicitly record no asks for that ATU.</p>
            {reports.map((report) => <label key={report.report_id}>Asks for {report.manager.name} — {report.atu}
                <textarea maxLength={4000} value={asks[report.report_id] ?? ''} onChange={(event) => { setAsks((previous) => ({ ...previous, [report.report_id]: event.target.value })); setConfirmed(false) }} />
            </label>)}
            <label className="se-report-check"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed every report and confirm these asks verbatim, or no asks where blank.</label>
            <label className="se-report-check"><input type="checkbox" disabled={testMode} checked={approve && !testMode} onChange={(event) => setApprove(event.target.checked)} />Explicitly approve this package for manager review</label>
            <button type="submit" disabled={busy || !confirmed}>Save reporter review</button>
        </form>
    </details>
}

export function SeReportPublication({ state, busy, perform }: {
    state: Extract<SeReportingResponse, { kind: 'state' }>; busy: boolean; perform: PerformSeReporting
}) {
    const [overwrite, setOverwrite] = useState(false)
    const [confirmed, setConfirmed] = useState(false)
    const run = state.run
    if (!run || run.reports.some((report) => report.schema_contract.test_mode)) return null
    const profile = state.profiles.find((row) => row.id === run.profileId)
    const preview = state.publishPreview
    return <details className="se-report-publication">
        <summary>{state.mode === 'sample' ? 'Simulate report publication' : 'Publish reviewed report artifacts'}</summary>
        {profile && <p><strong>Reporting profile:</strong> {profile.label}<br /><strong>Destination:</strong> <a href={profile.outputRootUrl} target="_blank" rel="noopener noreferrer">{profile.outputRootUrl}</a></p>}
        <p>Only your own ATU JSON/HTML pairs and your person summary are written. Shared contracts, rollups and other reporters’ artifacts are not changed.</p>
        <button type="button" disabled={busy || run.reports.some((report) => !report.review.asks_captured)} onClick={() => {
            setOverwrite(false); setConfirmed(false)
            void perform({ contractVersion: '1.0', operation: 'prepare-publish', runId: run.id })
        }}>Preview destination files</button>
        {preview && <form onSubmit={(event) => {
            event.preventDefault()
            void perform({ contractVersion: '1.0', operation: 'publish', runId: run.id, token: preview.token, overwriteConfirmed: overwrite, confirmed: true })
        }}>
            <ul>{preview.files.map((file) => <li key={file.path}><code>{file.path}</code> — {file.status}</li>)}</ul>
            {preview.files.some((file) => file.exists) && <label className="se-report-check"><input type="checkbox" required checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />I authorize replacement of all listed existing files, including any approved or final reports.</label>}
            <label className="se-report-check"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I confirm this exact file set, destination and report status.</label>
            <button type="submit" disabled={busy || !confirmed || (preview.files.some((file) => file.exists) && !overwrite)}>{state.mode === 'sample' ? 'Simulate publication — no writes' : 'Publish confirmed package'}</button>
        </form>}
    </details>
}

export function downloadSeReport(report: SeReportingRun['reports'][number], format: 'json' | 'html') {
    const content = format === 'json' ? JSON.stringify(report, null, 2) : renderSeReportHtml(report)
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${report.artifact_type === 'person_monthly_summary' ? 'person-summary' : `${report.atu}-${report.pillar}-${report.owner.alias}`}-${report.period}.${format}`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
}
