import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RemoveCustomerButton, type CustomerRemovalClient } from '../../../apps/shared/remove-customer.js'

function client(): CustomerRemovalClient {
  return { listAccounts: vi.fn(async () => []), setAccountVisibility: vi.fn() }
}

describe('RemoveCustomerButton', () => {
  it('renders a labelled chooser without loading or removing customers', () => {
    const source = client()
    const onRemoved = vi.fn()
    const markup = renderToStaticMarkup(createElement(RemoveCustomerButton, { client: source, onRemoved }))

    expect(markup).toContain('aria-label="Remove customer"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).toContain('Remove customer account')
    expect(markup).toContain('Choose a tracked customer')
    expect(markup).toContain('MSX/Dataverse records and team membership will not change')
    expect(markup).toContain('Saved Play runs and the official Seller Dashboard are unchanged')
    expect(markup).toContain('Add customer')
    expect(markup).toContain('Cancel')
    expect(source.listAccounts).not.toHaveBeenCalled()
    expect(source.setAccountVisibility).not.toHaveBeenCalled()
    expect(onRemoved).not.toHaveBeenCalled()
  })

  it('names the contextual customer without performing a mutation', () => {
    const source = client()
    const markup = renderToStaticMarkup(createElement(RemoveCustomerButton, {
      client: source, onRemoved: vi.fn(),
      account: { id: 'account-northwind', name: 'Northwind Health', tpid: '1000003' }
    }))

    expect(markup).toContain('aria-label="Remove this customer"')
    expect(markup).toContain('title="Remove Northwind Health from this TLC portfolio"')
    expect(markup).toContain('Northwind Health')
    expect(markup).toContain('TPID 1000003')
    expect(markup).not.toContain('<select')
    expect(source.setAccountVisibility).not.toHaveBeenCalled()
  })
})
