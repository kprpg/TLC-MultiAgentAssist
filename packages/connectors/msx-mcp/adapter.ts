import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
    accountSchema,
    milestoneSchema,
    opportunitySchema,
    scopeRefSchema,
    type AgentCapability,
    type McpEvidenceLineage,
    type ScopeRef,
    type SourceHealth
} from '../../common/index.js'

export type MsxBrokerRequest = {
    correlationId: string
    serverId: 'msx'
    tool: string
    capability: AgentCapability
    scope: ScopeRef['kind']
    arguments: Record<string, unknown>
    signal?: AbortSignal
}

export type MsxBrokerResult = {
    kind: 'untrusted-mcp-data'
    data: unknown
    recordCount: number
    truncated: boolean
}

export interface MsxToolBroker {
    execute(request: MsxBrokerRequest): Promise<MsxBrokerResult>
}

const stakeholderSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    role: z.string().min(1),
    influence: z.enum(['high', 'medium', 'low']),
    lastTouchAt: z.string().datetime().optional()
}).strict()

const activitySchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['appointment', 'phone-call', 'email', 'task']),
    subject: z.string().min(1),
    occurredAt: z.string().datetime(),
    owner: z.string().min(1).optional()
}).strict()

const pipelineRowSchema = opportunitySchema.extend({
    forecastCategory: z.string().min(1).optional(),
    probability: z.number().min(0).max(100).optional()
}).strict()

const opportunity360Schema = z.object({
    opportunity: opportunitySchema,
    milestones: z.array(milestoneSchema),
    stakeholders: z.array(stakeholderSchema),
    activities: z.array(activitySchema),
    competitors: z.array(z.string().min(1)),
    products: z.array(z.string().min(1))
}).strict()

const account360Schema = z.object({
    account: accountSchema,
    opportunities: z.array(opportunitySchema),
    team: z.array(z.string().min(1)),
    consumption: z.number().nonnegative().optional(),
    supportPosture: z.string().min(1).optional()
}).strict()

const stakeholderMapSchema = z.object({
    scope: scopeRefSchema,
    stakeholders: z.array(stakeholderSchema)
}).strict()

const forecastSnapshotSchema = z.object({
    currency: z.string().length(3),
    committed: z.number().nonnegative(),
    bestCase: z.number().nonnegative(),
    target: z.number().nonnegative(),
    gap: z.number()
}).strict()

export type MsxStakeholder = z.infer<typeof stakeholderSchema>
export type MsxActivity = z.infer<typeof activitySchema>
export type MsxPipelineRow = z.infer<typeof pipelineRowSchema>
export type MsxOpportunity360 = z.infer<typeof opportunity360Schema>
export type MsxAccount360 = z.infer<typeof account360Schema>
export type MsxStakeholderMap = z.infer<typeof stakeholderMapSchema>
export type MsxForecastSnapshot = z.infer<typeof forecastSnapshotSchema>

export type MsxPipelineFilter = {
    accountId?: string
    stages?: readonly number[]
    closeFrom?: string
    closeTo?: string
    top?: number
}

export type MsxTimeWindow = { from: string; to: string }

export type MsxMcpContext = {
    correlationId: string
    capability: AgentCapability
    signal?: AbortSignal
}

export type MsxReadResult<T> = {
    state: 'complete' | 'partial' | 'unauthorized'
    data: T
    rowCount: number
    truncated: boolean
    sourceHealth: SourceHealth
    lineage?: McpEvidenceLineage
}

export interface MsxReadConnector {
    getOpportunity360(opportunityId: string, context: MsxMcpContext): Promise<MsxReadResult<MsxOpportunity360 | null>>
    getAccount360(accountId: string, context: MsxMcpContext): Promise<MsxReadResult<MsxAccount360 | null>>
    listPipeline(filter: MsxPipelineFilter, context: MsxMcpContext): Promise<MsxReadResult<MsxPipelineRow[]>>
    getStakeholderMap(scope: ScopeRef, context: MsxMcpContext): Promise<MsxReadResult<MsxStakeholderMap | null>>
    listActivities(scope: ScopeRef, window: MsxTimeWindow, context: MsxMcpContext): Promise<MsxReadResult<MsxActivity[]>>
    getForecastSnapshot(filter: MsxPipelineFilter, context: MsxMcpContext): Promise<MsxReadResult<MsxForecastSnapshot | null>>
}

type ReadTool = 'get_opportunity_360' | 'get_account_360' | 'list_pipeline' |
    'get_stakeholder_map' | 'list_activities' | 'get_forecast_snapshot'

export class MsxMcpReadAdapter implements MsxReadConnector {
    constructor(
        private readonly broker: MsxToolBroker,
        private readonly now: () => Date = () => new Date(),
        private readonly createToolCallId: () => string = randomUUID
    ) { }

    getOpportunity360(opportunityId: string, context: MsxMcpContext) {
        return this.read('get_opportunity_360', 'opportunity',
            { opportunityId }, opportunity360Schema.nullable(), null, context)
    }

    getAccount360(accountId: string, context: MsxMcpContext) {
        return this.read('get_account_360', 'account', { accountId }, account360Schema.nullable(), null, context)
    }

    listPipeline(filter: MsxPipelineFilter, context: MsxMcpContext) {
        const scope = filter.accountId ? 'account' : 'portfolio'
        return this.read('list_pipeline', scope, { filter }, z.array(pipelineRowSchema), [], context)
    }

