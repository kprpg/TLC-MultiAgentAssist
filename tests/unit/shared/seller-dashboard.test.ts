import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createSampleSellerDashboard } from '../../../packages/common/fixtures/seller-dashboard.js'
import {
    defaultSellerDashboardFilters, emptySellerDashboardFilters, filterSellerDashboard,
    sellerAccountGaps, sellerCommitment, sellerFiscalQuarters, sellerIllustrativeCredit,
    sellerMetricScenario, sellerPipelineSummary, sellerRatio
} from '../../../apps/shared/seller-dashboard-analysis.js'
import { SellerDashboardOverview, SellerDashboardSectionContent } from '../../../apps/shared/seller-dashboard-sections.js'
import { SellerDashboardTable } from '../../../apps/shared/seller-dashboard-table.js'

describe('Seller Dashboard analysis and rendering', () => {
    it('uses Microsoft fiscal boundaries and defaults to the source as-of quarter', () => {
        const { report } = createSampleSellerDashboard()
        expect(defaultSellerDashboardFilters(report).quarter).toBe('q2')
        expect(sellerFiscalQuarters(2027)).toMatchObject([
            { start: '2026-07-01', end: '2026-09-30' },
            { start: '2026-10-01', end: '2026-12-31' },
            { start: '2027-01-01', end: '2027-03-31' },
            { start: '2027-04-01', end: '2027-06-30' }
        ])
    })

    it('nets signed account actuals before clamping rather than summing clamped gaps', () => {
        const snapshot = createSampleSellerDashboard()
        const [first, second] = snapshot.report.accounts
        const metric = snapshot.report.official.metrics[0]!
        if (!first || !second) throw new Error('Missing synthetic accounts.')
        const accounts = [first, second].map((row, index) => ({
            ...row, metrics: [{ metric: metric.name, bucket: metric.bucket, quota: 10, actual: index === 0 ? 15 : 2, gap: index === 0 ? 0 : 8, variance: index === 0 ? 5 : -8 }]
        }))
        expect(sellerAccountGaps({ accounts, metrics: [metric] })).toEqual([
            { bucket: metric.bucket, quota: 20, actual: 17, gap: 3 }
        ])
        accounts[1]!.metrics[0]!.actual = -2
        expect(sellerAccountGaps({ accounts, metrics: [metric] })[0]?.gap).toBe(7)
    })

    it('keeps unknown actuals, zero denominator ratios and unknown commitment unknown', () => {
        const snapshot = createSampleSellerDashboard()
        const view = filterSellerDashboard(snapshot.report, { ...emptySellerDashboardFilters, account: '1000005' })
        expect(sellerAccountGaps(view).find((row) => row.bucket === 'Strategic workloads')?.gap).toBeNull()
        expect(sellerRatio(100, 0)).toBeNull()
        expect(sellerCommitment('Not committed')).toBe('uncommitted')
        expect(sellerCommitment('Best case')).toBe('unknown')
        expect(sellerCommitment('uncommitted forecast')).toBe('unknown')
    })

    it('filters account, metric, search and pipeline timing without changing official cards', () => {
        const snapshot = createSampleSellerDashboard()
        const before = structuredClone(snapshot.report.official)
        const view = filterSellerDashboard(snapshot.report, {
            ...emptySellerDashboardFilters, account: '1000001', metric: 'ACR - Core', search: 'AVERY', state: 'committed'
        })
        expect(view.accounts.map((row) => row.name)).toEqual(['Contoso Energy'])
        expect(view.milestones.every((row) => row.owner === 'Avery Johnson' && row.commitment === 'Committed')).toBe(true)
        expect(snapshot.report.official).toEqual(before)
        const future = filterSellerDashboard(snapshot.report, { ...emptySellerDashboardFilters, state: 'future' })
        expect(future.opportunities.map((row) => row.name)).toContain('AI-assisted care planning')
    })

    it('does not label partial access zero pipeline and includes won-parent active consumption without nominal won value', () => {
        const snapshot = createSampleSellerDashboard()
        const all = filterSellerDashboard(snapshot.report, emptySellerDashboardFilters)
        const summary = sellerPipelineSummary(all, snapshot.report.period.today, snapshot.report.period.end)
        expect(summary.qualifiedNominal).toBe(10_420_000)
        expect(summary.committedMonthly).toBe(111_000)
        const absent = filterSellerDashboard(snapshot.report, { ...emptySellerDashboardFilters, state: 'no-pipeline' })
        expect(absent.accounts.map((row) => row.tpid)).toEqual(['1000005'])
        snapshot.report.accounts.at(-1)!.pipeline.status = 'partial'
        snapshot.report.accounts.at(-1)!.pipeline.noPipeline = false
        expect(filterSellerDashboard(snapshot.report, { ...emptySellerDashboardFilters, state: 'no-pipeline' }).accounts).toHaveLength(0)
    })

    it('prorates flat hypothetical credit by inclusive calendar days including leap years', () => {
        expect(sellerIllustrativeCredit(3100, '2026-10-16', '2026-10-31')).toBe(1600)
        expect(sellerIllustrativeCredit(3100, '2026-11-01', '2026-12-31')).toBe(6200)
        expect(sellerIllustrativeCredit(2900, '2028-02-29', '2028-02-29')).toBe(100)
        expect(sellerIllustrativeCredit(3100, '2026-10-31', '2026-11-01')).toBeCloseTo(203.333333, 5)
        expect(sellerIllustrativeCredit(0, '2026-10-01', '2026-10-31')).toBeNull()
        expect(sellerIllustrativeCredit(Infinity, '2026-10-01', '2026-10-31')).toBeNull()
    })

    it.each([
        { label: 'committed milestones', state: 'committed', search: '', committed: 92_774.1935483871, uncommitted: 0 },
        { label: 'uncommitted milestones', state: 'uncommitted', search: '', committed: 0, uncommitted: 51_096.7741935484 },
        { label: 'record-level search', state: '', search: 'Azure production rollout', committed: 84_000, uncommitted: 0 },
        { label: 'overdue milestones', state: 'overdue', search: '', committed: 0, uncommitted: 0 },
        { label: 'unmatched search', state: '', search: 'No matching synthetic milestone', committed: 0, uncommitted: 0 }
    ])('limits scenario credit to the working view for $label', ({ state, search, committed, uncommitted }) => {
        const { report } = createSampleSellerDashboard()
        const official = structuredClone(report.official)
        const view = filterSellerDashboard(report, { ...defaultSellerDashboardFilters(report), state, search })
        const metric = report.official.metrics.find((row) => row.name === 'ACR - Core')
        if (!metric) throw new Error('Missing synthetic core metric.')

        const result = sellerMetricScenario(report, view, metric)

        expect(result.committed).toBeCloseTo(committed, 5)
        expect(result.uncommitted).toBeCloseTo(uncommitted, 5)
        expect(result.remaining).toBeCloseTo(Math.max(metric.gap - committed - uncommitted, 0), 5)
        expect(report.official).toEqual(official)
    })

    it('keeps scenario unsupported when commitment, mapping or retrieval is uncertain', () => {
        const snapshot = createSampleSellerDashboard()
        const view = filterSellerDashboard(snapshot.report, defaultSellerDashboardFilters(snapshot.report))
        const core = view.metrics[0]!
        expect(sellerMetricScenario(snapshot.report, view, core).committed).toBeGreaterThan(0)
        snapshot.report.milestones[0]!.commitment = 'Best case'
        expect(sellerMetricScenario(snapshot.report, view, core).remaining).toBeNull()
        snapshot.report.milestones[0]!.commitment = 'Committed'
        snapshot.report.sources.pipeline.status = 'partial'
        expect(sellerMetricScenario(snapshot.report, view, core).remaining).toBeNull()
    })

    it('renders all four sections with evidence, fixed attainment and no unsafe HTML or export controls', () => {
        const snapshot = createSampleSellerDashboard()
        const view = filterSellerDashboard(snapshot.report, defaultSellerDashboardFilters(snapshot.report))
        const overview = renderToStaticMarkup(createElement(SellerDashboardOverview, { snapshot }))
        expect(overview).toContain('78%')
        expect(overview).toContain('Synthetic sample')
        expect(overview).toContain('Closed-month adjusted comparison')
        const titles = {
            pipeline: 'Pipeline coverage snapshot', earnings: 'Official metric reconciliation',
            consumption: 'Customer consumption &amp; growth', conversion: 'Uncommitted to committed progress'
        } as const
        for (const section of ['pipeline', 'earnings', 'consumption', 'conversion'] as const) {
            const markup = renderToStaticMarkup(createElement(SellerDashboardSectionContent, {
                section, snapshot, view, scenario: false, onScenarioChange: vi.fn()
            }))
            expect(markup).toContain(titles[section])
            expect(markup).not.toContain('download=')
            expect(markup).not.toContain('dangerouslySetInnerHTML')
        }
        snapshot.report.opportunities[0]!.name = '<script>alert("not-executable")</script>'
        snapshot.report.milestones[0]!.opportunityName = '<script>alert("not-executable")</script>'
        snapshot.report.milestones[0]!.commitment = 'Uncommitted'
        const unsafeView = filterSellerDashboard(snapshot.report, emptySellerDashboardFilters)
        const markup = renderToStaticMarkup(createElement(SellerDashboardSectionContent, {
            section: 'pipeline', snapshot, view: unsafeView, scenario: false, onScenarioChange: vi.fn()
        }))
        expect(markup).toContain('&lt;script&gt;')
        expect(markup).not.toContain('<script>')
    })

    it('renders missing live consumption/U2C as unavailable, not zero history', () => {
        const snapshot = createSampleSellerDashboard()
        snapshot.mode = 'live'
        snapshot.supplement = null
        const view = filterSellerDashboard(snapshot.report, emptySellerDashboardFilters)
        for (const section of ['consumption', 'conversion'] as const) {
            const markup = renderToStaticMarkup(createElement(SellerDashboardSectionContent, {
                section, snapshot, view, scenario: false, onScenarioChange: vi.fn()
            }))
            expect(markup).toContain('Source unavailable')
            expect(markup).toContain('Unknown is not zero')
        }
    })

    it('bounds table display without changing complete record counts', () => {
        const rows = Array.from({ length: 40 }, (_, id) => ({ id, amount: id * 100 }))
        const markup = renderToStaticMarkup(createElement(SellerDashboardTable<{ id: number; amount: number }>, {
            caption: 'Synthetic inventory', rows, rowKey: (row) => String(row.id),
            columns: [{ key: 'amount', label: 'Amount', value: (row) => row.amount, numeric: true }]
        }))
        expect(markup).toContain('of 40 records')
        expect(markup).toContain('totals include all matching records')
        expect(markup).toContain('Next page of Synthetic inventory')
        expect(markup.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g)).toHaveLength(15)
    })
})
