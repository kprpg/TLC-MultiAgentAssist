import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PaneResizeHandle } from '../../../apps/shared/pane-resize-handle.js'
import { ResizableSplit } from '../../../apps/shared/resizable-split.js'

describe('shared pane resizing', () => {
    it('renders a keyboard-focusable vertical separator with a three-dot grip and width bounds', () => {
        const markup = renderToStaticMarkup(createElement(PaneResizeHandle, {
            label: 'Accounts panel', controls: 'accounts', width: 300, minWidth: 240, maxWidth: 600,
            defaultWidth: 320, onResize: vi.fn()
        }))
        for (const attribute of [
            'role="separator"', 'aria-label="Resize Accounts panel"', 'aria-controls="accounts"',
            'aria-orientation="vertical"', 'aria-valuemin="240"', 'aria-valuemax="600"',
            'aria-valuenow="300"', 'aria-valuetext="300 pixels"', 'tabindex="0"'
        ]) expect(markup).toContain(attribute)
        expect(markup).toContain('class="pane-resize-grip" aria-hidden="true"><span></span><span></span><span></span>')
    })

    it('supports start-edge handles for the existing right-hand Desktop/Web blade', () => {
        const markup = renderToStaticMarkup(createElement(PaneResizeHandle, {
            label: 'Next best actions blade', width: 310, minWidth: 240, maxWidth: 520,
            defaultWidth: 310, edge: 'start', className: 'blade-resize-handle', onResize: vi.fn()
        }))
        expect(markup).toContain('pane-resize-handle start blade-resize-handle')
    })

    it.each([
        { firstVisible: true, secondVisible: true, handles: 1 },
        { firstVisible: true, secondVisible: false, handles: 0 },
        { firstVisible: false, secondVisible: true, handles: 0 },
        { firstVisible: false, secondVisible: false, handles: 0 }
    ])('preserves both pane subtrees and only offers a handle between visible panes: %j', ({ firstVisible, secondVisible, handles }) => {
        const markup = renderToStaticMarkup(createElement(ResizableSplit, {
            className: 'test-split', label: 'Accounts panel', controls: 'accounts', defaultRatio: 1 / 3,
            firstVisible, secondVisible,
            children: [
                createElement('section', { id: 'accounts' }, createElement('textarea', { defaultValue: 'Unsent draft' })),
                createElement('section', { id: 'details' }, 'Opportunity details')
            ]
        }))
        expect(markup.match(/role="separator"/g) ?? []).toHaveLength(handles)
        expect(markup).toContain('Unsent draft')
        expect(markup).toContain('Opportunity details')
        if (!firstVisible || !secondVisible) expect(markup).toContain('single-column')
        expect(markup.match(/class="resizable-split-cell" hidden=""/g) ?? []).toHaveLength(Number(!firstVisible) + Number(!secondVisible))
    })
})
