import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import {
    stagePipelineRequestSchema, stagePipelineResponseSchema, stagePipelineReviewContractVersion,
    type StagePipelineRequest, type StagePipelineResponse, type StagePipelineSnapshot
} from '../../../../packages/common/contracts/stage-pipeline-review.js'
import { createSampleStagePipelineReview } from '../../../../packages/common/fixtures/stage-pipeline-review.js'
import {
    acrSeries, defaultReviewFilters, deriveActions, deriveOpportunities, distinctSorted, emptyMilestoneFilters, filterOpportunityViews,
    formatMoney, inboundCount, matchesScope, milestonesForOpportunities, stageCounts, sumConsumed,
    type MilestoneFilters, type ReviewFilters, type ReviewMarks, type ReviewTab
} from './stage-pipeline-analysis.js'
import { AcrChart } from './stage-pipeline-acr-chart.js'
import { ActionsTab, ConsumptionTab, MaccTab } from './stage-pipeline-extra-tabs.js'
import { FilterBar, ScopeToggles } from './stage-pipeline-filters.js'
import { MilestonesTab } from './stage-pipeline-milestones.js'
import { AlertCards, OpportunityKpis, OpportunityTable } from './stage-pipeline-opportunities.js'
import { loadMarks, saveMarks, toggleMark } from './stage-pipeline-storage.js'

export type InvokeStagePipelineReview = (request: StagePipelineRequest) => Promise<StagePipelineResponse>

const sampleInvoke: InvokeStagePipelineReview = async () => createSampleStagePipelineReview()

const tabs: ReadonlyArray<{ id: ReviewTab; label: string; glyph: string }> = [
    { id: 'opportunities', label: 'Opportunities', glyph: '◎' },
    { id: 'actions', label: 'Actions', glyph: '◉' },
    { id: 'consumption', label: 'Consumption', glyph: '▥' },
    { id: 'macc', label: 'MACC & Commits', glyph: '▣' },
    { id: 'milestones', label: 'Milestones', glyph: '▦' }
]

