import type { WorkflowQueueItemView } from './view-types.js'

/** Lower rank = higher urgency. Unknown priorities sort last. */
export const PRIORITY_RANK: Readonly<Record<string, number>> = { P0: 0, P1: 1, P2: 2 }

export function priorityRank(priority: string): number {
    return PRIORITY_RANK[priority] ?? Number.MAX_SAFE_INTEGER
}

/** Severity class suffix used for badge coloring. */
export function priorityClass(priority: string): string {
    switch (priority) {
        case 'P0':
            return 'high'
        case 'P1':
            return 'medium'
        case 'P2':
            return 'low'
        default:
            return 'unknown'
    }
}

export interface QueueGroup {
    key: string
    accountId?: string
    opportunityId?: string
    accountName: string
    opportunityName?: string
    items: WorkflowQueueItemView[]
    topRank: number
    highPriorityCount: number
}

export interface QueueNameResolvers {
    accountName: (accountId?: string) => string
    opportunityName: (opportunityId?: string) => string | undefined
}

/**
 * Groups queue items under Account > Opportunity, sorts items by priority then title within
 * each group, and orders groups by their most urgent item. Items without an opportunity are
 * grouped per account under a "Portfolio-level" bucket.
 */
export function groupQueueByOpportunity(
    items: readonly WorkflowQueueItemView[],
    resolvers: QueueNameResolvers
): QueueGroup[] {
    const groups = new Map<string, QueueGroup>()
    for (const item of items) {
        const key = `${item.accountId ?? 'none'}::${item.opportunityId ?? 'none'}`
        const existing = groups.get(key)
        if (existing) {
            existing.items.push(item)
            continue
        }
        const opportunityName = resolvers.opportunityName(item.opportunityId)
        const group: QueueGroup = {
            key,
            accountName: resolvers.accountName(item.accountId),
            items: [item],
            topRank: Number.MAX_SAFE_INTEGER,
            highPriorityCount: 0
        }
        if (item.accountId) group.accountId = item.accountId
        if (item.opportunityId) group.opportunityId = item.opportunityId
        if (opportunityName) group.opportunityName = opportunityName
        groups.set(key, group)
    }

    for (const group of groups.values()) {
        group.items.sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.title.localeCompare(right.title))
        group.topRank = group.items.reduce((min, item) => Math.min(min, priorityRank(item.priority)), Number.MAX_SAFE_INTEGER)
        group.highPriorityCount = group.items.filter((item) => priorityRank(item.priority) === 0).length
    }

    return [...groups.values()].sort((left, right) =>
        left.topRank - right.topRank ||
        left.accountName.localeCompare(right.accountName) ||
        (left.opportunityName ?? '').localeCompare(right.opportunityName ?? ''))
}

export function highPriorityCount(items: readonly WorkflowQueueItemView[]): number {
    return items.filter((item) => priorityRank(item.priority) === 0).length
}
