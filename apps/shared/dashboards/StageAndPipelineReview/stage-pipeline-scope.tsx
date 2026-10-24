import type { ReactElement } from 'react'
import type {
    StagePipelineSourceHealth, StagePipelineViewScope
} from '../../../../packages/common/contracts/stage-pipeline-review.js'
import { Segmented } from './stage-pipeline-filters.js'

const sourceLabels: Record<StagePipelineSourceHealth['source'], string> = {
    opportunities: 'Opportunities', milestones: 'Milestones', macc: 'MACC', acr: 'ACR', hierarchy: 'Direct reports'
}

export function ViewScopeControls({ scope, reports, selectedIds, busy, onScope, onSelected }: {
    scope: StagePipelineViewScope
    reports: ReadonlyArray<{ id: string; displayName: string }>
    selectedIds: readonly string[]
    busy: boolean
    onScope(next: StagePipelineViewScope): void
    onSelected(next: string[]): void
}): ReactElement {
    const viewing = selectedIds.length === 0 ? reports.length : selectedIds.length
    return <div className="sprv-viewscope" aria-busy={busy}>
        <Segmented<StagePipelineViewScope> name="sprv-view-scope" label="Portfolio scope" value={scope} onChange={onScope} options={[
            { value: 'mine', label: 'My portfolio', glyph: '◎' },
            { value: 'reports', label: 'My direct reports', glyph: '👥' },
            { value: 'both', label: 'Both', glyph: '◍' }
        ]} />
        {scope !== 'mine' && <div className="sprv-reports" role="group" aria-label="Direct reports in view">
            <strong>Direct reports in view</strong>
            {reports.length === 0
                ? <span className="sprv-muted">{busy ? 'Loading direct reports…' : 'No direct reports were found in your Dynamics manager hierarchy.'}</span>
                : <>
                    <span className="sprv-muted">Viewing {viewing} of {reports.length} direct reports. Report opportunities are read-only here.</span>
                    <span className="sprv-report-list">
                        {reports.map((report) => <label key={report.id} className="sprv-report-option">
                            <input type="checkbox" checked={selectedIds.length === 0 || selectedIds.includes(report.id)}
                                onChange={(event) => {
                                    const current = selectedIds.length === 0 ? reports.map((row) => row.id) : [...selectedIds]
                                    const next = event.target.checked ? [...new Set([...current, report.id])] : current.filter((id) => id !== report.id)
                                    onSelected(next.length === reports.length ? [] : next)
                                }} />
                            {report.displayName}
                        </label>)}
                    </span>
                </>}
        </div>}
    </div>
}

export function SourceHealthNotice({ sources }: { sources: readonly StagePipelineSourceHealth[] }): ReactElement | null {
    const degraded = sources.filter((source) => source.state !== 'complete')
    if (degraded.length === 0) return null
    return <div className="sprv-notice sprv-health" role="status" aria-label="Source health">
        <ul>
            {degraded.map((source) => <li key={source.source}>
                <strong>{source.state === 'partial' ? 'Partial' : 'Unavailable'}</strong> · {sourceLabels[source.source]}: {source.detail}
            </li>)}
        </ul>
    </div>
}
