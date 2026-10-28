import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MembershipAction, WorkflowMembershipControls } from '../../../apps/shared/workflow-membership.js'

describe('shared Plays membership presentation', () => {
  it('defaults to All visible items and exposes the reversible My items choice', () => {
    const html = renderToStaticMarkup(createElement(WorkflowMembershipControls, { membership: {
      filter: 'all', setFilter: vi.fn(), loading: false, message: undefined,
      visibleItems: 4, totalItems: 4, refresh: vi.fn()
    } }))
    expect(html).toContain('aria-label="Filter Play results"')
    expect(html).toContain('<option value="all" selected="">All visible items</option>')
    expect(html).toContain('<option value="mine">My items</option>')
    expect(html).toContain('4 of 4 items')
  })

  it('does not describe unavailable membership as an empty My result', () => {
    const html = renderToStaticMarkup(createElement(WorkflowMembershipControls, { membership: {
      filter: 'mine', setFilter: vi.fn(), loading: false, message: 'Team membership is unavailable.',
      visibleItems: 0, totalItems: 4, refresh: vi.fn()
    } }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('Team membership is unavailable.')
    expect(html).not.toContain('No items match')
  })

  it('keeps a disabled button visible with a hover and keyboard-readable explanation', () => {
    const reason = 'You are not a member of this opportunity Deal Team or the applicable milestone team.'
    const html = renderToStaticMarkup(createElement(MembershipAction, {
      reason, children: createElement('button', { disabled: true }, 'Send to Agent')
    }))
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-describedby=')
    expect(html).toContain('role="tooltip"')
    expect(html).toContain(reason)
    expect(html).toContain('<button disabled="">Send to Agent</button>')
  })
})
