import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GuidancePaneToggle, GuidanceWorkbenchPane } from '../../../apps/shared/guidance-pane.js'

describe('Guidance pane controls', () => {
    it.each([false, true])('describes the maximize/restore action when maximized is %s', (maximized) => {
        const onToggle = vi.fn()
        const markup = renderToStaticMarkup(createElement(GuidancePaneToggle, { maximized, onToggle, controls: 'guidance-content' }))
        const label = `${maximized ? 'Restore' : 'Maximize'} Guidance pane`
        expect(markup).toContain(`aria-label="${label}"`)
        expect(markup).toContain(`title="${label}"`)
        expect(markup).toContain(`aria-pressed="${maximized}"`)
        expect(markup).toContain('aria-controls="guidance-content"')
        expect(markup).toContain('type="button"')
        expect(onToggle).not.toHaveBeenCalled()
    })

    it('renders the toolbar above the existing opportunity content', () => {
        const markup = renderToStaticMarkup(createElement(GuidanceWorkbenchPane, {
            id: 'portfolio-details-panel', className: 'pane'
        }, createElement('p', null, 'Preserved guidance response')))
        expect(markup).toContain('aria-label="Guidance pane controls"')
        expect(markup).toContain('aria-controls="portfolio-details-panel-content"')
        expect(markup.indexOf('Maximize Guidance pane')).toBeLessThan(markup.indexOf('id="portfolio-details-panel-content"'))
        expect(markup).toContain('Preserved guidance response')
        expect(markup).not.toContain('guidance-maximized')
    })

    it('keeps content mounted when the opportunity pane is hidden', () => {
        const markup = renderToStaticMarkup(createElement(GuidanceWorkbenchPane, {
            id: 'portfolio-details-panel', className: 'pane', hidden: true
        }, createElement('textarea', { defaultValue: 'Unsent private draft' })))
        expect(markup).toContain('hidden=""')
        expect(markup).toContain('Unsent private draft')
        expect(markup).not.toContain('guidance-maximized')
    })
})
