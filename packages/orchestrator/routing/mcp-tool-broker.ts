import {
    mcpServerRegistrySchema,
    mcpToolPolicySchema,
    type AgentCapability,
    type McpScopeKind,
    type McpServerId,
    type McpServerRegistry,
    type McpToolPolicy
} from '../../common/index.js'
import {
    authorizeMcpTool,
    McpToolAuthorizationError,
    type McpToolApproval
} from '../policies/mcp-tool-authorization.js'

export type McpToolBrokerRequest = {
    correlationId: string
    serverId: McpServerId
    tool: string
    capability: AgentCapability
    scope: McpScopeKind
    arguments: Record<string, unknown>
    approval?: McpToolApproval
    toolAnnotations?: Readonly<Record<string, unknown>>
    signal?: AbortSignal
}

export type McpToolBrokerResult = {
    kind: 'untrusted-mcp-data'
    data: unknown
    recordCount: number
    truncated: boolean
}

export type McpInvocationJournalEntry = {
    correlationId: string
    serverId: McpServerId
    tool: string
    capability: AgentCapability
    scope: McpScopeKind
    outcome: 'success' | 'denied' | 'failed'
    durationMs: number
    recordCount: number
    truncated: boolean
    occurredAt: string
    failureCode?: string
}

export type McpToolInvoker = (
    serverId: McpServerId,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
) => Promise<unknown>

export type McpToolBrokerOptions = {
    registry: McpServerRegistry
    policy: McpToolPolicy
    invokeTool: McpToolInvoker
    now?: () => number
    maxJournalEntries?: number
}

type SanitizeStats = {
    recordCount: number
    truncated: boolean
}

const recordArrayKeys = new Set(['items', 'records', 'rows', 'value'])

export class McpToolBroker {
    private readonly registry: McpServerRegistry
    private readonly policy: McpToolPolicy
    private readonly invokeTool: McpToolInvoker
    private readonly now: () => number
    private readonly maxJournalEntries: number
    private readonly journal: McpInvocationJournalEntry[] = []
    private readonly rateWindows = new Map<string, number[]>()
    private readonly requestCallCounts = new Map<string, number>()

    constructor(options: McpToolBrokerOptions) {
        this.registry = mcpServerRegistrySchema.parse(options.registry)
        this.policy = mcpToolPolicySchema.parse(options.policy)
        this.invokeTool = options.invokeTool
        this.now = options.now ?? Date.now
        this.maxJournalEntries = options.maxJournalEntries ?? 1_000
        if (!Number.isInteger(this.maxJournalEntries) || this.maxJournalEntries < 1) {
            throw new Error('MCP invocation journal capacity must be a positive integer.')
        }
    }

    async execute(request: McpToolBrokerRequest): Promise<McpToolBrokerResult> {
        const startedAt = this.now()
        let recordCount = 0
        let truncated = false
        let outcome: McpInvocationJournalEntry['outcome'] = 'failed'
        let failureCode: string | undefined

        try {
            const server = this.registry.servers.find((candidate) => candidate.id === request.serverId)
            if (!server?.enabled) {
                throw new McpToolAuthorizationError('tool_denied', 'MCP server invocation is not allowed.')
            }
            const entry = authorizeMcpTool(this.policy, request)
            this.consumeRequestBudget(request.correlationId, server.limits.maxToolCallsPerRequest)
            this.consumeRateBudget(request.serverId, request.tool, entry.rateLimitPerMinute)

            const rawResult = await this.invokeTool(
                request.serverId,
                request.tool,
                request.arguments,
                request.signal
            )
            const stats: SanitizeStats = { recordCount: 0, truncated: false }
            const maxRows = Math.min(entry.maxRows ?? server.limits.maxRowsPerCall, server.limits.maxRowsPerCall)
            const redactedFields = new Set(entry.redactFields.map((field) => field.toLowerCase()))
            const data = sanitizeValue(rawResult, redactedFields, maxRows, stats)
            recordCount = stats.recordCount
            truncated = stats.truncated
            outcome = 'success'
            return { kind: 'untrusted-mcp-data', data, recordCount, truncated }
        } catch (error) {
            outcome = error instanceof McpToolAuthorizationError ? 'denied' : 'failed'
            failureCode = getFailureCode(error)
            throw error
        } finally {
            this.appendJournal({
                correlationId: request.correlationId,
                serverId: request.serverId,
                tool: request.tool,
                capability: request.capability,
                scope: request.scope,
                outcome,
                durationMs: Math.max(0, this.now() - startedAt),
                recordCount,
                truncated,
                occurredAt: new Date(this.now()).toISOString(),
                ...(failureCode ? { failureCode } : {})
            })
        }
    }

    completeRequest(correlationId: string): void {
        this.requestCallCounts.delete(correlationId)
    }

    getJournal(): readonly McpInvocationJournalEntry[] {
        return this.journal.map((entry) => ({ ...entry }))
    }

    private consumeRequestBudget(correlationId: string, maximum: number): void {
        const nextCount = (this.requestCallCounts.get(correlationId) ?? 0) + 1
        if (nextCount > maximum) {
            throw new McpToolAuthorizationError('tool_denied', 'MCP tool-call limit exceeded for this request.')
        }
        this.requestCallCounts.set(correlationId, nextCount)
    }

    private consumeRateBudget(serverId: McpServerId, tool: string, maximum: number | undefined): void {
        if (maximum === undefined) return
        const key = `${serverId}:${tool}`
        const cutoff = this.now() - 60_000
        const timestamps = (this.rateWindows.get(key) ?? []).filter((timestamp) => timestamp > cutoff)
        if (timestamps.length >= maximum) {
            throw new McpToolAuthorizationError('tool_denied', 'MCP tool rate limit exceeded.')
        }
        timestamps.push(this.now())
        this.rateWindows.set(key, timestamps)
    }

    private appendJournal(entry: McpInvocationJournalEntry): void {
        this.journal.push(entry)
        if (this.journal.length > this.maxJournalEntries) {
            this.journal.splice(0, this.journal.length - this.maxJournalEntries)
        }
    }
}

function sanitizeValue(
    value: unknown,
    redactedFields: ReadonlySet<string>,
    maxRows: number,
    stats: SanitizeStats,
    key?: string
): unknown {
    if (typeof value === 'string') {
        const parsed = tryParseJson(value)
        return parsed === undefined
            ? value
            : JSON.stringify(sanitizeValue(parsed, redactedFields, maxRows, stats))
    }
    if (Array.isArray(value)) {
        const isRecordArray = key === undefined || recordArrayKeys.has(key.toLowerCase())
        if (isRecordArray) {
            stats.recordCount = Math.max(stats.recordCount, value.length)
            stats.truncated ||= value.length > maxRows
        }
        const limited = isRecordArray ? value.slice(0, maxRows) : value
        return limited.map((item) => sanitizeValue(item, redactedFields, maxRows, stats))
    }
    if (value === null || typeof value !== 'object') return value

    return Object.fromEntries(Object.entries(value).map(([field, fieldValue]) => [
        field,
        redactedFields.has(field.toLowerCase())
            ? '[REDACTED]'
            : sanitizeValue(fieldValue, redactedFields, maxRows, stats, field)
    ]))
}

function tryParseJson(value: string): unknown | undefined {
    const trimmed = value.trim()
    if ((!trimmed.startsWith('{') || !trimmed.endsWith('}')) &&
        (!trimmed.startsWith('[') || !trimmed.endsWith(']'))) return undefined
    try {
        return JSON.parse(trimmed)
    } catch {
        return undefined
    }
}

function getFailureCode(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
        return error.code
    }
    return 'unknown'
}