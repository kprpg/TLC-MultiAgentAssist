import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PortfolioSearch } from '../../../apps/desktop/renderer-revamp/src/portfolio-search.js'
import { createWebApiClient } from '../../../apps/desktop/renderer-revamp/src/data-client.js'

describe('Desktop/Web portfolio search', () => {
    it('keeps a search form with the same label, results relationship and shared voice control', () => {
        const html = renderToStaticMarkup(createElement(PortfolioSearch, {
            accounts: [], opportunities: [], loading: false, shell: 'web',
            client: createWebApiClient(), contextKey: 'portfolio', onSelect: vi.fn()
        }))
        expect(html).toContain('role="search"')
        expect(html).toContain('aria-label="Search accounts and opportunities"')
        expect(html).toContain('aria-controls="global-search-results"')
        expect(html).toContain('aria-label="Start voice search"')
        expect(html).toContain('type="button"')
    })
})
