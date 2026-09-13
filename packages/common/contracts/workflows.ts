import { z } from 'zod'

export const workflowContractVersion = '1.0' as const
export const workflowAgentCapabilityValues = [
    'account-pulse',
    'mcem-coach',
    'pursuit-executive',
    'risk-solution-play'
] as const
const workflowAgentCapabilitySchema = z.enum(workflowAgentCapabilityValues)

export const scopeRefSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('portfolio') }).strict(),
    z.object({ kind: z.literal('account'), accountId: z.string().min(1) }).strict(),
    z.object({
        kind: z.literal('opportunity'),
        accountId: z.string().min(1),
        opportunityId: z.string().min(1)
    }).strict()
])

export const workflowExecutionModeSchema = z.enum(['deterministic', 'composite', 'agentic'])
export const workflowOutcomeStateSchema = z.enum(['complete', 'partial', 'unauthorized'])
export const workflowRunStatusSchema = z.enum([
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled'
])

const workflowConnectorStepSchema = z.object({
    connector: z.enum(['dataverse-mcp', 'msx-mcp']),
    operation: z.string().regex(/^[a-z][a-z0-9_]*$/),
    required: z.boolean()
}).strict()

export const workflowDefinitionSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    id: z.string().regex(/^WF-[0-9]{3}$/),
    name: z.string().min(1).max(120),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    scope: z.enum(['portfolio', 'account', 'opportunity']),
    personaTargets: z.array(z.string().min(1)).min(1),
    category: z.string().regex(/^[a-z][a-z0-9-]*$/),
    executionMode: workflowExecutionModeSchema,
    connectorPlan: z.array(workflowConnectorStepSchema).min(1).max(6),
    inputSchemaRef: z.string().min(1),
    outputSchemaRef: z.string().min(1),
    sla: z.object({
        targetMs: z.number().int().min(1),
        timeoutMs: z.number().int().min(1)
    }).strict().refine((sla) => sla.timeoutMs >= sla.targetMs, 'Workflow timeout must not be less than its target.'),
    auth: z.object({
        requiresDelegatedUser: z.literal(true),
        allowedWrite: z.boolean()
    }).strict(),
    ui: z.object({
        cardStyle: z.enum(['exception-list', 'metric-strip', 'record-table', 'timeline', 'action-list']),
        resultPriority: z.enum(['high', 'medium', 'low']),
        showInQuickLaunch: z.boolean()
    }).strict()
}).strict()

export const workflowConnectorCallSchema = z.object({
    connector: z.enum(['dataverse-mcp', 'msx-mcp']),
    operation: z.string().regex(/^[a-z][a-z0-9_]*$/),
    status: z.enum(['success', 'partial', 'unauthorized', 'failed', 'cancelled']),
    durationMs: z.number().int().nonnegative(),
    recordCount: z.number().int().nonnegative(),
    truncated: z.boolean()
}).strict()

export const workflowRunSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    runId: z.string().uuid(),
    workflowId: z.string().regex(/^WF-[0-9]{3}$/),
    status: workflowRunStatusSchema,
    state: workflowOutcomeStateSchema.optional(),
    scope: scopeRefSchema,
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    connectorCalls: z.array(workflowConnectorCallSchema),
    resultRef: z.string().min(1).optional(),
    telemetry: z.object({
        correlationId: z.string().uuid(),
        firstResultMs: z.number().int().nonnegative().optional(),
        cacheHit: z.boolean()
    }).strict()
}).strict().superRefine((run, context) => {
    if (run.status === 'queued' && (run.startedAt || run.completedAt || run.state)) {
        context.addIssue({ code: 'custom', path: ['status'], message: 'Queued runs cannot have execution results.' })
    }

    if (run.status === 'running' && (!run.startedAt || run.completedAt || run.state)) {
        context.addIssue({ code: 'custom', path: ['status'], message: 'Running runs require startedAt and cannot be complete.' })
    }

    if (run.status === 'completed' && (!run.startedAt || !run.completedAt || !run.state || !run.resultRef)) {
        context.addIssue({ code: 'custom', path: ['status'], message: 'Completed runs require timestamps, outcome state, and a result.' })
    }

    if ((run.status === 'failed' || run.status === 'cancelled') && (!run.startedAt || !run.completedAt || run.state)) {
        context.addIssue({ code: 'custom', path: ['status'], message: 'Terminal runs require timestamps and no outcome state.' })
    }
})

const workflowStatusTransitions: Readonly<Record<z.infer<typeof workflowRunStatusSchema>, readonly z.infer<typeof workflowRunStatusSchema>[]>> = {
    queued: ['running', 'cancelled'],
    running: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: []
}

export function isWorkflowRunTransitionAllowed(
    from: z.infer<typeof workflowRunStatusSchema>,
    to: z.infer<typeof workflowRunStatusSchema>
): boolean {
    return workflowStatusTransitions[from].includes(to)
}

const cardBaseSchema = z.object({
    title: z.string().min(1),
    evidenceIds: z.array(z.string().min(1))
})