    getStakeholderMap(scope: ScopeRef, context: MsxMcpContext) {
        return this.read('get_stakeholder_map', scope.kind, { scope }, stakeholderMapSchema.nullable(), null, context)
    }

    listActivities(scope: ScopeRef, window: MsxTimeWindow, context: MsxMcpContext) {
        return this.read('list_activities', scope.kind, { scope, window }, z.array(activitySchema), [], context)
    }

    getForecastSnapshot(filter: MsxPipelineFilter, context: MsxMcpContext) {
        const scope = filter.accountId ? 'account' : 'portfolio'
        return this.read('get_forecast_snapshot', scope, { filter }, forecastSnapshotSchema.nullable(), null, context)
    }

    private async read<T>(
        tool: ReadTool,
        scope: ScopeRef['kind'],
        arguments_: Record<string, unknown>,
        schema: z.ZodType<T>,
        empty: T,
        context: MsxMcpContext
    ): Promise<MsxReadResult<T>> {
        const checkedAt = this.now().toISOString()
        const lineage: McpEvidenceLineage = {
            connector: 'msx-mcp',
            operation: tool,
            queryTemplateId: `msx.${tool}.v1`,
            toolCallId: this.createToolCallId()
        }
        try {
            const result = await this.broker.execute({
                correlationId: context.correlationId,
                serverId: 'msx',
                tool,
                capability: context.capability,
                scope,
                arguments: arguments_,
                ...(context.signal ? { signal: context.signal } : {})
            })
            return this.success(result, schema, checkedAt, lineage)
        } catch (error) {
            const code = getErrorCode(error)
            if (code === 'aborted' || (error instanceof Error && error.name === 'AbortError')) throw error
            if (code === 'unauthorized' || code?.endsWith('_denied') || code === 'approval_required') {
                return this.failure('unauthorized', 'unauthorized', empty, checkedAt, lineage)
            }
            if (error instanceof MsxMcpAdapterError) throw error
            return this.failure('partial', 'unavailable', empty, checkedAt, lineage)
        }
    }

    private success<T>(
        result: MsxBrokerResult,
        schema: z.ZodType<T>,
        checkedAt: string,
        lineage: McpEvidenceLineage
    ): MsxReadResult<T> {
        if (result.kind !== 'untrusted-mcp-data') throw new MsxMcpAdapterError('MSX MCP result envelope is invalid.')
        const parsed = schema.safeParse(unwrapMcpData(result.data))
        if (!parsed.success) throw new MsxMcpAdapterError('MSX MCP result does not match the local contract.')
        return {
            state: result.truncated ? 'partial' : 'complete',
            data: parsed.data,
            rowCount: result.recordCount,
            truncated: result.truncated,
            sourceHealth: {
                source: 'msx-mcp',
                state: result.truncated ? 'partial' : 'live',
                detail: result.truncated ? 'MSX MCP returned a row-limited result.' : 'MSX MCP returned delegated user-scoped data.',
                checkedAt
            },
            lineage
        }
    }

    private failure<T>(
        state: 'partial' | 'unauthorized',
        sourceState: 'unavailable' | 'unauthorized',
        data: T,
        checkedAt: string,
        lineage: McpEvidenceLineage
    ): MsxReadResult<T> {
        return {
            state,
            data,
            rowCount: 0,
            truncated: false,
            sourceHealth: {
                source: 'msx-mcp',
                state: sourceState,
                detail: sourceState === 'unauthorized'
                    ? 'MSX MCP delegated authorization is unavailable.'
                    : 'MSX MCP data is temporarily unavailable.',
                checkedAt
            },
            lineage
        }
    }
}

export class FeatureFlaggedMsxReadConnector implements MsxReadConnector {
    constructor(
        private readonly mcpEnabled: () => boolean,
        private readonly mcp: MsxReadConnector,
        private readonly direct: MsxReadConnector
    ) { }

    getOpportunity360(id: string, context: MsxMcpContext) { return this.selected().getOpportunity360(id, context) }
    getAccount360(id: string, context: MsxMcpContext) { return this.selected().getAccount360(id, context) }
    listPipeline(filter: MsxPipelineFilter, context: MsxMcpContext) { return this.selected().listPipeline(filter, context) }
    getStakeholderMap(scope: ScopeRef, context: MsxMcpContext) { return this.selected().getStakeholderMap(scope, context) }
    listActivities(scope: ScopeRef, window: MsxTimeWindow, context: MsxMcpContext) { return this.selected().listActivities(scope, window, context) }
    getForecastSnapshot(filter: MsxPipelineFilter, context: MsxMcpContext) { return this.selected().getForecastSnapshot(filter, context) }

    private selected(): MsxReadConnector {
        return this.mcpEnabled() ? this.mcp : this.direct
    }
}

export class MsxMcpAdapterError extends Error {
    readonly code = 'malformed_response'
    constructor(message: string) {
        super(message)
        this.name = 'MsxMcpAdapterError'
    }
}

function unwrapMcpData(value: unknown): unknown {
    if (typeof value === 'string') {
        try { return JSON.parse(value) } catch { throw new MsxMcpAdapterError('MSX MCP text content is not valid JSON.') }
    }
    if (isRecord(value) && Array.isArray(value.content)) {
        const text = value.content.find((item) => isRecord(item) && item.type === 'text' && typeof item.text === 'string')
        if (isRecord(text) && typeof text.text === 'string') return unwrapMcpData(text.text)
    }
    return value
}

function getErrorCode(error: unknown): string | undefined {
    return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}