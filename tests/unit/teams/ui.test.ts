import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TeamsShell } from '../../../apps/teams/src/client/shell.js'
import { AgentResultView } from '../../../apps/teams/src/client/result-view.js'
import { contractVersion } from '../../../packages/common/contracts/version.js'
import { NativeConnectionPanel } from '../../../apps/teams/src/client/native-connection-panel.js'
import { LocalBrowserConnection } from '../../../apps/teams/src/client/local-connection.js'
import { TeamsApiClient } from '../../../apps/teams/src/client/data-client.js'

describe('Teams-native presentation', () => {
  it('shows the full native capability/limitation matrix without an HTTP sign-in/approval shortcut', () => {
    const html = renderToStaticMarkup(createElement(NativeConnectionPanel, {
      connection: new LocalBrowserConnection(), client: new TeamsApiClient(async () => ''),
      connected: false, onConnected: async () => undefined, onDisconnected: () => undefined
    }))
    for (const text of ['Request local pairing', 'protected local owner command', 'Capabilities and limitations', 'Live MSX Portfolio', 'Dataverse MCP Plays', 'Shared meeting stage', 'Live Seller Dashboard']) expect(html).toContain(text)
    expect(html).not.toContain('Sign in with Microsoft')
    expect(html).not.toContain('access_token')
  })
  it('renders task-focused navigation and an explicit sample boundary without duplicating Teams chrome', () => {
    const html = renderToStaticMarkup(createElement(TeamsShell, {
      mode: 'sample', view: 'portfolio', onNavigate: () => undefined, children: createElement('p', null, 'Workspace')
    }))
    for (const label of ['New', 'Discover', 'Portfolio', 'Plays', 'Dashboards', 'Meetings', 'Activity']) expect(html).toContain(label)
    expect(html).toContain('Sample')
    expect(html).toContain('aria-label="TLC navigation"')
    expect(html).not.toContain('window-controls')
  })
  it('renders safe readable markdown and honest source state, never executable HTML or non-HTTPS evidence', () => {
    const html = renderToStaticMarkup(createElement(AgentResultView, {
      result: {
        contractVersion, correlationId: '11111111-1111-4111-8111-111111111111', capability: 'account-pulse',
        agentVersion: 'test', generatedAt: '2026-10-17T20:00:00.000Z', mode: 'sample', state: 'partial',
        content: '## Summary\n\n**Grounded** result.\n\n<script>bad()</script>\n\n[Unsafe](javascript:alert(1))\n\n[Evidence](https://example.com/evidence)',
        sourceHealth: [{ source: 'msx', state: 'partial', detail: 'Source incomplete', checkedAt: '2026-10-17T20:00:00.000Z' }]
      }
    }))
    expect(html).toContain('<h2>Summary</h2>')
    expect(html).toContain('<strong>Grounded</strong>')
    expect(html).toContain('Source incomplete')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('https://example.com/evidence')
  })
})
