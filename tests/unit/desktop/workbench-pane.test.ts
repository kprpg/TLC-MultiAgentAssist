import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchPane } from '../../../apps/desktop/renderer-revamp/src/workbench-pane.js'

describe('WorkbenchPane', () => {
    it('renders named maximize and collapse controls outside the scrollable content', () => {
        const markup = renderToStaticMarkup(createElement(WorkbenchPane, {
            collapsed: false,
            mobileActive: false,
            stageBoardActive: false,
            onToggleCollapsed: vi.fn()
        }, createElement('p', null, 'Grounded guidance')))

        expect(markup).toContain('aria-label="Maximize Guidance pane"')
        expect(markup).toContain('aria-pressed="false"')
        expect(markup).toContain('aria-label="Collapse Guidance pane"')
        expect(markup).toContain('aria-expanded="true"')
        expect(markup).toContain('aria-controls="guidance-pane-content"')
        expect(markup.indexOf('Collapse Guidance pane')).toBeLessThan(markup.indexOf('id="guidance-pane-content"'))
        expect(markup).toContain('Grounded guidance')
    })

    it('keeps the restore-from-collapse control and preserves mounted content', () => {
        const markup = renderToStaticMarkup(createElement(WorkbenchPane, {
            collapsed: true,
            mobileActive: true,
            stageBoardActive: true,
            onToggleCollapsed: vi.fn()
        }, createElement('p', null, 'Preserved stage board')))

        expect(markup).toContain('guidance-collapsed')
        expect(markup).toContain('mobile-active')
        expect(markup).toContain('stage-board-active')
        expect(markup).toContain('aria-label="Expand Guidance pane"')
        expect(markup).toContain('aria-expanded="false"')
        expect(markup).not.toContain('Maximize Guidance pane')
        expect(markup).toContain('Preserved stage board')
    })
})
