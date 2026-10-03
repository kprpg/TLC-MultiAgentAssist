import { describe, expect, it } from 'vitest'
import {
  discoveryCustomers,
  filterDiscoveryOpportunities,
  sortDiscoveryOpportunities,
  toggleDiscoverySort,
  type DiscoveryCustomer,
  type DiscoveryOpportunity
} from '../../../apps/shared/discovery.js'

const opportunities: DiscoveryOpportunity[] = [
  { id: 'zulu', name: 'Zulu renewal', accountId: 'zulu', accountName: 'Zulu', recordedStage: 3, onDealTeam: false },
  { id: 'alpha', name: 'Alpha migration', accountId: 'alpha', accountName: 'Alpha', recordedStage: 2, onDealTeam: true },
  { id: 'beta', name: 'Beta platform', accountId: 'beta', accountName: 'Beta', recordedStage: 1, onDealTeam: false }
]
const alpha: DiscoveryCustomer = { id: 'alpha', name: 'Alpha' }
const beta: DiscoveryCustomer = { id: 'beta', name: 'Beta' }
const ids = (items: readonly DiscoveryOpportunity[]): string[] => items.map((item) => item.id)

describe('Discovery customer filters', () => {
  it('shows all customers in the original order until a filter is applied', () => {
    expect(filterDiscoveryOpportunities(opportunities, { include: [], exclude: [] })).toEqual(opportunities)
  })

  it('includes any of the selected customers', () => {
    expect(ids(filterDiscoveryOpportunities(opportunities, { include: [alpha, beta], exclude: [] }))).toEqual(['alpha', 'beta'])
  })

  it('excludes every selected customer', () => {
    expect(ids(filterDiscoveryOpportunities(opportunities, { include: [], exclude: [alpha, beta] }))).toEqual(['zulu'])
  })

  it('combines inclusion and exclusion, with exclusion taking precedence', () => {
    expect(ids(filterDiscoveryOpportunities(opportunities, { include: [alpha, beta], exclude: [alpha] }))).toEqual(['beta'])
    expect(filterDiscoveryOpportunities(opportunities, { include: [alpha], exclude: [alpha] })).toEqual([])
  })

  it('matches customer IDs, not ambiguous or changed display names', () => {
    const duplicateName = { ...opportunities[0]!, accountId: 'another-alpha', accountName: 'Alpha' }
    expect(ids(filterDiscoveryOpportunities([...opportunities, duplicateName], {
      include: [{ id: 'alpha', name: 'Previous account name' }],
      exclude: []
    }))).toEqual(['alpha'])
  })

  it('does not silently broaden a saved filter when its customer is absent from the domain', () => {
    expect(filterDiscoveryOpportunities(opportunities, {
      include: [{ id: 'different-domain', name: 'Other customer' }],
      exclude: []
    })).toEqual([])
  })

  it('applies customer filters even when the account name is unavailable', () => {
    const unnamed = { id: 'unnamed-opportunity', accountId: 'unnamed', name: 'Unnamed customer deal', recordedStage: 1, onDealTeam: false }
    const customer = { id: 'unnamed', name: 'unnamed' }
    expect(filterDiscoveryOpportunities([unnamed], { include: [customer], exclude: [] })).toEqual([unnamed])
    expect(filterDiscoveryOpportunities([unnamed], { include: [], exclude: [customer] })).toEqual([])
  })

  it('deduplicates customer choices by ID and sorts names naturally', () => {
    const items = [
      { accountId: 'ten', accountName: 'Customer 10' },
      { accountId: 'two', accountName: 'Customer 2' },
      { accountId: 'two', accountName: 'Customer 2' },
      { accountId: 'another-two', accountName: 'Customer 2' },
      { accountId: 'unnamed' }
    ]
    expect(discoveryCustomers(items)).toEqual([
      { id: 'another-two', name: 'Customer 2' },
      { id: 'two', name: 'Customer 2' },
      { id: 'ten', name: 'Customer 10' },
      { id: 'unnamed', name: 'unnamed' }
    ])
  })
})

describe('Discovery column sorting', () => {
  it.each([
    ['account', 'ascending', ['alpha', 'beta', 'zulu']],
    ['account', 'descending', ['zulu', 'beta', 'alpha']],
    ['stage', 'ascending', ['beta', 'alpha', 'zulu']],
    ['stage', 'descending', ['zulu', 'alpha', 'beta']],
    ['action', 'ascending', ['beta', 'zulu', 'alpha']],
    ['action', 'descending', ['alpha', 'beta', 'zulu']]
  ] as const)('sorts %s in %s order', (column, direction, expected) => {
    expect(ids(sortDiscoveryOpportunities(opportunities, { column, direction }))).toEqual(expected)
  })

  it('preserves the original order before a sort column is chosen', () => {
    expect(sortDiscoveryOpportunities(opportunities, null)).toEqual(opportunities)
  })

  it('keeps accounts without a display name last in either direction', () => {
    const unnamed = { id: 'unnamed', accountId: 'unnamed', name: 'Unknown customer deal', recordedStage: 1, onDealTeam: false }
    for (const direction of ['ascending', 'descending'] as const) {
      expect(sortDiscoveryOpportunities([unnamed, ...opportunities], { column: 'account', direction }).at(-1)).toEqual(unnamed)
    }
  })

  it('uses case-insensitive natural account ordering', () => {
    const items = [
      { ...opportunities[0]!, accountName: 'customer 10' },
      { ...opportunities[1]!, accountName: 'Customer 2' }
    ]
    expect(ids(sortDiscoveryOpportunities(items, { column: 'account', direction: 'ascending' }))).toEqual(['alpha', 'zulu'])
  })

  it('uses account, opportunity name, and ID as deterministic tie breakers', () => {
    const base = opportunities[1]!
    const items = [
      { ...base, id: 'second', name: 'Same name' },
      { ...base, id: 'first', name: 'Same name' },
      { ...base, id: 'earlier', name: 'Earlier name' }
    ]
    expect(ids(sortDiscoveryOpportunities(items, { column: 'stage', direction: 'descending' }))).toEqual(['earlier', 'first', 'second'])
  })

  it('repositions an opportunity when its Deal Team action changes', () => {
    const updated = opportunities.map((item) => item.id === 'alpha' ? { ...item, onDealTeam: false } : item)
    expect(ids(sortDiscoveryOpportunities(updated, { column: 'action', direction: 'ascending' }))).toEqual(['alpha', 'beta', 'zulu'])
  })

  it('does not mutate fetched rows or discard host-specific fields', () => {
    const rows = Object.freeze(opportunities.map((item) => Object.freeze({ ...item, technicalCapability: 'Compute' })))
    const result = sortDiscoveryOpportunities(filterDiscoveryOpportunities(rows, { include: [alpha, beta], exclude: [] }), {
      column: 'stage', direction: 'ascending'
    })
    expect(ids(rows)).toEqual(['zulu', 'alpha', 'beta'])
    expect(result[0]).toBe(rows[2])
    expect(result[0]?.technicalCapability).toBe('Compute')
  })

  it('starts ascending, toggles direction, and resets direction for a different column', () => {
    const ascending = toggleDiscoverySort(null, 'account')
    expect(ascending).toEqual({ column: 'account', direction: 'ascending' })
    const descending = toggleDiscoverySort(ascending, 'account')
    expect(descending).toEqual({ column: 'account', direction: 'descending' })
    expect(toggleDiscoverySort(descending, 'account')).toEqual(ascending)
    expect(toggleDiscoverySort(descending, 'stage')).toEqual({ column: 'stage', direction: 'ascending' })
  })
})
