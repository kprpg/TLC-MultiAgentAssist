import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { DashboardSectionTabs } from '../dashboard-controls.js'
import {
    stagePipelineRequestSchema, stagePipelineResponseSchema, stagePipelineReviewContractVersion,
    type StagePipelineRequest, type StagePipelineResponse, type StagePipelineSnapshot, type StagePipelineViewScope
} from '../../../../packages/common/contracts/stage-pipeline-review.js'
import { createSampleStagePipelineReview } from '../../../../packages/common/fixtures/stage-pipeline-review.js'
import {
    acrSeries, defaultReviewFilters, deriveActions, deriveOpportunities, distinctSorted, emptyMilestoneFilters, filterOpportunityViews,
    formatMoney, inboundCount, matchesScope, milestonesForOpportunities, pollDue, stageCounts, sumConsumed,
    type MilestoneFilters, type ReviewFilters, type ReviewMarks, type ReviewTab
} from './stage-pipeline-analysis.js'
import { AcrChart } from './stage-pipeline-acr-chart.js'
import { ActionsTab, ConsumptionTab, MaccTab } from './stage-pipeline-extra-tabs.js'
import { FilterBar, ScopeToggles } from './stage-pipeline-filters.js'
import { MilestonesTab } from './stage-pipeline-milestones.js'
import { AlertCards, OpportunityKpis, OpportunityTable } from './stage-pipeline-opportunities.js'
import { SourceHealthNotice, ViewScopeControls } from './stage-pipeline-scope.js'
import { dispatchWrite } from './stage-pipeline-dispatch.js'
import { WriteDialog, type WriteAction, type WriteTarget } from './stage-pipeline-write-dialog.js'
import { applySampleMilestoneUpdate, applySampleOpportunityComment, type StagePipelineWrites } from './stage-pipeline-writes.js'
import { loadMarks, saveMarks, toggleMark } from './stage-pipeline-storage.js'

export type InvokeStagePipelineReview = (request: StagePipelineRequest) => Promise<StagePipelineResponse>

const pollIntervalMs = 5 * 60_000

const sampleInvoke: InvokeStagePipelineReview = async () => createSampleStagePipelineReview()

const tabs: ReadonlyArray<{ id: ReviewTab; label: string; glyph: string }> = [
    { id: 'opportunities', label: 'Opportunities', glyph: '◎' },
    { id: 'actions', label: 'Actions', glyph: '◉' },
    { id: 'consumption', label: 'Consumption', glyph: '▥' },
    { id: 'macc', label: 'MACC & Commits', glyph: '▣' },
    { id: 'milestones', label: 'Milestones', glyph: '▦' }
]

