import {
    measurePerformance,
    type GuardedQueryRequest,
    type PerformanceReporter,
    type WorkflowResultCard
} from '../../common/index.js'
import type {
    DataverseDelegatedScope,
    DataverseMcpReadAdapter
} from '../../connectors/dataverse-mcp/index.js'
import type { MsxReadConnector, MsxReadResult } from '../../connectors/msx-mcp/index.js'
import {
    initialWorkflowIds,
    initialWorkflowOutputSchema,
    parseInitialWorkflowInput,
    type InitialWorkflowId,
    type InitialWorkflowInput,
    type InitialWorkflowOutput,
    type WorkflowQueueItem
} from './cohort.js'
import type {
    WorkflowConnectorExecutionContext,
    WorkflowConnectorExecutor,
    WorkflowConnectorResult,
    WorkflowResultAssembler
} from './runtime.js'
import { aggregateResultCard, ownerWorkloadQueue } from './aggregate-results.js'

type DataverseReader = Pick<DataverseMcpReadAdapter, 'query'>
type ResolveDelegatedScope = (
    scope: WorkflowConnectorExecutionContext['scope']
) => DataverseDelegatedScope | Promise<DataverseDelegatedScope>

export class InitialWorkflowConnectorExecutor implements WorkflowConnectorExecutor {
    constructor(
        private readonly dataverse: DataverseReader,
        private readonly msx: MsxReadConnector,
        private readonly resolveDelegatedScope: ResolveDelegatedScope,
        private readonly performanceReporter?: PerformanceReporter
    ) { }

    async execute(
        step: Parameters<WorkflowConnectorExecutor['execute']>[0],
        context: WorkflowConnectorExecutionContext
    ): Promise<WorkflowConnectorResult> {
        const workflowId = requireInitialWorkflowId(context.workflowId)
        const input = parseInitialWorkflowInput(workflowId, context.input)
        if (step.connector === 'dataverse-mcp') {
            const onProgress = context.onProgress
            const queryContext = {
                correlationId: context.correlationId,
                capability: 'account-pulse' as const,
                scope: context.scope,
                delegatedScope: await measurePerformance('plays.scope', this.performanceReporter, async () => this.resolveDelegatedScope(context.scope)),
                signal: context.signal,
                ...(onProgress ? { onProgress: (progress: Awaited<ReturnType<DataverseReader['query']>>) => onProgress({
                    state: progress.state, data: progress.records, rowCount: progress.recordCount, truncated: progress.truncated,
                    lineage: progress.lineage, sourceHealth: progress.sourceHealth
                }) } : {})
            }
            const result = await this.dataverse.query(buildInitialWorkflowQuery(workflowId, input), queryContext)
            return {
                state: result.state,
                data: result.records,
                rowCount: result.recordCount,
                truncated: result.truncated,
                lineage: result.lineage,
                sourceHealth: result.sourceHealth
            }
        }

        const msxContext = {
            correlationId: context.correlationId,
            capability: 'account-pulse' as const,
            signal: context.signal
        }
        const result = step.operation === 'get_forecast_snapshot'
            ? await this.msx.getForecastSnapshot({}, msxContext)
            : await this.msx.listPipeline({}, msxContext)
        return fromMsxResult(result)
    }

}

const opportunityProjection: GuardedQueryRequest['expand'] = [{ relationship: 'opportunity', select: ['accountId', 'name'] }]

