import { useState } from 'react'
import {
    seReportingProfileSchema, type SeReportingProfile, type SeReportingRequest, type SeReportingResponse
} from '../../../../packages/common/contracts/se-reporting.js'

export type InvokeSeReporting = (request: SeReportingRequest) => Promise<SeReportingResponse>
export type PerformSeReporting = (request: SeReportingRequest) => Promise<Extract<SeReportingResponse, { kind: 'state' }> | null>
const sourceOptions = [
    ['m365_calendar', 'Calendar activity index'], ['m365_email', 'Email recaps and follow-ups'],
    ['m365_teams', 'Teams discussion context'], ['m365_files', 'Supporting files'], ['wiki', 'Optional wiki']
] as const

export function SeReportSetup({ profile, busy, perform, scope }: {
    profile?: SeReportingProfile; busy: boolean; perform: PerformSeReporting
    scope: Extract<SeReportingResponse, { kind: 'state' }>['scope']
}) {
    const [value, setValue] = useState<SeReportingProfile>(profile ?? {
        id: '', label: '', contractUrl: '', outputRootUrl: '', semanticModelId: '',
        sources: ['m365_calendar', 'm365_email', 'm365_teams', 'm365_files']
    })
    const [mapping, setMapping] = useState(profile?.workloadMap ? JSON.stringify(profile.workloadMap) : '')
    const [inspected, setInspected] = useState('')
    const [error, setError] = useState('')
    const update = (field: 'id' | 'label' | 'contractUrl' | 'outputRootUrl' | 'semanticModelId' | 'wikiUrl', content: string) => {
        setValue((previous) => ({ ...previous, [field]: content }))
        setInspected('')
    }
    const parse = () => {
        let workloadMap: unknown
        try { workloadMap = mapping.trim() ? JSON.parse(mapping) : undefined } catch {
            setError('Workload mapping must be a JSON object, for example {"Infrastructure":"infra"}.')
            return null
        }
        const { wikiUrl: _wiki, workloadMap: _mapping, ...base } = value
        void _wiki; void _mapping
        const result = seReportingProfileSchema.safeParse({ ...base, ...(value.wikiUrl?.trim() ? { wikiUrl: value.wikiUrl.trim() } : {}), ...(workloadMap ? { workloadMap } : {}) })
        if (!result.success) { setError(result.error.issues.map((issue) => issue.message).join(' ')); return null }
        setError('')
        return result.data
    }
    return <details className="se-report-settings" open={!profile}>
        <summary>{profile ? 'Edit manager profile' : 'Set up a manager profile'}</summary>
        <form onSubmit={(event) => {
            event.preventDefault()
            const parsed = parse()
            if (!parsed) return
            void perform({ contractVersion: '1.0', operation: 'inspect-profile', profile: parsed }).then((result) => {
                if (result) setInspected(JSON.stringify(parsed))
            })
        }}>
            <p>Use this manager’s live contract and reporting root. The bundled example is not a live contract. No tokens, private account lists or local credentials belong in this form.</p>
            <div className="se-report-form-grid">
                <label>Profile ID<input required value={value.id} pattern="[a-z0-9][a-z0-9-]{0,79}" onChange={(event) => update('id', event.target.value)} /></label>
                <label>Profile label<input required value={value.label} onChange={(event) => update('label', event.target.value)} /></label>
                <label>Live contract URL<input required type="url" value={value.contractUrl} onChange={(event) => update('contractUrl', event.target.value)} /></label>
                <label>Shared report output root<input required type="url" value={value.outputRootUrl} onChange={(event) => update('outputRootUrl', event.target.value)} /></label>
                <label>Power BI semantic-model ID<input required value={value.semanticModelId} onChange={(event) => update('semanticModelId', event.target.value)} /></label>
                <label>Optional wiki file URL<input type="url" value={value.wikiUrl ?? ''} onChange={(event) => update('wikiUrl', event.target.value)} /></label>
            </div>
            <fieldset><legend>Enabled evidence sources</legend>{sourceOptions.map(([id, label]) => <label className="se-report-check" key={id}>
                <input type="checkbox" checked={value.sources.includes(id)} onChange={(event) => {
                    setValue((previous) => ({ ...previous, sources: event.target.checked ? [...previous.sources, id] : previous.sources.filter((source) => source !== id) }))
                    setInspected('')
                }} />{label}
            </label>)}</fieldset>
            <label>Optional workload mapping (JSON)<textarea value={mapping} onChange={(event) => { setMapping(event.target.value); setInspected('') }} placeholder='{"Infrastructure":"infra"}' /></label>
            <p>Power BI assignments are mandatory. Calendar titles alone never count as outcomes. Email bodies and messages are held only during generation; the report retains summaries and references.</p>
            {error && <p role="alert">{error}</p>}
            <div className="se-report-actions"><button type="submit" disabled={busy}>Inspect live contract and access</button>
                {inspected && scope?.profileId === value.id && <div className="se-report-scope">
                    <p><strong>{scope.manager}</strong> · Reporter: {scope.reporter} · Primary: {scope.primary} · Secondary: {scope.secondary} · Pillars: {scope.pillars.join(', ')}</p>
                    <button type="button" disabled={busy} onClick={() => {
                        const parsed = parse()
                        if (parsed && JSON.stringify(parsed) === inspected) void perform({ contractVersion: '1.0', operation: 'setup', profile: parsed, confirmed: true })
                    }}>Confirm scope and save profile</button>
                </div>}
            </div>
        </form>
    </details>
}
