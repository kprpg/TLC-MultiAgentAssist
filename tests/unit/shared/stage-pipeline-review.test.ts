import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createSampleStagePipelineReview } from '../../../packages/common/fixtures/stage-pipeline-review.js'
import {
    acrCoverage, acrSeries, activeFilterChips, alertSummary, clearFilterChip, csvCell, defaultReviewFilters, deriveActions,
    deriveOpportunities, filterMilestoneRows, filterOpportunityViews, fiscalQuarterOf, inboundCount, milestoneCsv, milestoneKpis,
    milestoneStatusCounts, milestonesForOpportunities, msxRecordUrl, opportunityCsv, stageCounts, withScope,
    emptyMilestoneFilters, type ReviewMarks
} from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-analysis.js'
import { StagePipelineReviewPane } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-review.js'
import { DashboardWorkspace } from '../../../apps/shared/dashboards/dashboard-workspace.js'

const snapshot = createSampleStagePipelineReview()
const views = deriveOpportunities(snapshot)
const noMarks: ReviewMarks = { focus: new Set(), reviewed: new Set() }

describe('Stage and Pipeline Review analysis', () => {
    it('uses Microsoft fiscal quarters', () => {
        expect(fiscalQuarterOf('2026-07-01')).toBe('FY27 Q1')
        expect(fiscalQuarterOf('2026-10-21')).toBe('FY27 Q2')
        expect(fiscalQuarterOf('2027-03-31')).toBe('FY27 Q3')
        expect(fiscalQuarterOf('2027-06-30')).toBe('FY27 Q4')
    })

    it('defaults to Azure only, excluding inbound, with a removable solution/source chip pair', () => {
        const filters = defaultReviewFilters()
        const rows = filterOpportunityViews(views, filters, noMarks)
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every((view) => view.row.scope === 'azure' && !view.row.inbound && view.row.solutionArea === 'Cloud and AI Platforms')).toBe(true)
        expect(activeFilterChips(filters).map((chip) => `${chip.label}: ${chip.value}`)).toEqual(['Solution: Cloud and AI Platforms', 'Opportunity: Excluding Inbound'])
        expect(clearFilterChip(filters, 'source').source).toBe('all')
        expect(clearFilterChip(filters, 'solution').solution).toBe('')
    })

    it('switches scope and solution together and counts inbound within the scope', () => {
        const services = withScope(defaultReviewFilters(), 'microsoft-services')
        expect(services.solution).toBe('Microsoft Services')
        expect(filterOpportunityViews(views, services, noMarks).every((view) => view.row.scope === 'microsoft-services')).toBe(true)
        const all = withScope({ ...defaultReviewFilters(), source: 'all' }, 'all')
        expect(filterOpportunityViews(views, all, noMarks)).toHaveLength(views.length)
        expect(inboundCount(views, 'azure')).toBe(views.filter((view) => view.row.scope === 'azure' && view.row.inbound).length)
        expect(inboundCount(views, 'all')).toBeGreaterThan(0)
    })

    it('applies stage, customer, forecast, quarter, partner, search, focus and reviewed filters', () => {
        const base = { ...defaultReviewFilters(), source: 'all' as const, solution: '' }
        const some = filterOpportunityViews(views, base, noMarks)
        const stages = filterOpportunityViews(views, { ...base, stages: ['Inspire & Design', 'Empower & Achieve'] }, noMarks)
        expect(stages.length).toBeGreaterThan(0)
        expect(stages.every((view) => ['Inspire & Design', 'Empower & Achieve'].includes(view.row.stage))).toBe(true)

        const customer = some[0]?.row.customer ?? ''
        expect(filterOpportunityViews(views, { ...base, customer }, noMarks).every((view) => view.row.customer === customer)).toBe(true)
        expect(filterOpportunityViews(views, { ...base, forecast: 'Committed' }, noMarks).every((view) => view.row.forecast === 'Committed')).toBe(true)
        expect(filterOpportunityViews(views, { ...base, quarter: 'FY27 Q2' }, noMarks).every((view) => view.quarter === 'FY27 Q2')).toBe(true)
        const partner = some.find((view) => view.row.partner)?.row.partner ?? ''
        expect(filterOpportunityViews(views, { ...base, partner }, noMarks).every((view) => view.row.partner === partner)).toBe(true)
        expect(filterOpportunityViews(views, { ...base, search: 'DATABRICKS' }, noMarks).every((view) => /databricks/i.test(JSON.stringify(view.row)))).toBe(true)
        expect(filterOpportunityViews(views, { ...base, search: 'zzzz-no-match' }, noMarks)).toHaveLength(0)

        const first = some[0]?.row.id ?? ''
        const marks: ReviewMarks = { focus: new Set([first]), reviewed: new Set([first]) }
        expect(filterOpportunityViews(views, { ...base, focusOnly: true }, marks).map((view) => view.row.id)).toEqual([first])
        expect(filterOpportunityViews(views, { ...base, hideReviewed: true }, marks).some((view) => view.row.id === first)).toBe(false)
    })

    it('counts stages without applying the stage filter itself', () => {
        const filters = { ...defaultReviewFilters(), stages: ['Realize Value' as const] }
        const counts = stageCounts(views, filters, noMarks)
        expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(filterOpportunityViews(views, filters, noMarks, ['stages']).length)
    })

    it('derives alert cards consistently with the alert filter', () => {
        const base = filterOpportunityViews(views, { ...defaultReviewFilters(), source: 'all' }, noMarks, ['alert'])
        const summary = alertSummary(base)
        expect(summary.overdue.count).toBeGreaterThan(0)
        for (const key of ['overdue', 'closing90', 'at-risk-commit', 'non-azure', 'competitive'] as const) {
            expect(filterOpportunityViews(views, { ...defaultReviewFilters(), source: 'all', alert: key }, noMarks)).toHaveLength(summary[key].count)
        }
        const overdue = base.filter((view) => view.alerts.has('overdue'))
        expect(overdue.every((view) => view.overdueDays > 0 && view.open)).toBe(true)
        expect(base.filter((view) => view.alerts.has('closing90')).every((view) => view.daysToClose >= 0 && view.daysToClose <= 90)).toBe(true)
        expect(deriveActions(base).filter((action) => action.priority === 'High').length).toBeGreaterThan(0)
    })

    it('builds cumulative ACR layers, coverage chips and follows only the customer filter', () => {
        const all = acrSeries(snapshot.acr, '')
        expect(all.accounts).toBe(5)
        expect(all.points).toHaveLength(12)
        expect(all.points[0]?.label).toBe('FY27-Jul')
        expect(all.points.find((point) => point.lastActual)?.month).toBe('2026-09')
        const coverage = acrCoverage(all.points)
        expect(coverage?.target).toBeGreaterThan(0)
        expect(coverage?.ahead).toBe((coverage?.all ?? 0) - (coverage?.target ?? 0))
        expect(coverage?.basePct).toBeLessThan(coverage?.committedPct ?? 0 + 1)
        const one = acrSeries(snapshot.acr, snapshot.acr.accounts[0]?.customer ?? '')
        expect(one.accounts).toBe(1)
        expect((one.points.at(-1)?.target ?? 0)).toBeLessThan(all.points.at(-1)?.target ?? 0)
    })

    it('filters and summarises milestones for the scoped opportunities', () => {
        const scoped = filterOpportunityViews(views, defaultReviewFilters(), noMarks)
        const rows = milestonesForOpportunities(snapshot, new Set(scoped.map((view) => view.row.id)))
        expect(rows.length).toBeGreaterThan(0)
        const counts = milestoneStatusCounts(rows)
        expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(rows.length)
        const open = filterMilestoneRows(rows, { ...emptyMilestoneFilters, openOnly: true }, snapshot.asOf)
        expect(open.every((row) => ['On Track', 'At Risk', 'Blocked'].includes(row.status))).toBe(true)
        const overdue = filterMilestoneRows(rows, { ...emptyMilestoneFilters, overdueOnly: true }, snapshot.asOf)
        expect(overdue).toHaveLength(milestoneKpis(rows, snapshot.asOf).pastDue)
        expect(filterMilestoneRows(rows, { ...emptyMilestoneFilters, statuses: ['Completed'] }, snapshot.asOf).every((row) => row.status === 'Completed')).toBe(true)
        expect(filterMilestoneRows(rows, { ...emptyMilestoneFilters, commitment: 'Committed' }, snapshot.asOf).every((row) => row.commitment === 'Committed')).toBe(true)
    })

    it('exports CSV with escaping and a spreadsheet formula guard', () => {
        expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
        expect(csvCell('+1')).toBe("'+1")
        expect(csvCell('a,b')).toBe('"a,b"')
        expect(csvCell(-371)).toBe('-371')
        expect(csvCell(null)).toBe('')
        const csv = opportunityCsv(views.slice(0, 3))
        expect(csv.split('\r\n')).toHaveLength(4)
        const parents = new Map(snapshot.opportunities.map((row) => [row.id, row]))
        expect(milestoneCsv(snapshot.milestones.slice(0, 2), parents).split('\r\n')).toHaveLength(3)
    })

    it('builds only HTTPS MSX record links', () => {
        const url = new URL(msxRecordUrl('msp_engagementmilestone', 'abc&x=1'))
        expect(url.protocol).toBe('https:')
        expect(url.searchParams.get('id')).toBe('abc&x=1')
        expect(url.searchParams.get('etn')).toBe('msp_engagementmilestone')
    })
})

describe('Stage and Pipeline Review rendering', () => {
    it('registers a Stage and Pipeline Review child tab under the Dashboards workspace', () => {
        const markup = renderToStaticMarkup(createElement(DashboardWorkspace, { invokeSellerDashboard: vi.fn(), invokeSeReporting: vi.fn() }))
        expect(markup.match(/role="tab"/g)).toHaveLength(4)
        expect(markup).toContain('>Stage and Pipeline Review<')
        expect(markup).toContain('aria-label="Seller Dashboard"')
    })

    it('renders the loading state without invoking a host when mounted statically', () => {
        const markup = renderToStaticMarkup(createElement(StagePipelineReviewPane))
        expect(markup).toContain('aria-label="Stage and Pipeline Review"')
        expect(markup).toContain('<h1>Stage and Pipeline Review</h1>')
        expect(markup).toContain('Loading the Stage and Pipeline Review')
    })
})
