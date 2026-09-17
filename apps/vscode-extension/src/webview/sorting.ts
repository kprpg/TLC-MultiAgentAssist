import type { MilestoneView, OpportunityView } from './view-types.js'

export type OpportunitySort = 'closeDate' | 'stage' | 'value'
export type MilestoneSort = 'targetDate' | 'estimatedMonthlyUsage' | 'commitment' | 'status'
export type SortDirection = 'ascending' | 'descending'

export function sortOpportunities(opportunities: readonly OpportunityView[], sortBy: OpportunitySort, direction: SortDirection): OpportunityView[] {
    return [...opportunities].sort((left, right) => {
        const difference = sortBy === 'closeDate'
            ? compare(left.closeDate, right.closeDate, direction)
            : sortBy === 'stage'
                ? (direction === 'ascending' ? left.recordedStage - right.recordedStage : right.recordedStage - left.recordedStage)
                : compare(left.value, right.value, direction)
        return difference || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    })
}

const statusPriority = new Map([
    'On Track', 'At Risk', 'Blocked', 'Completed', 'Cancelled', 'Lost to Competitor', 'Hygiene/Duplicate'
].map((status, index) => [status.toLocaleLowerCase(), index]))

export function sortMilestones(milestones: readonly MilestoneView[], sortBy: MilestoneSort, direction: SortDirection): MilestoneView[] {
    return [...milestones].sort((left, right) => {
        const difference = sortBy === 'targetDate'
            ? compareOptional(left.targetDate, right.targetDate, direction)
            : sortBy === 'estimatedMonthlyUsage'
                ? compareOptional(left.estimatedMonthlyUsage, right.estimatedMonthlyUsage, direction)
                : sortBy === 'commitment'
                    ? compareCommitment(left.commitment, right.commitment)
                    : compareStatus(left.status, right.status)
        return difference || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    })
}

function compare(left: number | string, right: number | string, direction: SortDirection): number {
    const difference = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right))
    return direction === 'ascending' ? difference : -difference
}

function compareOptional<T extends number | string>(left: T | undefined, right: T | undefined, direction: SortDirection): number {
    if (left === undefined) return right === undefined ? 0 : 1
    if (right === undefined) return -1
    return compare(left, right, direction)
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
