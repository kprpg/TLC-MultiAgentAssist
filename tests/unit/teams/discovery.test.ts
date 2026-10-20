import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DiscoveryWorkspace } from '../../../apps/teams/src/client/discovery.js'
import { TeamsApiClient } from '../../../apps/teams/src/client/data-client.js'

describe('Teams Discover presentation', () => {
  it.each(['sample', 'live'] as const)('renders the shared customer filters and domain tabs in %s without starting reads or writes during rendering', (mode) => {
    const client = new TeamsApiClient(async () => '')
    const operation = vi.spyOn(client, 'operation')
    const review = vi.fn()
    const html = renderToStaticMarkup(createElement(DiscoveryWorkspace, {
      client, mode, active: true, onAction: review,
      searchClient: { searchAccounts: vi.fn(), addAccount: vi.fn(), setAccountVisibility: vi.fn() }
    }))
    expect(html).toContain('aria-label="Discover opportunities"')
    expect(html).toContain('Discover opportunities</h1>')
    expect(html).toContain('role="tablist" aria-label="Solution Engineer domain"')
    expect(html.match(/role="tab"/g)).toHaveLength(8)
    expect(html).toContain('aria-label="Discovery customer filters"')
    expect(html).toContain('Customers equals')
    expect(html).toContain('Add filter')
    expect(html).not.toContain('Solution Engineer domain<select')
    expect(html).toContain('Loading Discover opportunities')
    expect(html).not.toContain('No eligible opportunities for this source scope and domain.')
    if (mode === 'live') expect(html).toContain('MSX searches can take time')
    expect(operation).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
  })
})