export const workflowResultCardSchema = z.discriminatedUnion('kind', [
    cardBaseSchema.extend({
        kind: z.literal('exception-list'),
        exceptions: z.array(z.object({
            id: z.string().min(1),
            title: z.string().min(1),
            priority: z.enum(['P0', 'P1', 'P2']),
            detail: z.string().min(1),
            evidenceIds: z.array(z.string().min(1))
        }).strict())
    }).strict(),
    cardBaseSchema.extend({
        kind: z.literal('metric-strip'),
        metrics: z.array(z.object({ label: z.string().min(1), value: z.union([z.string(), z.number()]) }).strict()).min(1)
    }).strict(),
    cardBaseSchema.extend({
        kind: z.literal('record-table'),
        columns: z.array(z.string().min(1)).min(1),
        rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
    }).strict(),
    cardBaseSchema.extend({
        kind: z.literal('timeline'),
        events: z.array(z.object({ at: z.string().datetime(), label: z.string().min(1) }).strict())
    }).strict(),
    cardBaseSchema.extend({
        kind: z.literal('action-list'),
        actions: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), priority: z.enum(['P0', 'P1', 'P2']) }).strict())
    }).strict()
])

export const mcpEvidenceLineageSchema = z.object({
    connector: z.enum(['dataverse-mcp', 'msx-mcp']),
    operation: z.string().regex(/^[a-z][a-z0-9_]*$/),
    queryTemplateId: z.string().min(1).optional(),
    toolCallId: z.string().min(1)
}).strict()

const changeSetItemSchema = z.object({
    itemId: z.string().uuid(),
    entity: z.string().min(1),
    recordId: z.string().min(1),
    field: z.string().min(1),
    before: z.unknown(),
    after: z.unknown(),
    rationale: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1)
}).strict().refine((item) => !Object.is(item.before, item.after), 'A change-set item must change its value.')

export const changeSetProposalSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    changeSetId: z.string().uuid(),
    proposedByCorrelationId: z.string().uuid(),
    scope: scopeRefSchema,
    proposedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    items: z.array(changeSetItemSchema).min(1)
}).strict().refine((proposal) => proposal.expiresAt > proposal.proposedAt, 'Change-set expiry must follow proposal time.')

export const changeSetApprovalSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    changeSetId: z.string().uuid(),
    approvedItemIds: z.array(z.string().uuid()).min(1),
    approvedAt: z.string().datetime(),
    reason: z.string().trim().min(3).max(1_000)
}).strict()

export const changeSetResultSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    changeSetId: z.string().uuid(),
    state: z.enum(['applied', 'conflict', 'failed']),
    auditNote: z.string().min(1),
    itemResults: z.array(z.object({
        itemId: z.string().uuid(),
        state: z.enum(['applied', 'conflict', 'failed']),
        detail: z.string().min(1)
    }).strict()).min(1)
}).strict()

export const scopeAwareAgentTaskRequestSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    capability: workflowAgentCapabilitySchema,
    scope: scopeRefSchema,
    prompt: z.string().min(3).max(1_000)
}).strict()

const workflowGuidanceFactSchema = z.object({
    label: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(500)
}).strict()

export const workflowGuidanceHandoffSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    workflowId: z.string().regex(/^WF-[0-9]{3}$/),
    resultRef: z.string().min(1).max(200),
    capability: workflowAgentCapabilitySchema,
    scope: z.object({
        kind: z.literal('opportunity'),
        accountId: z.string().min(1).max(200),
        opportunityId: z.string().min(1).max(200)
    }).strict(),
    prompt: z.string().trim().min(3).max(1_000),
    context: z.object({
        cardTitle: z.string().trim().min(1).max(120),
        queueItemId: z.string().min(1).max(200).optional(),
        queueItemTitle: z.string().trim().min(1).max(240).optional(),
        facts: z.array(workflowGuidanceFactSchema).max(20),
        evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(20)
    }).strict()
}).strict()

export function normalizeAgentTaskRequestScope(
    request: {
        contractVersion: typeof workflowContractVersion
        capability: typeof workflowAgentCapabilityValues[number]
        accountId: string
        opportunityId: string
        prompt: string
    }
): z.infer<typeof scopeAwareAgentTaskRequestSchema> {
    return {
        contractVersion: request.contractVersion,
        capability: request.capability,
        scope: {
            kind: 'opportunity',
            accountId: request.accountId,
            opportunityId: request.opportunityId
        },
        prompt: request.prompt
    }
}

export type ScopeRef = z.infer<typeof scopeRefSchema>
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>
export type WorkflowRun = z.infer<typeof workflowRunSchema>
export type WorkflowResultCard = z.infer<typeof workflowResultCardSchema>
export type McpEvidenceLineage = z.infer<typeof mcpEvidenceLineageSchema>
export type ChangeSetProposal = z.infer<typeof changeSetProposalSchema>
export type ChangeSetApproval = z.infer<typeof changeSetApprovalSchema>
export type ChangeSetResult = z.infer<typeof changeSetResultSchema>
export type ScopeAwareAgentTaskRequest = z.infer<typeof scopeAwareAgentTaskRequestSchema>
export type WorkflowGuidanceHandoff = z.infer<typeof workflowGuidanceHandoffSchema>