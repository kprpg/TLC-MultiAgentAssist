import type { WorkflowQueueItemView, WorkflowResultCardView } from './view-types.js'

/** Matches a canonical GUID so opaque record ids are never surfaced as display labels. */
const GUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

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
    accountName: (accountId?: string) => string | undefined
    opportunityName: (opportunityId?: string) => string | undefined
    /** Resolves the parent account of an opportunity for items that only carry an opportunity id. */
    accountForOpportunity?: (opportunityId?: string) => { id?: string; name?: string } | undefined
}

interface WorkflowDefinitionLike {
    id: string
    category: string
}

export interface PlaySection<T extends WorkflowDefinitionLike> {
    key: string
    category: string
    definitions: T[]
}

export function sectionPlaysByWorkflowNumber<T extends WorkflowDefinitionLike>(definitions: readonly T[]): PlaySection<T>[] {
    const sorted = [...definitions].sort((left, right) => compareWorkflowIds(left.id, right.id))
    const sections: PlaySection<T>[] = []
    for (const definition of sorted) {
        const current = sections.at(-1)
        if (current?.category === definition.category) {
            current.definitions.push(definition)
        } else {
            sections.push({
                key: `${definition.category}:${definition.id}`,
                category: definition.category,
                definitions: [definition]
            })
        }
    }
    return sections
}

function compareWorkflowIds(left: string, right: string): number {
    const leftNumber = workflowNumber(left)
    const rightNumber = workflowNumber(right)
    if (leftNumber !== undefined && rightNumber !== undefined && leftNumber !== rightNumber) {
        return leftNumber - rightNumber
    }
    if (leftNumber !== undefined && rightNumber === undefined) return -1
    if (leftNumber === undefined && rightNumber !== undefined) return 1
    return left.localeCompare(right)
}

function workflowNumber(id: string): number | undefined {
    const match = /^WF-(\d+)$/i.exec(id)
    return match ? Number(match[1]) : undefined
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
        const resolvedAccount = resolvers.accountForOpportunity?.(item.opportunityId)
        const accountId = item.accountId ?? resolvedAccount?.id
        const accountName = descriptiveName(item.accountName)
            ?? descriptiveName(resolvers.accountName(item.accountId))
            ?? descriptiveName(resolvedAccount?.name)
            ?? (accountId ? 'Account name unavailable' : 'Unassigned account')
        const opportunityName = descriptiveName(item.opportunityName)
            ?? descriptiveName(resolvers.opportunityName(item.opportunityId))
        const group: QueueGroup = {
            key,
            accountName,
            items: [item],
            topRank: Number.MAX_SAFE_INTEGER,
            highPriorityCount: 0
        }
        if (accountId) group.accountId = accountId
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

function descriptiveName(value: string | undefined): string | undefined {
    const candidate = value?.trim()
    if (!candidate || GUID_PATTERN.test(candidate)) {
        return undefined
    }
    return candidate
}

/** Friendly, user-facing header labels for canonical record-table columns. */
const RECORD_COLUMN_LABELS: Readonly<Record<string, string>> = {
    accountId: 'Account',
    opportunityId: 'Opportunity',
    name: 'Opportunity',
    subject: 'Subject',
    closeDate: 'Close date',
    dueDate: 'Due date',
    targetDate: 'Target date',
    status: 'Status'
}

/** Opaque owner GUID columns that carry no user value in a record table. */
const DROPPED_RECORD_COLUMNS: ReadonlySet<string> = new Set(['ownerId'])

/**
 * Rewrites a record-table card for display: drops opaque id/owner GUID columns, resolves account
 * and opportunity ids to their descriptive names, and applies friendly column headers. Non-table
 * cards (metric strips, action/exception lists) are returned unchanged.
 */
export function humanizeResultCard(card: WorkflowResultCardView, resolvers: QueueNameResolvers): WorkflowResultCardView {
    if (!card.columns || !card.rows || card.rows.length === 0) return card
    const hasDescriptiveName = card.columns.includes('name') || card.columns.includes('subject')
    const columns = card.columns.filter((column) =>
        !DROPPED_RECORD_COLUMNS.has(column) && !(column === 'id' && hasDescriptiveName))
    const rows = card.rows.map((row) => {
        const mapped: Record<string, unknown> = {}
        for (const column of columns) mapped[column] = humanizeRecordCell(column, row[column], resolvers)
        return mapped
    })
    const columnLabels = Object.fromEntries(columns.map((column) => [column, RECORD_COLUMN_LABELS[column] ?? column]))
    return { ...card, columns, rows, columnLabels }
}

function humanizeRecordCell(column: string, value: unknown, resolvers: QueueNameResolvers): unknown {
    if (value === null || value === undefined || value === '') return value
    const raw = String(value)
    if (column === 'accountId') return descriptiveOrFallback(resolvers.accountName(raw), raw, 'Account name unavailable')
    if (column === 'opportunityId') return descriptiveOrFallback(resolvers.opportunityName(raw), raw, 'Opportunity name unavailable')
    return value
}

function descriptiveOrFallback(resolved: string | undefined, raw: string, unavailable: string): string {
    const candidate = descriptiveName(resolved)
    if (candidate) return candidate
    return GUID_PATTERN.test(raw) ? unavailable : raw
}

export function highPriorityCount(items: readonly WorkflowQueueItemView[]): number {
    return items.filter((item) => priorityRank(item.priority) === 0).length
}
