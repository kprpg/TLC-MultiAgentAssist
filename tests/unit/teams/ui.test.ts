import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TeamsShell } from '../../../apps/teams/src/client/shell.js'
import { AgentResultView } from '../../../apps/teams/src/client/result-view.js'
import { contractVersion } from '../../../packages/common/contracts/version.js'
import { NativeConnectionPanel } from '../../../apps/teams/src/client/native-connection-panel.js'
import { LocalBrowserConnection } from '../../../apps/teams/src/client/local-connection.js'
import { TeamsApiClient } from '../../../apps/teams/src/client/data-client.js'
import { TeamsLaunchStatusPanel } from '../../../apps/teams/src/client/launch-status.js'
import { ResponseActions } from '../../../apps/teams/src/client/response-actions.js'
import { OpportunityCommentsEditor } from '../../../apps/teams/src/client/record-actions.js'
import { OpportunityWorkbench } from '../../../apps/teams/src/client/opportunity-workbench.js'

describe('Teams-native presentation', () => {
  it('links the focused opportunity heading to its MSX record', () => {
    const opportunity = {
      id: 'opp-1', accountId: 'account', name: 'Selected opportunity', recordedStage: 1,
      value: 100, currency: 'USD', closeDate: '2099-12-31'
    }
    const html = renderToStaticMarkup(createElement(OpportunityWorkbench, {
      client: new TeamsApiClient(async () => ''),
      selection: { account: { id: 'account', name: 'Sample account', segment: 'Enterprise' }, opportunity },
      opportunities: [opportunity], milestones: [],
      panes: { accountsExpanded: true, detailsExpanded: true, actionsExpanded: true },
      tab: 'overview', onTabChange: vi.fn(), onSelectOpportunity: vi.fn(),
      onAction: vi.fn(), onMeeting: vi.fn(), onDraftChange: vi.fn()
    }))

    expect(html).toContain('<h2><a class="msx-opportunity-link"')
    expect(html).toContain('href="https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&amp;etn=opportunity&amp;id=opp-1"')
    expect(html).toContain('>Selected opportunity</a></h2>')
  })

  it('shows a pending backend check rather than claiming Teams is already connected before initialization', () => {
    const html = renderToStaticMarkup(createElement(TeamsLaunchStatusPanel, { authentication: undefined, client: undefined, connected: false }))
    expect(html).toContain('Checking backend connection')
    expect(html).toContain('Backend connection')
    expect(html).not.toContain('Teams client and backend verified')
  })
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
  it.each(['read-only', 'reviewed'] as const)('labels the configured CLI %s capability without promising unreviewed writes', (writeMode) => {
    const html = renderToStaticMarkup(createElement(NativeConnectionPanel, {
      connection: new LocalBrowserConnection(), client: new TeamsApiClient(async () => ''),
      connected: true, authentication: 'local-azure-cli', writeMode,
      onConnected: async () => undefined, onDisconnected: () => undefined
    }))
    expect(html).toContain(`Live MSX - Azure CLI ${writeMode === 'reviewed' ? 'reviewed read/write' : 'read-only'}`)
    if (writeMode === 'reviewed') expect(html).toContain('explicit review')
    expect(html).not.toContain('access_token')
  })
  it('renders safe readable markdown and honest source state, never executable HTML or non-HTTPS evidence', () => {
    const client = new TeamsApiClient(async () => '')
    const download = vi.spyOn(client, 'download')
    const html = renderToStaticMarkup(createElement(AgentResultView, {
      actions: createElement(ResponseActions, {
        client, opportunityId: 'opp', title: 'Sanitized guidance', markdown: 'Grounded result.', generatedAt: '2026-10-17T20:00:00.000Z'
      }),
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
    const header = html.slice(0, html.indexOf('</header>'))
    expect(header).toContain('aria-label="Response exports"')
    expect(header).toContain('Export Word')
    expect(header).toContain('Email draft recipients')
    expect(header).toContain('disabled="">Download unsent email draft')
    expect(html.indexOf('</header>')).toBeLessThan(html.indexOf('<h2>Summary</h2>'))
    expect(download).not.toHaveBeenCalled()
  })
  it('renders an escaped opportunity comment draft without bypassing private review', () => {
    const onAction = vi.fn()
    const html = renderToStaticMarkup(createElement(OpportunityCommentsEditor, {
      opportunity: {
        id: 'opp', accountId: 'account', name: 'Sanitized opportunity', recordedStage: 1,
        value: 100, currency: 'USD', closeDate: '2099-12-31', comments: '<script>untrusted</script>'
      },
      onAction, onDraftChange: vi.fn(), label: 'Comments for Sanitized opportunity'
    }))
    expect(html).toContain('Comments for Sanitized opportunity')
    expect(html).toContain('&lt;script&gt;untrusted&lt;/script&gt;')
    expect(html).toContain('Review opportunity update')
    expect(html).not.toContain('<script>')
    expect(onAction).not.toHaveBeenCalled()
  })
})
