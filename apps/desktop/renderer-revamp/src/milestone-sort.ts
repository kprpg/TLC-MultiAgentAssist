import type { Milestone } from '../../../../packages/common/index.js'

export type MilestoneSort = 'targetDate' | 'estimatedMonthlyUsage' | 'commitment' | 'status'

const statusPriority = new Map([
  'On Track',
  'At Risk',
  'Blocked',
  'Completed',
  'Cancelled',
  'Lost to Competitor',
  'Hygiene/Duplicate'
].map((status, index) => [status.toLocaleLowerCase(), index]))

export function sortMilestones(milestones: readonly Milestone[], sortBy: MilestoneSort): Milestone[] {
  return [...milestones].sort((left, right) => {
    const difference = sortBy === 'targetDate'
      ? compareOptionalDescending(left.targetDate, right.targetDate)
      : sortBy === 'estimatedMonthlyUsage'
        ? compareOptionalDescending(left.estimatedMonthlyUsage, right.estimatedMonthlyUsage)
        : sortBy === 'commitment'
          ? compareCommitment(left.commitment, right.commitment)
          : compareStatus(left.status, right.status)

    return difference || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  })
}

function compareOptionalDescending<T extends number | string>(left: T | undefined, right: T | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1
  if (right === undefined) return -1
  return typeof left === 'number' && typeof right === 'number'
    ? right - left
    : String(right).localeCompare(String(left))
}

function compareCommitment(left: string | undefined, right: string | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1
  if (right === undefined) return -1
  if (left === right) return 0
  if (left === 'Committed') return -1
  if (right === 'Committed') return 1
  return left.localeCompare(right)
}

function compareStatus(left: string, right: string): number {
  const leftPriority = statusPriority.get(left.toLocaleLowerCase())
  const rightPriority = statusPriority.get(right.toLocaleLowerCase())
  if (leftPriority === undefined) return rightPriority === undefined ? left.localeCompare(right) : 1
  if (rightPriority === undefined) return -1
  return leftPriority - rightPriority
}