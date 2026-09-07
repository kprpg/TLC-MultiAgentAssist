import type { Opportunity } from '../../../../packages/common/index.js'

export type OpportunitySort = 'closeDate' | 'stage' | 'value'

export function sortOpportunities(opportunities: readonly Opportunity[], sortBy: OpportunitySort): Opportunity[] {
  return [...opportunities].sort((left, right) => {
    const difference = sortBy === 'closeDate'
      ? right.closeDate.localeCompare(left.closeDate)
      : sortBy === 'stage'
        ? right.recordedStage - left.recordedStage
        : right.value - left.value

    return difference || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  })
}