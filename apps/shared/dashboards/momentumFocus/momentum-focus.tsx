import { useState } from 'react'
import type { MomentumFocusQuery, MomentumSnapshot } from '../../../../packages/common/contracts/momentum-focus.js'
import { DashboardSectionTabs } from '../dashboard-controls.js'
import { MomentumFilters } from './momentum-filters.js'
import { MomentumCharts } from './momentum-charts.js'
import { MomentumCoverage } from './momentum-coverage.js'
import { MomentumPriorityQueue } from './momentum-priority-queue.js'
import { MomentumDetail, type OpenMomentumPortfolio } from './momentum-detail.js'
import { useMomentumFocus, type InvokeMomentumFocus } from './use-momentum-focus.js'
import '../StageAndPipelineReview/stage-pipeline-review.css'
import './momentum-focus.css'

export type { InvokeMomentumFocus } from './use-momentum-focus.js'
export type MomentumSection = 'priorities' | 'traction' | 'milestones' | 'coverage'

export function MomentumFocusPane({ invoke, onOpenPortfolio }: { invoke: InvokeMomentumFocus; onOpenPortfolio?: OpenMomentumPortfolio | undefined }) {
    const state = useMomentumFocus(invoke)
    const [section, setSection] = useState<MomentumSection>('priorities')
    return <section className="review-dashboard momentum-focus" aria-label="Momentum & Focus" aria-busy={state.busy}>
        <div className="sprv-inner momentum-inner">
            <MomentumFocusView snapshot={state.snapshot} query={state.query} section={section} onSectionChange={setSection}
                onQueryChange={state.updateQuery} onSelect={(key) => void state.select(key)} onRefresh={state.refresh} busy={state.busy} />
            {state.error && <p role="alert" className="sprv-error">{state.error}</p>}
        </div>
        {state.detail && <MomentumDetail item={state.detail} onClose={state.closeDetail} onOpenPortfolio={onOpenPortfolio} />}
    </section>
}

export function MomentumFocusView({ snapshot, query, section, onSectionChange, onQueryChange, onSelect, onRefresh, busy }: {
    snapshot: MomentumSnapshot | null
    query: MomentumFocusQuery
    section: MomentumSection
    onSectionChange(section: MomentumSection): void
    onQueryChange(changes: Partial<MomentumFocusQuery>): void
    onSelect(key: string): void
    onRefresh(): void
    busy: boolean
}) {
    const cards: Array<{ title: string; value: number | undefined; lens: MomentumFocusQuery['lens']; tone: string }> = [
        { title: 'Advancing accounts', value: snapshot?.summary.advancingAccounts, lens: 'advancing', tone: 'good' },
        { title: 'Weekly priorities', value: snapshot?.summary.weeklyPriorities, lens: 'weekly', tone: 'brand' },
        { title: 'Monthly milestones', value: snapshot?.summary.monthlyMilestones, lens: 'monthly', tone: 'brand' },
        { title: 'Needs review', value: snapshot?.summary.reviewCandidates, lens: 'review', tone: 'bad' },
        { title: 'Busy without verified movement', value: snapshot?.summary.busyWithoutMovement, lens: 'busy', tone: 'warn' },
        { title: 'Usable history', value: snapshot?.summary.usableHistory, lens: 'history', tone: 'brand' }
    ]
    const sections: Array<{ id: MomentumSection; label: string; count?: number }> = [
        { id: 'priorities', label: 'Priorities', ...(snapshot ? { count: snapshot.total } : {}) },
        { id: 'traction', label: 'Traction & signals', ...(snapshot ? { count: snapshot.charts.matrix.length } : {}) },
        { id: 'milestones', label: 'Milestones & deadlines', ...(snapshot ? { count: snapshot.charts.deadlines.reduce((total, bucket) => total + bucket.milestones, 0) } : {}) },
        { id: 'coverage', label: 'Sources & financials', ...(snapshot ? { count: snapshot.sources.length } : {}) }
    ]
    const showPriorities = (changes: Partial<MomentumFocusQuery>) => {
        onQueryChange(changes)
        onSectionChange('priorities')
        document.getElementById('momentum-tab-priorities')?.focus()
    }
    return <>
        <header className="sprv-header momentum-heading">
            <div><h1>Momentum &amp; Focus</h1>
                <p className="sprv-muted">{query.customerIndustry === 'hls' ? 'HLS Customers only' : 'All authorized customers'} / {snapshot ? `${snapshot.total} filtered records / ${snapshot.mode === 'sample' ? 'SYNTHETIC SAMPLE' : 'live from MSX'} / ${snapshot.generatedAt.slice(0, 10)}` : 'What is moving, what needs attention, and why?'}</p>
            </div>
            <button type="button" className="sprv-refresh" disabled={busy} onClick={onRefresh}>Refresh and capture history</button>
        </header>
        <MomentumFilters query={query} facets={snapshot?.facets} teamAvailable={snapshot?.teamAvailable ?? false} onChange={onQueryChange} />
        <div className="momentum-provenance">
            <span>Focus {snapshot?.focusWindow.from ?? '--'} to {snapshot?.focusWindow.to ?? '--'} ({query.timezone})</span>
            <span>Evidence: {query.lookbackDays} days</span><span>Native currencies / separate value units</span>
            {snapshot && <span title="Filters, role presets, paging and details use this in-memory dataset. Refresh to read source updates.">Loaded snapshot / filters run locally</span>}
            {snapshot && !snapshot.complete && <strong role="status">Partial or capped cohort: totals cover the disclosed collected records.</strong>}
        </div>
        <div className="sprv-kpis momentum-summary">{cards.map((card) => <button type="button"
            className={`sprv-kpi sprv-kpi--${card.tone} momentum-summary-card`} data-momentum-summary={card.lens} key={card.lens}
            disabled={busy || !snapshot} aria-pressed={query.lens === card.lens}
            onClick={() => showPriorities({ lens: query.lens === card.lens ? 'all' : card.lens })}>
            <strong>{card.value ?? '--'}</strong><span>{card.title}</span>
        </button>)}</div>
        <DashboardSectionTabs label="Momentum sections" idPrefix="momentum" panelId="momentum-panel"
            items={sections} active={section} onChange={onSectionChange} />
        <div id="momentum-panel" role="tabpanel" aria-labelledby={`momentum-tab-${section}`}>
            {busy && <p className="sprv-muted" role="status">Loading authorized Momentum sources...</p>}
            {snapshot && <>
                {section === 'priorities' && <MomentumPriorityQueue snapshot={snapshot} query={query} busy={busy} onChange={onQueryChange} onSelect={onSelect} />}
                {(section === 'traction' || section === 'milestones') && <MomentumCharts snapshot={snapshot} query={query} section={section} onChange={onQueryChange} onFilter={showPriorities} />}
                {section === 'coverage' && <MomentumCoverage snapshot={snapshot} />}
            </>}
        </div>
    </>
}
