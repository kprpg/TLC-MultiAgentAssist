import { describe, expect, it } from 'vitest'
import type { Opportunity } from '../../../packages/common/index.js'
import { sortOpportunities } from '../../../apps/desktop/renderer-revamp/src/opportunity-sort.js'

const opportunities: Opportunity[] = [
  { id: 'one', accountId: 'account', name: 'One', recordedStage: 2, value: 100, currency: 'USD', closeDate: '2026-10-01' },
  { id: 'two', accountId: 'account', name: 'Two', recordedStage: 3, value: 50, currency: 'USD', closeDate: '2027-01-01' },
  { id: 'three', accountId: 'account', name: 'Three', recordedStage: 1, value: 200, currency: 'USD', closeDate: '2026-12-01' }
]

describe('opportunity sorting', () => {
  it.each([
    ['closeDate', ['two', 'three', 'one']],
    ['stage', ['two', 'one', 'three']],
    ['value', ['three', 'one', 'two']]
  ] as const)('sorts by %s descending', (sortBy, expectedIds) => {
    expect(sortOpportunities(opportunities, sortBy).map((item) => item.id)).toEqual(expectedIds)
  })

  it('does not mutate the fetched opportunity order', () => {
    sortOpportunities(opportunities, 'value')

    expect(opportunities.map((item) => item.id)).toEqual(['one', 'two', 'three'])
  })
})