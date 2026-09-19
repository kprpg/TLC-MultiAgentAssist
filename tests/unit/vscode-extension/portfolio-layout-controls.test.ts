import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { portfolioLayoutClassName } from '../../../apps/vscode-extension/src/webview/portfolio-layout.js'
import { PortfolioLayoutControls } from '../../../apps/vscode-extension/src/webview/portfolio-layout-controls.js'

describe('PortfolioLayoutControls', () => {
    it('describes the independent expanded state of both portfolio regions', () => {
        const markup = renderToStaticMarkup(createElement(PortfolioLayoutControls, {
            accountsExpanded: true,
            detailsExpanded: false,
            actionsExpanded: true,
            onToggleAccounts: vi.fn(),
            onToggleDetails: vi.fn(),
            onToggleActions: vi.fn()
        }))

        expect(markup).toContain('aria-label="Hide Accounts panel"')
        expect(markup).toContain('aria-controls="portfolio-accounts-panel"')
        expect(markup).toContain('aria-expanded="true"')
        expect(markup).toContain('aria-label="Show opportunity details panel"')
        expect(markup).toContain('aria-controls="portfolio-details-panel"')
        expect(markup).toContain('aria-expanded="false"')
        expect(markup).toContain('aria-label="Hide Next Best Actions panel"')
        expect(markup).toContain('aria-controls="next-best-actions-panel"')
        expect(markup.match(/aria-expanded="true"/g)).toHaveLength(2)
    })

    it('uses the full-width details-only layout when both side panes are hidden', () => {
        expect(portfolioLayoutClassName({
            accountsExpanded: false,
            detailsExpanded: true,
            actionsExpanded: false
        })).toContain('details-only')
    })
})