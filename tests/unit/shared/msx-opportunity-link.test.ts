import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MsxOpportunityLink } from '../../../apps/shared/msx-opportunity-link.js'

describe('shared focused opportunity hyperlink', () => {
    it('renders an accessible external link without opening it during render', () => {
        const onOpen = vi.fn()
        const onError = vi.fn()
        const html = renderToStaticMarkup(createElement(MsxOpportunityLink, {
            opportunity: { id: 'opp-1', name: 'Selected opportunity' }, onOpen, onError
        }))

        expect(html).toContain('href="https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&amp;etn=opportunity&amp;id=opp-1"')
        expect(html).toContain('target="_blank"')
        expect(html).toContain('rel="noopener noreferrer"')
        expect(html).toContain('title="Open opportunity in MSX (opens in your browser)"')
        expect(html).toContain('>Selected opportunity</a>')
        expect(onOpen).not.toHaveBeenCalled()
        expect(onError).not.toHaveBeenCalled()
    })

    it('escapes untrusted opportunity names and encodes the record ID', () => {
        const html = renderToStaticMarkup(createElement(MsxOpportunityLink, {
            opportunity: { id: 'opp&etn=account', name: '<script>untrusted</script>' }, onOpen: vi.fn(), onError: vi.fn()
        }))

        expect(html).toContain('id=opp%26etn%3Daccount')
        expect(html).toContain('&lt;script&gt;untrusted&lt;/script&gt;')
        expect(html).not.toContain('<script>')
    })
})
