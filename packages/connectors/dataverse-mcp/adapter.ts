import { randomUUID } from 'node:crypto'
import {
    type AgentCapability,
    type DataverseEntityMap,
    type GuardedQueryRequest,
    type McpEvidenceLineage,
    type ScopeRef
} from '../../common/index.js'
import {
    renderDataverseSql,
    toSqlColumn,
    type DataverseDelegatedScope
} from './query-guard.js'

export type DataverseBrokerRequest = {
    correlationId: string
    serverId: 'dataverse'
    tool: 'read_query'
    capability: AgentCapability
    scope: ScopeRef['kind']
    arguments: Record<string, unknown>
    signal?: AbortSignal
}

export type DataverseBrokerResult = {
    kind: 'untrusted-mcp-data'
    data: unknown
    recordCount: number
    truncated: boolean
}

export interface DataverseToolBroker {
    execute(request: DataverseBrokerRequest): Promise<DataverseBrokerResult>
}

export type DataverseMcpQueryContext = {
    correlationId: string
    capability: AgentCapability
    scope: ScopeRef
    delegatedScope: DataverseDelegatedScope
    signal?: AbortSignal
}

export type DataverseMcpSourceHealth = {
    source: 'dataverse-mcp'
    state: 'live' | 'partial' | 'unauthorized' | 'unavailable'
    detail: string
    checkedAt: string
}

export type DataverseMcpQueryResult = {
    state: 'complete' | 'partial' | 'unauthorized'
    records: Array<Record<string, unknown>>
    recordCount: number
    truncated: boolean
    sourceHealth: DataverseMcpSourceHealth
    lineage: McpEvidenceLineage
}

export type DataverseMcpReadAdapterOptions = {
    entityMap: DataverseEntityMap
    broker: DataverseToolBroker
    maximumRows?: number
    now?: () => Date
    createToolCallId?: () => string
    // When false, omit the explicit delegated-scope IN predicate and trust the delegated token's row-level security.
    enforceDelegatedScope?: boolean
}

export class DataverseMcpReadAdapter {
    private readonly maximumRows: number
    private readonly now: () => Date
    private readonly createToolCallId: () => string

    constructor(private readonly options: DataverseMcpReadAdapterOptions) {
        this.maximumRows = options.maximumRows ?? 500
        this.now = options.now ?? (() => new Date())
        this.createToolCallId = options.createToolCallId ?? randomUUID
    }

    async query(
        query: GuardedQueryRequest,
        context: DataverseMcpQueryContext
    ): Promise<DataverseMcpQueryResult> {
        const checkedAt = this.now().toISOString()
        const lineage: McpEvidenceLineage = {
            connector: 'dataverse-mcp',
            operation: 'read_query',
            toolCallId: this.createToolCallId()
        }
        const target = Math.max(1, Math.min(query.top, this.maximumRows))

        try {
            if (target <= READ_QUERY_PER_CALL_LIMIT) {
                const page = await this.fetchPage(query, context, target)
                const truncated = page.recordCount > page.records.length
                return this.assembleResult(page.records, page.recordCount, truncated, checkedAt, lineage)
            }
            // The OOB Dataverse read_query caps each call at 20 rows and has no OFFSET, so page by primary id.
            const collected: Array<Record<string, unknown>> = []
            let lastId: string | undefined
            let exhausted = false
            while (collected.length < target && !exhausted) {
                const pageSize = Math.min(READ_QUERY_PER_CALL_LIMIT, target - collected.length)
                const pageQuery: GuardedQueryRequest = {
                    ...query,
                    orderBy: [{ field: 'id', direction: 'asc' }],
                    filter: lastId === undefined ? query.filter : [...query.filter, { field: 'id', operator: 'gt', value: lastId }],
                    top: pageSize
                }
                const page = await this.fetchPage(pageQuery, context, pageSize)
                collected.push(...page.records)
                const lastRecordId = page.records.at(-1)?.['id']
                if (page.records.length < pageSize || typeof lastRecordId !== 'string') exhausted = true
                else lastId = lastRecordId
            }
            const ordered = sortRecords(collected, query.orderBy).slice(0, target)
            return this.assembleResult(ordered, collected.length, !exhausted, checkedAt, lineage)
        } catch (error) {
            const code = errorCode(error)
            if (code === 'aborted' || (error instanceof Error && error.name === 'AbortError')) throw error
            if (isUnauthorizedCode(code)) {
                return failureResult('unauthorized', 'unauthorized', 'Dataverse MCP delegated authorization is unavailable.', checkedAt, lineage)
            }
            if (error instanceof DataverseMcpAdapterError) throw error
            return failureResult('partial', 'unavailable', 'Dataverse MCP data is temporarily unavailable.', checkedAt, lineage)
        }
    }

