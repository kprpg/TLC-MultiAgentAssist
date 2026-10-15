import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MembershipRemovalPrompt } from '../../../apps/shared/membership-removal.js'

describe('MembershipRemovalPrompt', () => {
  it.each([false, true])('renders explicit confirmation with busy=%s', (busy) => {
    const onConfirm = vi.fn(async () => undefined)
    const markup = renderToStaticMarkup(createElement(MembershipRemovalPrompt, {
      title: 'Remove from Deal Team',
      message: 'Remove yourself from this opportunity?',
      busy,
      onConfirm,
      onCancel: vi.fn()
    }))

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('Remove yourself from this opportunity?')
    expect(markup).toContain('Cancel')
    expect(markup).toContain(busy ? 'Removing...' : 'Remove membership')
    expect(markup.match(/disabled=""/g) ?? []).toHaveLength(busy ? 2 : 0)
    expect(markup).not.toContain('role="alert"')
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
