export interface DiscoveryOpportunity {
  id: string
  name: string
  accountId: string
  accountName?: string
  recordedStage: number
  onDealTeam: boolean
}

export interface DiscoveryCustomer {
  id: string
  name: string
}

export type DiscoveryFilterOperator = 'include' | 'exclude'
export type DiscoveryFilters = Record<DiscoveryFilterOperator, readonly DiscoveryCustomer[]>
export type DiscoverySortColumn = 'account' | 'stage' | 'action'
export type DiscoverySort = { column: DiscoverySortColumn; direction: 'ascending' | 'descending' }

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function discoveryCustomers(opportunities: readonly { accountId: string; accountName?: string }[]): DiscoveryCustomer[] {
  const customers = new Map<string, DiscoveryCustomer>()
  for (const item of opportunities) {
    const name = item.accountName?.trim()
    if (!customers.has(item.accountId) || name) customers.set(item.accountId, { id: item.accountId, name: name || item.accountId })
  }
  return [...customers.values()].sort((left, right) => collator.compare(left.name, right.name) || left.id.localeCompare(right.id))
}

export function filterDiscoveryOpportunities<T extends DiscoveryOpportunity>(opportunities: readonly T[], filters: DiscoveryFilters): T[] {
  const included = new Set(filters.include.map((customer) => customer.id))
  const excluded = new Set(filters.exclude.map((customer) => customer.id))
  return opportunities.filter((item) => (included.size === 0 || included.has(item.accountId)) && !excluded.has(item.accountId))
}

export function toggleDiscoverySort(current: DiscoverySort | null, column: DiscoverySortColumn): DiscoverySort {
  return { column, direction: current?.column === column && current.direction === 'ascending' ? 'descending' : 'ascending' }
}

export function sortDiscoveryOpportunities<T extends DiscoveryOpportunity>(opportunities: readonly T[], sort: DiscoverySort | null): T[] {
  if (!sort) return [...opportunities]
  const direction = sort.direction === 'ascending' ? 1 : -1
  return [...opportunities].sort((left, right) => {
    const difference = sort.column === 'account'
      ? compareAccounts(left, right, direction)
      : sort.column === 'stage'
        ? (left.recordedStage - right.recordedStage) * direction
        : (Number(left.onDealTeam) - Number(right.onDealTeam)) * direction
    return difference || compareAccounts(left, right, 1) || collator.compare(left.name, right.name) || left.id.localeCompare(right.id)
  })
}

function compareAccounts(left: DiscoveryOpportunity, right: DiscoveryOpportunity, direction: number): number {
  const leftName = left.accountName?.trim()
  const rightName = right.accountName?.trim()
  if (!leftName) return rightName ? 1 : 0
  if (!rightName) return -1
  return collator.compare(leftName, rightName) * direction
}