export class InitialWorkflowResultAssembler implements WorkflowResultAssembler {
    assemble(context: Parameters<WorkflowResultAssembler['assemble']>[0]): InitialWorkflowOutput {
        const workflowId = requireInitialWorkflowId(context.definition.id)
        const input = parseInitialWorkflowInput(workflowId, context.input)
        const records = reconcileRecords(
            rows(context.steps.find(({ connector }) => connector === 'dataverse-mcp')?.data),
            rows(context.steps.find(({ connector }) => connector === 'msx-mcp')?.data)
        )
        const ordered = [...records].sort(compareRecords)
        const lineage = context.steps.flatMap((step) => step.lineage ? [step.lineage] : [])
        const sourceHealth = context.steps.flatMap((step) => step.sourceHealth ? [step.sourceHealth] : [])
        const evidenceIds = lineage.map(({ toolCallId }) => toolCallId)
        const queueItems = buildQueueItems(workflowId, ordered, input, evidenceIds)
        return initialWorkflowOutputSchema.parse({
            contractVersion: '2.0',
            workflowId,
            generatedAt: context.generatedAt,
            scope: context.scope,
            card: buildCard(workflowId, context.definition.name, ordered, queueItems, evidenceIds),
            queueItems,
            projection: {
                records: ordered.map((record, index) => {
                    const kind = milestoneWorkflows.has(workflowId) ? 'milestone' as const
                        : activityWorkflows.has(workflowId) ? 'activity' as const : 'opportunity' as const
                    const opportunityId = kind === 'opportunity' ? text(record.id) : text(record.opportunityId)
                    return {
                        recordId: text(record.id) ?? String(index + 1), kind, cardIndex: index,
                        ...(opportunityId ? { opportunityId } : {}),
                        ...(text(record.accountId) ? { accountId: text(record.accountId) } : {}),
                        ...(kind === 'milestone' && text(record.id) ? { milestoneId: text(record.id) } : {}),
                        ...(workflowId !== 'WF-009' && queueItems[index] ? { queueItemId: queueItems[index]!.id } : {}),
                        ...(text(record.ownerId) ? { ownerId: text(record.ownerId) } : {}),
                        ...(text(record.opportunityOwnerName) ? { ownerName: text(record.opportunityOwnerName) } : {})
                    }
                }),
                ...(input.maximumActiveItems !== undefined ? { maximumActiveItems: input.maximumActiveItems } : {})
            },
            lineage,
            sourceHealth
        })
    }
}

export function buildInitialWorkflowQuery(workflowId: InitialWorkflowId, input: InitialWorkflowInput): GuardedQueryRequest {
    switch (workflowId) {
        case 'WF-001':
            return {
                entity: 'opportunity', select: ['id', 'accountId', 'name', 'closeDate'],
                filter: [{ field: 'closeDate', operator: 'on-or-before', value: subtractDays(input.asOf, input.staleAfterDays ?? 30) }],
                orderBy: [{ field: 'closeDate', direction: 'asc' }], top: 500, expand: []
            }
        case 'WF-002':
            return milestoneQuery(input.asOf, [{ field: 'status', operator: 'ne', value: 'Completed' }])
        case 'WF-003':
            return milestoneQuery(input.asOf, [{ field: 'status', operator: 'ne', value: 'Completed' }])
        case 'WF-005':
            return milestoneQuery(input.asOf, [{ field: 'status', operator: 'in', value: ['At Risk', 'Blocked'] }])
        case 'WF-006':
            return {
                entity: 'opportunity', select: ['id', 'accountId', 'name', 'closeDate'], filter: [],
                orderBy: [{ field: 'closeDate', direction: 'asc' }], top: 500, expand: []
            }
        case 'WF-007':
            return {
                entity: 'activity', select: ['id', 'opportunityId', 'subject', 'ownerId', 'dueDate', 'status'],
                filter: [
                    { field: 'dueDate', operator: 'on-or-after', value: input.asOf },
                    { field: 'dueDate', operator: 'on-or-before', value: addDays(input.asOf, input.meetingWindowDays ?? 14) }
                ],
                orderBy: [{ field: 'dueDate', direction: 'asc' }], top: 500, expand: opportunityProjection
            }
        case 'WF-009':
            return {
                entity: 'opportunity', select: ['id', 'accountId', 'name', 'ownerId', 'closeDate'], filter: [],
                orderBy: [{ field: 'ownerId', direction: 'asc' }, { field: 'closeDate', direction: 'asc' }], top: 500, expand: []
            }
        case 'WF-010':
            return {
                entity: 'activity', select: ['id', 'opportunityId', 'subject', 'ownerId', 'dueDate', 'status'],
                filter: [
                    { field: 'dueDate', operator: 'on-or-before', value: subtractDays(input.asOf, input.followUpAfterDays ?? 14) },
                    { field: 'status', operator: 'ne', value: 'Completed' }
                ],
                orderBy: [{ field: 'dueDate', direction: 'asc' }], top: 500, expand: opportunityProjection
            }
        case 'WF-012':
            return milestoneQuery(input.asOf, [])
        case 'WF-004':
        case 'WF-008':
            return {
                entity: 'opportunity', select: ['id', 'accountId', 'name', 'closeDate'], filter: [],
                orderBy: [{ field: 'closeDate', direction: 'asc' }], top: 500, expand: []
            }
        case 'WF-011':
            return {
                entity: 'opportunity', select: ['id', 'accountId', 'name', 'closeDate'], filter: [],
                orderBy: [{ field: 'accountId', direction: 'asc' }, { field: 'closeDate', direction: 'asc' }], top: 500, expand: []
            }
    }
}

