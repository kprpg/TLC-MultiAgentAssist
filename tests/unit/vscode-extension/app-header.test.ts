import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppHeader } from '../../../apps/vscode-extension/src/webview/app-header.js'

vi.mock('../../../apps/vscode-extension/src/webview/data-client.js', () => ({
    dataClient: { listAccounts: vi.fn(), listOpportunities: vi.fn() }
}))

describe('AppHeader', () => {
    it('renders navigation without duplicating the VS Code view title', () => {
        const markup = renderToStaticMarkup(createElement(AppHeader, {
            tab: 'portfolio',
            mode: 'live',
            accountsExpanded: true,
            detailsExpanded: true,
            actionsExpanded: true,
            onSelectTab: vi.fn(),
            onToggleAccounts: vi.fn(),
            onToggleDetails: vi.fn(),
            onToggleActions: vi.fn(),
            onOpenIssue: vi.fn(),
            onSearchSelect: vi.fn()
        }))

        expect(markup).toContain('Portfolio')
        expect(markup).toContain('Plays')
        expect(markup).toContain('Discover')
        expect(markup.indexOf('Discover')).toBeLessThan(markup.indexOf('Portfolio'))
        expect(markup.indexOf('Portfolio')).toBeLessThan(markup.indexOf('Plays'))
        expect(markup).toContain('Live')
        expect(markup).toContain('aria-label="Send feedback"')
        expect(markup).toContain('aria-label="Search accounts and opportunities"')
        expect(markup).toContain('aria-controls="portfolio-search-results"')
        expect(markup).not.toContain('TLC Assist')
    })
})