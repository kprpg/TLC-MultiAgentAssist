import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createSeReportingFixture } from '../../../packages/common/fixtures/se-reporting.js'
import { buildSeReports, consolidateSeReports } from '../../../packages/orchestrator/se-reporting/model.js'
import { renderSeReportHtml } from '../../../packages/documents/se-reporting.js'
import { SeReportingDashboardPane } from '../../../apps/shared/dashboards/soltionEngineerDashboard/se-reporting-dashboard.js'

describe('SE monthly report presentation', () => {
    it('renders exactly five KPI tiles and one collapsed Secondary view in contract order', () => {
        const report = buildSeReports(createSeReportingFixture())[0]!
        const html = renderSeReportHtml(report)
        expect(html.match(/class="kpi"/g)).toHaveLength(5)
        expect(html.match(/<details class="secondary-view">/g)).toHaveLength(1)
        expect(html).not.toContain('<details class="secondary-view" open')
        const headings = ['Executive Summary', 'Priority Initiatives', 'FY27 Milestone Inventory', 'Asks for Morgan Sample', 'See more', 'Customer Updates']
        for (let index = 1; index < headings.length; index++) expect(html.indexOf(headings[index]!)).toBeGreaterThan(html.indexOf(headings[index - 1]!))
        expect(html).toContain("script-src 'none'")
        expect(html).toContain('@media print')
        expect(html.match(/type="radio" name="customer-status"/g)).toHaveLength(5)
        expect(html).not.toContain('Personal Reflection')
        expect(html).not.toContain('1:1 Talking Points')
        expect(html).not.toContain('Synthetic assignments')
    })

    it('uses the same canonical numbers in preview/export and never adds inventory total rows', () => {
        const reports = buildSeReports(createSeReportingFixture())
        const summary = consolidateSeReports(reports)
        const html = renderSeReportHtml(summary)
        expect(html).toContain('<th scope="col">ATU</th>')
        expect(html).toContain('Current milestone status as of 2026-10-20')
        expect(html).not.toContain('<tfoot')
        expect(html).toContain('No asks provided by the reporter.')
    })

    it('scales preview typography without changing exported typography, spacing or report data', () => {
        const report = buildSeReports(createSeReportingFixture())[0]!
        const exported = renderSeReportHtml(report)
        const preview = renderSeReportHtml(report, { fontScale: 0.95 })
        expect(renderSeReportHtml(report, { fontScale: 1 })).toBe(exported)
        expect(exported).toContain('font:14px/1.55')
        expect(exported).toContain('h1{font-size:28px')
        for (const value of ['font:13.3px/1.55', 'h1{font-size:26.6px', 'h2{font-size:19px', 'h3{font-size:15.2px', 'font-size:28.5px', 'font-size:25.65px', 'font-size:11.4px']) {
            expect(preview).toContain(value)
        }
        expect(preview).toContain('main{max-width:1480px;margin:auto;padding:24px}')
        expect(preview.slice(preview.indexOf('</style>'))).toBe(exported.slice(exported.indexOf('</style>')))
    })

    it.each([0, -0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid preview font scale %s', (fontScale) => {
        expect(() => renderSeReportHtml(buildSeReports(createSeReportingFixture())[0]!, { fontScale })).toThrow('Font scale must be a positive finite number.')
    })

    it('escapes customer data and verbatim asks and hides only customer cards when filtering', () => {
        const input = createSeReportingFixture()
        input.assignments[0]!.accountName = '<script>not-code</script>'
        const report = buildSeReports(input)[0]!
        report.asks_for_manager = [{ ask: '<img src=x onerror=alert(1)>', why_it_matters: '', customer: '', urgency: '', source_refs: [] }]
        const html = renderSeReportHtml(report, { customerStatus: 'with_blocker' })
        expect(html).toContain('&lt;script&gt;')
        expect(html).toContain('&lt;img')
        expect(html).not.toContain('<script>')
        expect(html).not.toContain('<img ')
        expect(html).toContain('class="customer status-advisory" hidden')
        expect(html.match(/class="kpi"/g)).toHaveLength(5)
    })

    it('has a static loading/setup surface without reading sources during render', () => {
        const invoke = vi.fn()
        const markup = renderToStaticMarkup(createElement(SeReportingDashboardPane, { invoke }))
        expect(markup).toContain('SE Reporting Dashboard')
        expect(markup).toContain('Set up a manager profile')
        expect(invoke).not.toHaveBeenCalled()
    })

    it('retains structured partner, dependency and outcome facts from canonical JSON', () => {
        const report = buildSeReports(createSeReportingFixture())[0]!
        const note = { account_id: 'account-one', customer: 'Contoso Energy', atu: 'atu-one', ownership: 'Primary' as const,
            title: 'Synthetic business context', text: 'Source-backed monthly summary.', source_refs: ['active-one'] }
        report.partners = [{ ...note, partner: 'Sample Partner', engagement_strategy: 'Lead the customer workshops', solution_play: 'Synthetic modernization play' }]
        report.cross_pillar_dependencies = [{ ...note, pillar: 'infra' }]
        report.next_month_priorities = [{ ...note, expected_outcome: 'Production readiness approved' }]
        const html = renderSeReportHtml(report)
        for (const value of ['Sample Partner', 'Lead the customer workshops', 'Synthetic modernization play', 'Dependency pillar', 'Production readiness approved']) {
            expect(html).toContain(value)
        }
    })

    it('authorizes the inline stylesheet by nonce for hosts with a restrictive style policy', () => {
        const report = buildSeReports(createSeReportingFixture())[0]!
        const html = renderSeReportHtml(report, { styleNonce: 'AbCdEfGhIjKlMnOp0123456789' })
        expect(html).toContain("style-src 'nonce-AbCdEfGhIjKlMnOp0123456789'")
        expect(html).toContain('<style nonce="AbCdEfGhIjKlMnOp0123456789">')
        expect(html).not.toContain("'unsafe-inline'")
        expect(renderSeReportHtml(report, { styleNonce: '"><script>' })).toContain("style-src 'unsafe-inline'")
    })
})
