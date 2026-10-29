import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MomentumFocusPane, MomentumFocusView } from '../../../apps/shared/dashboards/momentumFocus/momentum-focus.js'
import { MomentumDetail } from '../../../apps/shared/dashboards/momentumFocus/momentum-detail.js'
import { DashboardWorkspace } from '../../../apps/shared/dashboards/dashboard-workspace.js'
import { buildMomentumSnapshot } from '../../../packages/orchestrator/momentum-focus/analytics.js'
import { createMomentumFixture, momentumSampleNow } from '../../../packages/common/fixtures/momentum-focus.js'
import { momentumFocusQuerySchema } from '../../../packages/common/contracts/momentum-focus.js'

describe('shared Momentum presentation (MF-006, MF-007, MF-008, MF-010)', () => {
    const snapshot = () => buildMomentumSnapshot(createMomentumFixture(), momentumFocusQuerySchema.parse({}), new Date(momentumSampleNow))
    it('does not read any sources on render and keeps the existing dashboard default unchanged', () => {
        const invoke = vi.fn()
        const html = renderToStaticMarkup(createElement(DashboardWorkspace, {
            invokeSellerDashboard: invoke, invokeSeReporting: invoke, invokeStagePipelineReview: invoke, invokeMomentumFocus: invoke
        }))
        expect(html).toContain('Momentum &amp; Focus')
        expect(html).toContain('id="dashboard-tab-seller-dashboard"')
        expect(html).not.toContain('aria-label="Momentum priority queue"')
        expect(invoke).not.toHaveBeenCalled()
        expect(renderToStaticMarkup(createElement(MomentumFocusPane, { invoke }))).toContain('Momentum &amp; Focus')
        expect(invoke).not.toHaveBeenCalled()
    })
    const renderSection = (section: 'priorities' | 'traction' | 'milestones' | 'coverage') => {
        const report = snapshot()
        return renderToStaticMarkup(createElement(MomentumFocusView, {
            snapshot: report, query: report.query, section, onSectionChange: vi.fn(),
            onQueryChange: vi.fn(), onSelect: vi.fn(), onRefresh: vi.fn(), busy: false
        }))
    }
    it('uses the Stage-style review shell and four sections without fetching data during render', () => {
        const invoke = vi.fn()
        const html = renderToStaticMarkup(createElement(MomentumFocusPane, { invoke }))
        expect(html.includes('review-dashboard momentum-focus')).toBe(true)
        expect(html.includes('sprv-inner')).toBe(true)
        expect(html.includes('aria-label="Momentum sections"')).toBe(true)
        expect(html.match(/role="tab"/g)).toHaveLength(4)
        expect(invoke).not.toHaveBeenCalled()
    })
    it('prioritizes a compact queue, independent clocks and six clickable KPI cards', () => {
        const html = renderSection('priorities')
        for (const name of ['Customer industry', 'HLS Customers only', 'Focus horizon', 'Evidence lookback',
            'Momentum priority queue', 'Clear selection', 'Verify information', 'Recorded date', 'Value', 'Evidence', 'Next step']) {
            expect(html.includes(name)).toBe(true)
        }
        expect(html.match(/data-momentum-summary=/g)).toHaveLength(6)
        expect(html.includes('momentum-entity-link')).toBe(true)
        expect(html.includes('sprv-table')).toBe(true)
        expect(html.includes('SYNTHETIC SAMPLE')).toBe(true)
        expect(html.includes('id="momentum-tab-priorities"')).toBe(true)
        expect(html.includes('aria-labelledby="momentum-tab-priorities"')).toBe(true)
        expect(html.includes('id="momentum-matrix-title"')).toBe(false)
        expect(html.includes('Separate financial groups')).toBe(false)
    })
    it('keeps traction, milestone context and source/financial details in focused sections', () => {
        const traction = renderSection('traction')
        for (const name of ['Progress versus signals', 'Top Accounts', 'Progress and signals table', 'Insufficient-history records', 'View all insufficient-history records']) {
            expect(traction.includes(name)).toBe(true)
        }
        expect(traction.includes('aria-label="Momentum priority queue"')).toBe(false)
        expect(traction.includes('id="momentum-heatmap-title"')).toBe(false)
        const milestones = renderSection('milestones')
        for (const name of ['Stage by milestone status', 'Deadline distribution', 'Deadline distribution table', 'aria-label="overdue opportunity count"', 'aria-label="overdue milestone count"']) {
            expect(milestones.includes(name)).toBe(true)
        }
        expect(milestones.includes('id="momentum-matrix-title"')).toBe(false)
        const coverage = renderSection('coverage')
        for (const name of ['Source coverage table', 'Separate financial groups', 'Financial groups table', 'Pipeline value', 'monthly rate', 'not continuous monitoring']) {
            expect(coverage.includes(name)).toBe(true)
        }
        expect(coverage.includes('aria-label="Momentum priority queue"')).toBe(false)
        expect(coverage.includes('87/100')).toBe(false)
    })
    it('keeps suggested review dates distinct from CRM deadlines and discloses history/source coverage', () => {
        const report = snapshot()
        const html = renderToStaticMarkup(createElement(MomentumDetail, { item: report.rows.find((row) => row.id === 'unknown')!, onClose: vi.fn() }))
        expect(html).toContain('Suggested review')
        expect(html).toContain('Recorded deadline')
        expect(html).toContain('Unknown')
        expect(html).toContain('History available since')
        expect(html).toContain('not continuous monitoring')
    })
    it('escapes untrusted labels and never renders source text as executable HTML', () => {
        const report = snapshot()
        report.rows[0]!.name = '<script>alert(1)</script>'
        const html = renderToStaticMarkup(createElement(MomentumDetail, { item: report.rows[0]!, onClose: vi.fn() }))
        expect(html).toContain('&lt;script&gt;')
        expect(html).not.toContain('<script>')
    })
})
