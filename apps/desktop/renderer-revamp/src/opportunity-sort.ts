import type { Opportunity } from '../../../../packages/common/index.js'

export type OpportunitySort = 'closeDate' | 'stage' | 'value'
export type SortDirection = 'ascending' | 'descending'

export function sortOpportunities(opportunities: readonly Opportunity[], sortBy: OpportunitySort, direction?: SortDirection): Opportunity[] {
  return [...opportunities].sort((left, right) => {
    const difference = sortBy === 'closeDate'
      ? compare(left.closeDate, right.closeDate, direction ?? 'ascending')
      : sortBy === 'stage'
        ? right.recordedStage - left.recordedStage
        : compare(left.value, right.value, direction ?? 'descending')

    return difference || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  })
}

function compare(left: number | string, right: number | string, direction: SortDirection): number {
  const difference = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right))
  return direction === 'ascending' ? difference : -difference
}