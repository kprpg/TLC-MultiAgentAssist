import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createSampleStagePipelineReview } from '../../../packages/common/fixtures/stage-pipeline-review.js'
import { deriveAcrPipe } from '../../../packages/connectors/msx/stage-pipeline-mapping.js'
import {
    acrCoverage, acrSeries, defaultReviewFilters, deriveOpportunities, filterOpportunityViews, milestoneCsv, opportunityCsv, pollDue
} from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-analysis.js'
import { AcrChart } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-acr-chart.js'
import { SourceHealthNotice, ViewScopeControls } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-scope.js'
import { MaccTab } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-extra-tabs.js'
import { OpportunityTable } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-opportunities.js'
import { emptyMarks } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-storage.js'

const sample = createSampleStagePipelineReview()
const derived = () => deriveAcrPipe({
    fiscalYear: 2027,
    opportunities: sample.opportunities.map((row) => ({ id: row.id, customer: row.customer, stage: row.stage, status: row.status })),
    milestones: sample.milestones
})

describe('Stage and Pipeline Review with an unconnected ACR source', () => {
    it('keeps pipeline layers and reports no actuals, baseline or target instead of zeros', () => {
        const series = acrSeries(derived(), '')
        expect(series.connected).toBe(false)
        expect(series.points).toHaveLength(12)
        expect(series.points.every((point) => point.actual === null && point.baseline === null && point.target === null)).toBe(true)
        expect(series.points.at(-1)!.committed + series.points.at(-1)!.uncommitted + series.points.at(-1)!.stage1).toBeGreaterThan(0)
        expect(acrCoverage(series.points)).toBeNull()
        expect(acrSeries(sample.acr, '').connected).toBe(true)
    })

    it('renders an explicit not-connected note without actual, baseline or target marks', () => {
        const series = acrSeries(derived(), '')
        const markup = renderToStaticMarkup(createElement(AcrChart, { points: series.points, accountCount: series.accounts, syncedAt: null, source: 'derived-pipeline-only' }))
        expect(markup).toContain('not connected')
        expect(markup).not.toContain('Actuals YTD')
        expect(markup).not.toContain('ACR Target')
        expect(markup).not.toContain('sprv-target-line')
        expect(markup).toContain('Committed Pipe')
    })

    it('keeps the full chart for a connected source', () => {
        const series = acrSeries(sample.acr, '')
        const markup = renderToStaticMarkup(createElement(AcrChart, { points: series.points, accountCount: series.accounts, syncedAt: sample.acr.syncedAt, source: 'sample' }))
        expect(markup).toContain('Actuals YTD')
        expect(markup).toContain('ACR Target')
        expect(markup).not.toContain('not connected')
    })
})

describe('Stage and Pipeline Review scope and source health', () => {
    const reports = [{ id: 'r1', displayName: 'Report One' }, { id: 'r2', displayName: 'Report Two' }]

    it('offers the three portfolio scopes and checks the active one', () => {
        const markup = renderToStaticMarkup(createElement(ViewScopeControls, { scope: 'mine', reports: [], selectedIds: [], busy: false, onScope: vi.fn(), onSelected: vi.fn() }))
        expect(markup).toContain('aria-label="Portfolio scope"')
        for (const label of ['My portfolio', 'My direct reports', 'Both']) expect(markup).toContain(label)
        expect(markup).toMatch(/<input type="radio"[^>]*checked=""[^>]*\/><span[^>]*>[^<]*<\/span>My portfolio/)
        expect(markup).not.toContain('Direct reports in view')
    })

    it('lists direct reports with a selection summary when a manager scope is active', () => {
        const markup = renderToStaticMarkup(createElement(ViewScopeControls, { scope: 'both', reports, selectedIds: ['r1'], busy: false, onScope: vi.fn(), onSelected: vi.fn() }))
        expect(markup).toContain('Direct reports in view')
        expect(markup).toContain('Report One')
        expect(markup).toContain('Report Two')
        expect(markup).toContain('Viewing 1 of 2 direct reports')
    })

    it('tells a manager with no direct reports why the view is empty', () => {
        const markup = renderToStaticMarkup(createElement(ViewScopeControls, { scope: 'reports', reports: [], selectedIds: [], busy: false, onScope: vi.fn(), onSelected: vi.fn() }))
        expect(markup).toContain('No direct reports were found')
    })

    it('surfaces only partial and unavailable sources and stays silent when everything is complete', () => {
        expect(renderToStaticMarkup(createElement(SourceHealthNotice, { sources: sample.sources }))).toBe('')
        const markup = renderToStaticMarkup(createElement(SourceHealthNotice, { sources: [
            { source: 'opportunities', state: 'partial', detail: '2 direct report portfolios were not fully readable.', count: 10 },
            { source: 'acr', state: 'unavailable', detail: 'Monthly ACR is not connected.' },
            { source: 'milestones', state: 'complete', detail: 'All good.' }
        ] }))
        expect(markup).toContain('Partial')
        expect(markup).toContain('Unavailable')
        expect(markup).toContain('2 direct report portfolios were not fully readable.')
        expect(markup).not.toContain('All good.')
    })
})

