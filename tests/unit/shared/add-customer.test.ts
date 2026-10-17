import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AddCustomerButton, type CustomerSearchClient } from '../../../apps/shared/add-customer.js'

describe('AddCustomerButton', () => {
  it.each(['sample', 'live'] as const)('explains the %s search source without starting a lookup', (dataMode) => {
    const client: CustomerSearchClient = {
      searchAccounts: vi.fn(async () => []),
      addAccount: vi.fn(),
      setAccountVisibility: vi.fn()
    }
    const markup = renderToStaticMarkup(createElement(AddCustomerButton, { client, dataMode, onAdded: vi.fn() }))
    expect(markup).toContain(dataMode === 'sample' ? 'Sample data only' : 'Live MSX')
    expect(markup).toContain('Choose the intended account')
    expect(client.searchAccounts).not.toHaveBeenCalled()
  })

  it('renders an accessible search dialog without requiring a portfolio or requesting data', () => {
    const client: CustomerSearchClient = {
      searchAccounts: vi.fn(async () => []),
      addAccount: vi.fn(),
      setAccountVisibility: vi.fn()
    }
    const onAdded = vi.fn()
    const markup = renderToStaticMarkup(createElement(AddCustomerButton, { client, onAdded }))

    expect(markup).toContain('aria-label="Add customer"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).toContain('Add customer account')
    expect(markup).toContain('even if you are not on any of their Deal Teams')
    expect(markup).toContain('Account name')
    expect(markup).toContain('TPID')
    expect(markup).not.toContain('No matching customer accounts')
    expect(client.searchAccounts).not.toHaveBeenCalled()
    expect(client.addAccount).not.toHaveBeenCalled()
    expect(client.setAccountVisibility).not.toHaveBeenCalled()
    expect(onAdded).not.toHaveBeenCalled()
  })
})