function milestoneQuery(asOf: string, extraFilters: GuardedQueryRequest['filter']): GuardedQueryRequest {
    return {
        entity: 'engagementMilestone', select: ['id', 'opportunityId', 'name', 'status', 'targetDate'],
        filter: [{ field: 'targetDate', operator: 'on-or-before', value: asOf }, ...extraFilters],
        orderBy: [{ field: 'targetDate', direction: 'asc' }], top: 500, expand: opportunityProjection
    }
}

function buildCard(
    workflowId: InitialWorkflowId,
    title: string,
    records: Array<Record<string, unknown>>,
    queueItems: WorkflowQueueItem[],
    evidenceIds: string[]
): WorkflowResultCard {
    if (workflowId === 'WF-003' || workflowId === 'WF-005') {
        return {
            kind: 'exception-list', title, evidenceIds,
            exceptions: queueItems.map((item) => ({
                id: item.id, title: item.title, priority: item.priority,
                detail: `${workflowId === 'WF-003' ? 'Recorded stage and available evidence require review' : 'Status requires governance review'}${item.dueDate ? `; due ${item.dueDate}` : ''}.`,
                evidenceIds: item.evidenceIds
            }))
        }
    }
    if (workflowId === 'WF-002' || workflowId === 'WF-004' || workflowId === 'WF-010' || workflowId === 'WF-012') {
        return {
            kind: 'action-list', title, evidenceIds,
            actions: queueItems.map((item) => ({ id: item.id, label: item.title, priority: item.priority }))
        }
    }
    if (workflowId === 'WF-009' || workflowId === 'WF-008') return aggregateResultCard(
        workflowId, title, records.map((record) => ({ ...(text(record.accountId) ? { accountId: text(record.accountId) } : {}) })),
        queueItems.length, evidenceIds
    )
    const columns = workflowId === 'WF-007'
        ? ['id', 'opportunityId', 'subject', 'ownerId', 'dueDate', 'status']
        : workflowId === 'WF-001'
            ? ['id', 'accountId', 'name', 'closeDate']
            : ['id', 'accountId', 'name', 'closeDate']
    return { kind: 'record-table', title, evidenceIds, columns, rows: records.map((record) => primitiveRow(record, columns)) }
}

function buildQueueItems(
    workflowId: InitialWorkflowId,
    records: Array<Record<string, unknown>>,
    input: InitialWorkflowInput,
    evidenceIds: string[]
): WorkflowQueueItem[] {
    if (workflowId === 'WF-009') {
        return ownerWorkloadQueue(records.map((record) => ({
            ...(text(record.ownerId) ? { ownerId: text(record.ownerId) } : {}),
            ...(text(record.opportunityOwnerName) ? { ownerName: text(record.opportunityOwnerName) } : {})
        })), input.maximumActiveItems ?? 20, evidenceIds)
    }
    return records.map((record, index) => {
        const recordId = text(record.id) ?? `${index + 1}`
        const dueDate = date(record.targetDate) ?? date(record.dueDate) ?? date(record.closeDate)
        const opportunityId = text(record.opportunityId) ?? (opportunityScopedWorkflows.has(workflowId) ? text(record.id) : undefined)
        const opportunityName = text(record.opportunityName)
            ?? (opportunityScopedWorkflows.has(workflowId) ? text(record.name) : undefined)
        const owner = queueOwnerName(workflowId, record)
        return {
            id: `${workflowId}:${recordId}`,
            workflowId,
            priority: (workflowId === 'WF-003' && Number(record.recordedStage ?? 0) >= 4) || (workflowId === 'WF-005' && record.status === 'Blocked') ? 'P0' : 'P1',
            title: queueTitle(workflowId, record),
            ...(owner ? { owner } : {}),
            ...(text(record.accountId) ? { accountId: text(record.accountId) } : {}),
            ...(text(record.accountName) ? { accountName: text(record.accountName) } : {}),
            ...(opportunityId ? { opportunityId } : {}),
            ...(opportunityName ? { opportunityName } : {}),
            ...(dueDate ? { dueDate } : {}),
            evidenceIds,
            status: 'new' as const
        }
    })
}

// Opportunity-entity workflows surface the row id as the opportunity id so queue items can hand off to guidance.
const opportunityScopedWorkflows = new Set<InitialWorkflowId>(['WF-001', 'WF-004', 'WF-006', 'WF-008', 'WF-011'])
const milestoneWorkflows = new Set<InitialWorkflowId>(['WF-002', 'WF-003', 'WF-005', 'WF-012'])
const activityWorkflows = new Set<InitialWorkflowId>(['WF-007', 'WF-010'])