export function StagePipelineReviewPane({ invoke = sampleInvoke }: { invoke?: InvokeStagePipelineReview }): ReactElement {
    const [snapshot, setSnapshot] = useState<StagePipelineSnapshot | null>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(true)
    const [tab, setTab] = useState<ReviewTab>('opportunities')
    const [filters, setFilters] = useState<ReviewFilters>(defaultReviewFilters)
    const [milestoneFilters, setMilestoneFilters] = useState<MilestoneFilters>(emptyMilestoneFilters)
    const [marks, setMarks] = useState<ReviewMarks>(loadMarks)
    const generation = useRef(0)

    useEffect(() => { saveMarks(marks) }, [marks])
    const load = useCallback(async () => {
        const current = ++generation.current
        setBusy(true)
        setError('')
        try {
            const response = stagePipelineResponseSchema.parse(await invoke(stagePipelineRequestSchema.parse({ contractVersion: stagePipelineReviewContractVersion, operation: 'get' })))
            if (current !== generation.current) return
            if (response.kind === 'unavailable') { setError(response.message); setSnapshot(null) } else setSnapshot(response)
        } catch (cause) {
            if (current !== generation.current) return
            setError(cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'The dashboard response failed validation. No data was accepted.')
        } finally {
            if (current === generation.current) setBusy(false)
        }
    }, [invoke])
    useEffect(() => { void load(); return () => { ++generation.current } }, [load])

    const views = useMemo(() => snapshot ? deriveOpportunities(snapshot) : [], [snapshot])
    const withoutAlert = useMemo(() => filterOpportunityViews(views, filters, marks, ['alert']), [views, filters, marks])
    const filtered = useMemo(() => {
        const alert = filters.alert
        return alert ? withoutAlert.filter((view) => view.alerts.has(alert)) : withoutAlert
    }, [withoutAlert, filters.alert])
    const actions = useMemo(() => deriveActions(filtered), [filtered])
    const scopeMilestones = useMemo(() => snapshot ? milestonesForOpportunities(snapshot, new Set(filtered.map((view) => view.row.id))) : [], [snapshot, filtered])
    const opportunityById = useMemo(() => new Map((snapshot?.opportunities ?? []).map((row) => [row.id, row])), [snapshot])
    const options = useMemo(() => {
        const scoped = views.filter((view) => matchesScope(view, filters))
        return {
            customers: distinctSorted(views.map((view) => view.row.customer)),
            statuses: distinctSorted(views.map((view) => view.row.status)),
            forecasts: distinctSorted(views.map((view) => view.row.forecast)),
            solutions: distinctSorted(views.filter((view) => filters.scope === 'all' || view.row.scope === filters.scope).map((view) => view.row.solutionArea)),
            quarters: distinctSorted(scoped.map((view) => view.quarter)),
            partners: distinctSorted(scoped.map((view) => view.row.partner))
        }
    }, [views, filters])
    const stageOptionCounts = useMemo(() => stageCounts(views, filters, marks), [views, filters, marks])
    const acr = useMemo(() => snapshot ? acrSeries(snapshot.acr, filters.customer) : { points: [], accounts: 0 }, [snapshot, filters.customer])
    const onToggle = useCallback((kind: keyof ReviewMarks, id: string) => setMarks((previous) => toggleMark(previous, kind, id)), [])

    const counts: Record<ReviewTab, number> = {
        opportunities: filtered.length,
        actions: actions.length,
        consumption: filtered.filter((view) => view.consumed > 0).length,
        macc: filtered.filter((view) => view.row.maccCommit > 0).length,
        milestones: scopeMilestones.length
    }
    const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const last = tabs.length - 1
        const next = event.key === 'ArrowRight' ? (index + 1) % (last + 1) : event.key === 'ArrowLeft' ? (index + last) % (last + 1)
            : event.key === 'Home' ? 0 : event.key === 'End' ? last : null
        const target = next === null ? undefined : tabs[next]
        if (!target) return
        event.preventDefault()
        setTab(target.id)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next ?? 0]?.focus()
    }

    return <section className="stage-pipeline-review" aria-label="Stage and Pipeline Review" aria-busy={busy}>
        <div className="sprv-inner">
            <header className="sprv-header">
                <div>
                    <h1>Stage and Pipeline Review</h1>
                    {snapshot && <p className="sprv-muted">
                        {snapshot.owner} · {filtered.length} of {views.length} consumption opportunities · {formatMoney(sumConsumed(filtered))} consumed · {snapshot.mode === 'sample' ? 'synthetic sample' : 'live from MSX'} · {snapshot.asOf}
                    </p>}
                </div>
                {snapshot && <ScopeToggles filters={filters} inbound={inboundCount(views, filters.scope)} onChange={setFilters} />}
            </header>
            {busy && !snapshot && <p className="sprv-muted" role="status">Loading the Stage and Pipeline Review…</p>}
            {error && <div className="sprv-error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></div>}
            {snapshot?.state === 'stale' && <div className="sprv-notice" role="status"><strong>Stale snapshot.</strong> {snapshot.message}</div>}
            {snapshot?.mode === 'sample' && <div className="sprv-notice" role="status">{snapshot.message}</div>}
            {snapshot && <>
                <FilterBar filters={filters} options={options} stageCounts={stageOptionCounts} onChange={setFilters} />
                <div className="sprv-tabs" role="tablist" aria-label="Stage and Pipeline Review sections">
                    {tabs.map((item, index) => <button key={item.id} type="button" role="tab" id={`sprv-tab-${item.id}`} aria-selected={tab === item.id}
                        aria-controls="sprv-panel" tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'active' : undefined}
                        onClick={() => setTab(item.id)} onKeyDown={(event) => onTabKey(event, index)}>
                        <span aria-hidden="true">{item.glyph}</span> {item.label} <span className="sprv-tab-count">{counts[item.id]}</span>
                    </button>)}
                </div>
                <div id="sprv-panel" role="tabpanel" aria-labelledby={`sprv-tab-${tab}`}>
                    {tab === 'opportunities' && <>
                        <AlertCards views={withoutAlert} active={filters.alert} onSelect={(alert) => setFilters({ ...filters, alert })} />
                        <OpportunityKpis views={filtered} />
                        <AcrChart points={acr.points} accountCount={acr.accounts} syncedAt={snapshot.acr.syncedAt} />
                        <OpportunityTable views={filtered} marks={marks} onToggle={onToggle} />
                    </>}
                    {tab === 'actions' && <ActionsTab actions={actions} views={filtered} />}
                    {tab === 'consumption' && <ConsumptionTab views={filtered} marks={marks} onToggle={onToggle} />}
                    {tab === 'macc' && <MaccTab views={filtered} marks={marks} onToggle={onToggle} />}
                    {tab === 'milestones' && <MilestonesTab scopeRows={scopeMilestones} filters={milestoneFilters} onFilters={setMilestoneFilters} asOf={snapshot.asOf} opportunities={opportunityById} />}
                </div>
            </>}
        </div>
    </section>
}