export function StagePipelineReviewPane({ invoke = sampleInvoke, writes }: { invoke?: InvokeStagePipelineReview; writes?: StagePipelineWrites }): ReactElement {
    const [snapshot, setSnapshot] = useState<StagePipelineSnapshot | null>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(true)
    const [viewScope, setViewScope] = useState<StagePipelineViewScope>('mine')
    const [reportIds, setReportIds] = useState<string[]>([])
    const [tab, setTab] = useState<ReviewTab>('opportunities')
    const [filters, setFilters] = useState<ReviewFilters>(defaultReviewFilters)
    const [milestoneFilters, setMilestoneFilters] = useState<MilestoneFilters>(emptyMilestoneFilters)
    const [marks, setMarks] = useState<ReviewMarks>(loadMarks)
    const generation = useRef(0)

    useEffect(() => { saveMarks(marks) }, [marks])
    const load = useCallback(async (operation: 'get' | 'refresh' = 'get') => {
        const current = ++generation.current
        setBusy(true)
        setError('')
        const keepPrevious = (previous: StagePipelineSnapshot | null) => previous?.scope === viewScope ? previous : null
        try {
            const response = stagePipelineResponseSchema.parse(await invoke(stagePipelineRequestSchema.parse({
                contractVersion: stagePipelineReviewContractVersion, operation, scope: viewScope,
                ...(viewScope !== 'mine' && reportIds.length > 0 ? { reportIds } : {})
            })))
            if (current !== generation.current) return
            if (response.kind === 'unavailable') { setError(response.message); setSnapshot(keepPrevious) } else setSnapshot(response)
        } catch (cause) {
            if (current !== generation.current) return
            setError(cause instanceof Error && cause.name !== 'ZodError' ? cause.message : 'The dashboard response failed validation. No data was accepted.')
            setSnapshot(keepPrevious)
        } finally {
            if (current === generation.current) setBusy(false)
        }
    }, [invoke, viewScope, reportIds])
    useEffect(() => { void load(); return () => { ++generation.current } }, [load])
    const loadedAt = useRef<number | null>(null)
    const busyRef = useRef(true)
    useEffect(() => { busyRef.current = busy; if (!busy && snapshot) loadedAt.current = Date.now() }, [busy, snapshot])
    useEffect(() => {
        const check = () => {
            if (pollDue({ hidden: document.hidden, busy: busyRef.current, loadedAt: loadedAt.current, now: Date.now(), intervalMs: pollIntervalMs })) void load()
        }
        const timer = window.setInterval(check, 30_000)
        document.addEventListener('visibilitychange', check)
        return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', check) }
    }, [load])
    const [writeTarget, setWriteTarget] = useState<WriteTarget | null>(null)
    const [writeBusy, setWriteBusy] = useState(false)
    const [writeError, setWriteError] = useState('')
    const canWrite = snapshot?.mode === 'sample' || Boolean(writes)
    const today = snapshot?.mode === 'sample' ? snapshot.asOf : new Date().toISOString().slice(0, 10)
    const closeWrite = useCallback(() => { setWriteTarget(null); setWriteError('') }, [])
    const submitWrite = useCallback(async (action: WriteAction) => {
        if (!snapshot) return
        setWriteBusy(true)
        setWriteError('')
        try {
            if (snapshot.mode === 'sample') {
                setSnapshot(action.kind === 'comment' ? applySampleOpportunityComment(snapshot, action.opportunityId, action.comments)
                    : action.kind === 'milestone' ? applySampleMilestoneUpdate(snapshot, action.milestoneId, action.update) : snapshot)
                closeWrite()
            } else if (writes) {
                await dispatchWrite(writes, action)
                closeWrite()
                void load('refresh')
            }
        } catch (cause) {
            setWriteError(cause instanceof Error ? cause.message : 'The change was not saved.')
        } finally {
            setWriteBusy(false)
        }
    }, [snapshot, writes, load, closeWrite])
    const changeScope = useCallback((next: StagePipelineViewScope) => { setReportIds([]); setViewScope(next) }, [])

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
    const macc = snapshot?.sources.find((source) => source.source === 'macc')
    const maccUnavailable = macc?.state === 'unavailable' ? macc.detail : undefined

    const counts: Record<ReviewTab, number> = {
        opportunities: filtered.length,
        actions: actions.length,
        consumption: filtered.filter((view) => view.consumed > 0).length,
        macc: filtered.filter((view) => view.row.maccCommit > 0).length,
        milestones: scopeMilestones.length
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
            <div className="sprv-viewbar">
                <ViewScopeControls scope={viewScope} reports={snapshot?.reports ?? []} selectedIds={reportIds} busy={busy} onScope={changeScope} onSelected={setReportIds} />
                <button type="button" className="sprv-refresh" disabled={busy} onClick={() => void load('refresh')}>{busy ? 'Refreshing…' : 'Refresh'}</button>
            </div>
            {busy && !snapshot && <p className="sprv-muted" role="status">Loading the Stage and Pipeline Review…</p>}
            {error && <div className="sprv-error" role="alert">{error}{snapshot ? ' Showing the last successful data.' : ''} <button type="button" onClick={() => void load()}>Retry</button></div>}
            {snapshot?.state === 'stale' && <div className="sprv-notice" role="status"><strong>Stale snapshot.</strong> {snapshot.message}</div>}
            {snapshot?.mode === 'sample' && <div className="sprv-notice" role="status">{snapshot.message}</div>}
            {snapshot && <SourceHealthNotice sources={snapshot.sources} />}
            {snapshot && <>
                <FilterBar filters={filters} options={options} stageCounts={stageOptionCounts} onChange={setFilters} />
                <DashboardSectionTabs<ReviewTab> label="Stage and Pipeline Review sections" idPrefix="sprv" panelId="sprv-panel"
                    items={tabs.map((item) => ({ ...item, count: counts[item.id] }))} active={tab} onChange={setTab} />
                <div id="sprv-panel" role="tabpanel" aria-labelledby={`sprv-tab-${tab}`}>
                    {tab === 'opportunities' && <>
                        <AlertCards views={withoutAlert} active={filters.alert} onSelect={(alert) => setFilters({ ...filters, alert })} />
                        <OpportunityKpis views={filtered} />
                        <AcrChart points={acr.points} accountCount={acr.accounts} syncedAt={snapshot.acr.syncedAt} source={snapshot.acr.source} />
                        <OpportunityTable views={filtered} marks={marks} onToggle={onToggle} showOwner={snapshot.scope !== 'mine'} {...(canWrite ? { onEdit: (row) => setWriteTarget({ kind: 'comment', opportunity: row }) } : {})} />
                    </>}
                    {tab === 'actions' && <ActionsTab actions={actions} views={filtered} />}
                    {tab === 'consumption' && <ConsumptionTab views={filtered} marks={marks} onToggle={onToggle} />}
                    {tab === 'macc' && <MaccTab views={filtered} marks={marks} onToggle={onToggle} unavailable={maccUnavailable} />}
                    {tab === 'milestones' && <MilestonesTab scopeRows={scopeMilestones} filters={milestoneFilters} onFilters={setMilestoneFilters} asOf={snapshot.asOf} opportunities={opportunityById} {...(canWrite ? { actions: {
                        onUpdate: (row) => { const opportunity = opportunityById.get(row.opportunityId); if (opportunity) setWriteTarget({ kind: 'milestone', milestone: row, opportunity }) },
                        onTask: (row) => { const opportunity = opportunityById.get(row.opportunityId); if (opportunity) setWriteTarget({ kind: 'task', milestone: row, opportunity }) }
                    } } : {})} />}
                </div>
            </>}
            {writeTarget && <WriteDialog target={writeTarget} today={today} busy={writeBusy} error={writeError} onCancel={closeWrite} onSubmit={(action) => void submitWrite(action)} />}
        </div>
    </section>
}
