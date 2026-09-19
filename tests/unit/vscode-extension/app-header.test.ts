import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppHeader } from '../../../apps/vscode-extension/src/webview/app-header.js'

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
            onToggleActions: vi.fn()
        }))

        expect(markup).toContain('Portfolio')
        expect(markup).toContain('Plays')
        expect(markup).toContain('Live')
        expect(markup).not.toContain('TLC Assist')
    })
})