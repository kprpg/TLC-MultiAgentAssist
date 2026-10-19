import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { initialTeamsView, togglePortfolioPane, teamsSurface } from '../../../apps/teams/src/client/workspace-navigation.js'
import { TeamsShell } from '../../../apps/teams/src/client/shell.js'

describe('extension-aligned Teams navigation', () => {
  it('defaults to Portfolio without overriding explicit contextual links', () => {
    expect(initialTeamsView(new URLSearchParams())).toBe('portfolio')
    for (const [search, view] of [
      ['surface=configure', 'configure'], ['surface=meeting', 'meetings'],
      ['surface=channel&bindingId=bound', 'portfolio'], ['bindingId=bound&view=dashboard', 'portfolio'],
      ['view=activity', 'activity'], ['view=plays', 'plays']
    ]) expect(initialTeamsView(new URLSearchParams(search))).toBe(view)
  })
  it('uses SDK frame context, not viewport width, for narrow and settings surfaces', () => {
    expect(teamsSurface(new URLSearchParams(), 'sidePanel')).toBe('panel')
    expect(teamsSurface(new URLSearchParams(), 'settings')).toBe('configure')
    expect(teamsSurface(new URLSearchParams('bindingId=bound'), 'content')).toBe('bound')
    expect(teamsSurface(new URLSearchParams(), 'content')).toBe('personal')
  })
  it('cannot leave all three Portfolio panes hidden', () => {
    expect(togglePortfolioPane({ accountsExpanded: false, detailsExpanded: true, actionsExpanded: false }, 'detailsExpanded'))
      .toEqual({ accountsExpanded: false, detailsExpanded: true, actionsExpanded: false })
    expect(togglePortfolioPane({ accountsExpanded: true, detailsExpanded: true, actionsExpanded: true }, 'accountsExpanded').accountsExpanded).toBe(false)
  })
  it('renders the five primary destinations, utilities, and explicit mode', () => {
    const html = renderToStaticMarkup(createElement(TeamsShell, {
      mode: 'sample', view: 'portfolio', onNavigate: vi.fn(), children: createElement('p', null, 'Workspace')
    }))
    for (const label of ['New', 'Discover', 'Portfolio', 'Plays', 'Dashboards', 'Meetings', 'Activity', 'Context settings', 'Sample - no live business data']) expect(html).toContain(label)
    expect(html).toContain('aria-current="page"')
    expect(html).not.toContain('window-controls')
  })
  it('does not offer unrelated account navigation inside a bound tab or meeting panel', () => {
    for (const surface of ['bound', 'panel'] as const) {
      const html = renderToStaticMarkup(createElement(TeamsShell, {
        mode: 'sample', view: 'portfolio', surface, onNavigate: vi.fn(), children: null
      }))
      expect(html).not.toContain('>Discover<')
      expect(html).not.toContain('>Dashboards<')
      expect(html).toContain('Open private workbench')
      if (surface === 'panel') expect(html).not.toContain('>Plays<')
    }
  })
})