    private async fetchPage(
        query: GuardedQueryRequest,
        context: DataverseMcpQueryContext,
        maxRows: number
    ): Promise<{ records: Array<Record<string, unknown>>; recordCount: number }> {
        const querytext = renderDataverseSql(
            this.options.entityMap,
            query,
            context.delegatedScope,
            maxRows,
            { enforceScope: this.options.enforceDelegatedScope !== false }
        )
        const result = await this.options.broker.execute({
            correlationId: context.correlationId,
            serverId: 'dataverse',
            tool: 'read_query',
            capability: context.capability,
            scope: context.scope.kind,
            arguments: { querytext },
            ...(context.signal ? { signal: context.signal } : {})
        })
        if (result.kind !== 'untrusted-mcp-data') {
            throw new DataverseMcpAdapterError('malformed_response', 'Dataverse MCP result was not marked as untrusted data.')
        }
        assertNotMcpError(result.data)
        const records = mapRowsToCanonical(this.options.entityMap, query, extractRows(result.data))
        return { records, recordCount: result.recordCount }
    }

    private assembleResult(
        records: Array<Record<string, unknown>>,
        recordCount: number,
        truncated: boolean,
        checkedAt: string,
        lineage: McpEvidenceLineage
    ): DataverseMcpQueryResult {
        return {
            state: truncated ? 'partial' : 'complete',
            records,
            recordCount: Math.max(recordCount, records.length),
            truncated,
            sourceHealth: {
                source: 'dataverse-mcp',
                state: truncated ? 'partial' : 'live',
                detail: truncated
                    ? 'Dataverse MCP returned a row-limited delegated result.'
                    : 'Dataverse MCP returned delegated user-scoped data.',
                checkedAt
            },
            lineage
        }
    }
}

const READ_QUERY_PER_CALL_LIMIT = 20

function sortRecords(
    records: Array<Record<string, unknown>>,
    orderBy: GuardedQueryRequest['orderBy']
): Array<Record<string, unknown>> {
    if (orderBy.length === 0) return records
    return [...records].sort((left, right) => {
        for (const order of orderBy) {
            const comparison = compareOrderValues(left[order.field], right[order.field])
            if (comparison !== 0) return order.direction === 'asc' ? comparison : -comparison
        }
        return 0
    })
}

function compareOrderValues(left: unknown, right: unknown): number {
    if (left === right) return 0
    if (left === null || left === undefined) return 1
    if (right === null || right === undefined) return -1
    if ((typeof left === 'string' || typeof left === 'number') && (typeof right === 'string' || typeof right === 'number')) {
        return left < right ? -1 : left > right ? 1 : 0
    }
    return 0
}

export class DataverseMcpAdapterError extends Error {
    constructor(readonly code: 'malformed_response', message: string) {
        super(message)
        this.name = 'DataverseMcpAdapterError'
    }
}

function assertNotMcpError(value: unknown): void {
    if (isRecord(value) && value.isError === true) {
        const text = Array.isArray(value.content)
            ? value.content.map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : '')).join(' ').trim()
            : ''
        throw new DataverseMcpAdapterError('malformed_response', text || 'Dataverse MCP read_query returned an error.')
    }
}

function extractRows(value: unknown): Array<Record<string, unknown>> {
    if (typeof value === 'string') return extractRows(parseJson(value))
    if (Array.isArray(value)) return requireRows(value)
    if (!isRecord(value)) throw new DataverseMcpAdapterError('malformed_response', 'Dataverse MCP result has no record collection.')

    for (const key of ['rows', 'records', 'items', 'value']) {
        if (key in value) return requireRows(value[key])
    }
    if (Array.isArray(value.content)) {
        const textBlock = value.content.find((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
        if (isRecord(textBlock) && typeof textBlock.text === 'string') return extractRows(textBlock.text)
    }
    throw new DataverseMcpAdapterError('malformed_response', 'Dataverse MCP result has no record collection.')
}

function requireRows(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value) || value.some((row) => !isRecord(row))) {
        throw new DataverseMcpAdapterError('malformed_response', 'Dataverse MCP records are malformed.')
    }
    return value
}

function mapRowsToCanonical(
    entityMap: DataverseEntityMap,
    query: GuardedQueryRequest,
    rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
    const entity = entityMap.entities.find((candidate) => candidate.canonical === query.entity)
    if (!entity) throw new DataverseMcpAdapterError('malformed_response', 'Dataverse entity mapping disappeared after translation.')
    const selected = query.select.map((canonical) => {
        const attribute = entity.attributes.find((candidate) => candidate.canonical === canonical)
        if (!attribute) throw new DataverseMcpAdapterError('malformed_response', 'Dataverse field mapping disappeared after translation.')
        return attribute
    })
    return rows.map((row) => Object.fromEntries(selected.map((attribute) => [
        attribute.canonical,
        row[toSqlColumn(attribute.logicalName)] ?? row[attribute.logicalName] ?? null
    ])))
}

function failureResult(
    state: 'partial' | 'unauthorized',
    sourceState: 'unavailable' | 'unauthorized',
    detail: string,
    checkedAt: string,
    lineage: McpEvidenceLineage
): DataverseMcpQueryResult {
    return {
        state,
        records: [],
        recordCount: 0,
        truncated: false,
        sourceHealth: { source: 'dataverse-mcp', state: sourceState, detail, checkedAt },
        lineage
    }
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value)
    } catch {
        throw new DataverseMcpAdapterError('malformed_response', 'Dataverse MCP text content is not valid JSON.')
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorCode(error: unknown): string | undefined {
    return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

function isUnauthorizedCode(code: string | undefined): boolean {
    return code === 'unauthorized' || code === 'tool_denied' || code === 'capability_denied' ||
        code === 'scope_denied' || code === 'approval_required'
}