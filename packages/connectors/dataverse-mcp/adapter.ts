import { randomUUID } from 'node:crypto'
import {
    type AgentCapability,
    type DataverseEntityMap,
    type GuardedQueryRequest,
    type McpEvidenceLineage,
    type ScopeRef
} from '../../common/index.js'
import {
    translateDataverseQuery,
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
        const arguments_ = translateDataverseQuery(
            this.options.entityMap,
            query,
            context.delegatedScope,
            this.maximumRows
        )
        const checkedAt = this.now().toISOString()
        const lineage: McpEvidenceLineage = {
            connector: 'dataverse-mcp',
            operation: 'read_query',
            toolCallId: this.createToolCallId()
        }

        try {
            const result = await this.options.broker.execute({
                correlationId: context.correlationId,
                serverId: 'dataverse',
                tool: 'read_query',
                capability: context.capability,
                scope: context.scope.kind,
                arguments: arguments_,
                ...(context.signal ? { signal: context.signal } : {})
            })
            if (result.kind !== 'untrusted-mcp-data') {
                throw new DataverseMcpAdapterError('malformed_response', 'Dataverse MCP result was not marked as untrusted data.')
            }
            const rows = extractRows(result.data)
            const records = mapRowsToCanonical(this.options.entityMap, query, rows)
            const truncated = result.truncated || records.length < result.recordCount
            return {
                state: truncated ? 'partial' : 'complete',
                records,
                recordCount: result.recordCount,
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
}

export class DataverseMcpAdapterError extends Error {
    constructor(readonly code: 'malformed_response', message: string) {
        super(message)
        this.name = 'DataverseMcpAdapterError'
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
        row[attribute.logicalName] ?? null
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