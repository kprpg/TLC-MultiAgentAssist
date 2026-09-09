import { describe, expect, it } from 'vitest'
import type { Milestone } from '../../../packages/common/index.js'
import { sortMilestones } from '../../../apps/desktop/renderer-revamp/src/milestone-sort.js'

const milestones: Milestone[] = [
  { id: 'one', opportunityId: 'opportunity', name: 'One', status: 'At Risk', targetDate: '2026-10-01', estimatedMonthlyUsage: 100, commitment: 'Uncommitted' },
  { id: 'two', opportunityId: 'opportunity', name: 'Two', status: 'On Track', targetDate: '2027-01-01', estimatedMonthlyUsage: 50, commitment: 'Committed' },
  { id: 'three', opportunityId: 'opportunity', name: 'Three', status: 'Blocked', targetDate: '2026-12-01', estimatedMonthlyUsage: 200, commitment: 'Uncommitted' },
  { id: 'missing', opportunityId: 'opportunity', name: 'Missing', status: 'Status not recorded' }
]

describe('milestone sorting', () => {
  it.each([
    ['targetDate', ['two', 'three', 'one', 'missing']],
    ['estimatedMonthlyUsage', ['three', 'one', 'two', 'missing']],
    ['commitment', ['two', 'one', 'three', 'missing']],
    ['status', ['two', 'one', 'three', 'missing']]
  ] as const)('sorts by %s', (sortBy, expectedIds) => {
    expect(sortMilestones(milestones, sortBy).map((item) => item.id)).toEqual(expectedIds)
  })

  it('does not mutate fetched milestone order', () => {
    sortMilestones(milestones, 'targetDate')

    expect(milestones.map((item) => item.id)).toEqual(['one', 'two', 'three', 'missing'])
  })
})