describe('Stage and Pipeline Review CSV export in manager scopes', () => {
    it('adds an Owner column to both exports only when the view includes direct reports', () => {
        const manager = createSampleStagePipelineReview({ scope: 'both' })
        const views = deriveOpportunities(manager)
        const parents = new Map(manager.opportunities.map((row) => [row.id, row]))
        const plain = opportunityCsv(views.slice(0, 2)).split('\r\n')[0]!
        expect(plain).not.toContain('Owner')
        const withOwner = opportunityCsv(views.filter((view) => !view.row.editable).slice(0, 2), { includeOwner: true }).split('\r\n')
        expect(withOwner[0]).toBe('Customer,Owner,Opportunity,Number,Stage,Forecast,Close,Days to close,Consumed,Idle days,Partner,Competitor,Threat')
        expect(withOwner[1]).toContain('Sample Report')
        expect(milestoneCsv(manager.milestones.slice(0, 1), parents).split('\r\n')[0]).toContain('Owner')
    })
})

describe('Stage and Pipeline Review background refresh', () => {
    const base = { hidden: false, busy: false, loadedAt: 1_000, now: 1_000 + 300_000, intervalMs: 300_000 }
    it('polls only when visible, idle, previously loaded and older than the interval', () => {
        expect(pollDue(base)).toBe(true)
        expect(pollDue({ ...base, now: 1_000 + 299_999 })).toBe(false)
        expect(pollDue({ ...base, hidden: true })).toBe(false)
        expect(pollDue({ ...base, busy: true })).toBe(false)
        expect(pollDue({ ...base, loadedAt: null })).toBe(false)
    })
})

describe('Stage and Pipeline Review manager columns and MACC', () => {
    it('shows an Owner column and lets search match the owner only in manager scopes', () => {
        const manager = createSampleStagePipelineReview({ scope: 'both' })
        const views = deriveOpportunities(manager)
        const filters = { ...defaultReviewFilters(), source: 'all' as const, scope: 'all' as const, search: 'sample report b' }
        const found = filterOpportunityViews(views, filters, emptyMarks)
        expect(found.length).toBeGreaterThan(0)
        expect(found.every((view) => view.row.owner === 'Sample Report B')).toBe(true)
        const withOwner = renderToStaticMarkup(createElement(OpportunityTable, { views: found, marks: emptyMarks, onToggle: vi.fn(), showOwner: true }))
        const without = renderToStaticMarkup(createElement(OpportunityTable, { views: found, marks: emptyMarks, onToggle: vi.fn(), showOwner: false }))
        expect(withOwner).toContain('>Owner<')
        expect(without).not.toContain('>Owner<')
    })

    it('explains an unavailable MACC source instead of rendering an empty table', () => {
        const markup = renderToStaticMarkup(createElement(MaccTab, { views: [], marks: emptyMarks, onToggle: vi.fn(), unavailable: 'MACC is account-level in Dataverse.' }))
        expect(markup).toContain('MACC is account-level in Dataverse.')
        expect(markup).not.toContain('aria-label="MACC and commits"')
    })
})
