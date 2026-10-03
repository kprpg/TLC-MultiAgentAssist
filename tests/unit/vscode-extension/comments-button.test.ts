import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CommentsButton } from '../../../apps/vscode-extension/src/webview/comments-button.js'

describe('CommentsButton', () => {
    it('renders a consistently styled row action with contextual help', () => {
        const markup = renderToStaticMarkup(createElement(CommentsButton, {
            title: 'Opportunity comments',
            onClick: vi.fn()
        }))

        expect(markup).toContain('class="comments-button"')
        expect(markup).toContain('type="button"')
        expect(markup).toContain('title="Opportunity comments"')
        expect(markup).toContain('>Comments</button>')
    })
})