function queueOwnerName(workflowId: InitialWorkflowId, record: Record<string, unknown>): string | undefined {
    return text(record.owner)
        ?? (opportunityScopedWorkflows.has(workflowId) ? text(record.opportunityOwnerName) : undefined)
        ?? (text(record.ownerId) ? 'Owner name unavailable' : undefined)
}

function queueTitle(workflowId: InitialWorkflowId, record: Record<string, unknown>): string {
    const label = text(record.name) ?? text(record.subject) ?? 'Untitled record'
    const prefix: Record<Exclude<InitialWorkflowId, 'WF-009'>, string> = {
        'WF-001': 'Review stale opportunity',
        'WF-002': 'Triage overdue milestone',
        'WF-003': 'Review stage evidence',
        'WF-004': 'Map stakeholders for',
        'WF-005': 'Review governance exception',
        'WF-006': 'Review commit risk',
        'WF-007': 'Prepare for next meeting',
        'WF-008': 'Review concentration exposure',
        'WF-010': 'Complete overdue follow-up',
        'WF-011': 'Review opportunity dependencies',
        'WF-012': 'Assemble stage exit evidence'
    }
    return `${prefix[workflowId as Exclude<InitialWorkflowId, 'WF-009'>]}: ${label}`
}

function fromMsxResult(result: MsxReadResult<unknown>): WorkflowConnectorResult {
    return {
        state: result.state,
        data: result.data,
        rowCount: result.rowCount,
        truncated: result.truncated,
        ...(result.lineage ? { lineage: result.lineage } : {}),
        sourceHealth: result.sourceHealth
    }
}

function requireInitialWorkflowId(value: string): InitialWorkflowId {
    if (!initialWorkflowIds.some((id) => id === value)) throw new Error(`Unsupported initial workflow: ${value}`)
    return value as InitialWorkflowId
}

function rows(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
        ? value.filter((record): record is Record<string, unknown> => typeof record === 'object' && record !== null && !Array.isArray(record))
        : []
}

const curatedOpportunityFields = [
    'recordedStage', 'value', 'currency', 'closeDate', 'comments', 'forecastCategory', 'probability'
] as const

function reconcileRecords(
    dataverseRecords: Array<Record<string, unknown>>,
    msxRecords: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
    const base = deduplicate(dataverseRecords, (record) => text(record.id))
    const enrichment = new Map(
        deduplicate(msxRecords, (record) => text(record.id)).map((record) => [text(record.id)!, record])
    )
    return base.map((record) => {
        const matchId = text(record.opportunityId) ?? text(record.id)
        const curated = matchId ? enrichment.get(matchId) : undefined
        if (!curated) return record
        const merged = { ...record }
        for (const field of curatedOpportunityFields) {
            const value = curated[field]
            if (value !== undefined && value !== null && value !== '') merged[field] = value
        }
        if (text(curated.name)) merged.opportunityName = curated.name
        if (text(curated.owner)) merged.opportunityOwnerName = curated.owner
        if (!text(merged.accountId) && text(curated.accountId)) merged.accountId = curated.accountId
        if (!text(merged.accountName) && text(curated.accountName)) merged.accountName = curated.accountName
        return merged
    })
}

function deduplicate(
    records: Array<Record<string, unknown>>,
    keyOf: (record: Record<string, unknown>) => string | undefined
): Array<Record<string, unknown>> {
    const unique = new Map<string, Record<string, unknown>>()
    for (const record of [...records].sort((left, right) => stableRecord(left).localeCompare(stableRecord(right)))) {
        const key = keyOf(record)
        if (key && !unique.has(key)) unique.set(key, record)
    }
    return [...unique.values()]
}

function stableRecord(record: Record<string, unknown>): string {
    return JSON.stringify(Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right))))
}

function compareRecords(left: Record<string, unknown>, right: Record<string, unknown>): number {
    for (const field of ['targetDate', 'dueDate', 'closeDate', 'id']) {
        const comparison = String(left[field] ?? '').localeCompare(String(right[field] ?? ''))
        if (comparison !== 0) return comparison
    }
    return 0
}

function primitiveRow(record: Record<string, unknown>, columns: string[]): Record<string, string | number | boolean | null> {
    return Object.fromEntries(columns.map((column) => {
        const value = record[column]
        return [column, typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null]
    }))
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

function date(value: unknown): string | undefined {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

function subtractDays(value: string, days: number): string {
    const result = new Date(`${value}T00:00:00.000Z`)
    result.setUTCDate(result.getUTCDate() - days)
    return result.toISOString().slice(0, 10)
}

function addDays(value: string, days: number): string {
    const result = new Date(`${value}T00:00:00.000Z`)
    result.setUTCDate(result.getUTCDate() + days)
    return result.toISOString().slice(0, 10)
}