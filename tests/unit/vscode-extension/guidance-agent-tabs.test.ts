import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GuidanceAgentTabs } from '../../../apps/vscode-extension/src/webview/guidance-agent-tabs.js'

describe('GuidanceAgentTabs', () => {
    it('renders a described tooltip for every guidance agent tab', () => {
        const markup = renderToStaticMarkup(createElement(GuidanceAgentTabs, { capability: 'account-pulse', onSelect: vi.fn() }))

        expect(markup.match(/role="tooltip"/g)).toHaveLength(4)
        expect(markup.match(/aria-describedby="guidance-agent-tooltip-/g)).toHaveLength(8)
        expect(markup.match(/class="agent-tooltip-trigger"/g)).toHaveLength(4)
        expect(markup.match(/aria-label="About /g)).toHaveLength(4)
    })
})