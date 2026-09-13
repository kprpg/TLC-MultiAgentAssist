import { z } from 'zod'
import {
    mcpEvidenceLineageSchema,
    scopeRefSchema,
    sourceHealthSchema,
    workflowDefinitionSchema,
    workflowResultCardSchema,
    type WorkflowDefinition
} from '../../common/index.js'

export const initialWorkflowIds = ['WF-001', 'WF-002', 'WF-003', 'WF-005', 'WF-006', 'WF-007', 'WF-009', 'WF-010', 'WF-012'] as const
export type InitialWorkflowId = typeof initialWorkflowIds[number]

const asOfSchema = z.string().date()

export const initialWorkflowInputSchemas = {
    'WF-001': z.object({ asOf: asOfSchema, staleAfterDays: z.number().int().min(1).max(365).default(30) }).strict(),
    'WF-002': z.object({ asOf: asOfSchema }).strict(),
    'WF-003': z.object({ asOf: asOfSchema }).strict(),
    'WF-005': z.object({ asOf: asOfSchema, lookbackDays: z.number().int().min(1).max(90).default(7) }).strict(),
    'WF-006': z.object({ asOf: asOfSchema }).strict(),
    'WF-007': z.object({ asOf: asOfSchema, meetingWindowDays: z.number().int().min(1).max(90).default(14) }).strict(),
    'WF-009': z.object({ asOf: asOfSchema, maximumActiveItems: z.number().int().min(1).max(100).default(20) }).strict(),
    'WF-010': z.object({ asOf: asOfSchema, followUpAfterDays: z.number().int().min(1).max(90).default(14) }).strict(),
    'WF-012': z.object({ asOf: asOfSchema }).strict()
} satisfies Record<InitialWorkflowId, z.ZodType>

export const workflowQueueItemSchema = z.object({
    id: z.string().min(1),
    workflowId: z.enum(initialWorkflowIds),
    priority: z.enum(['P0', 'P1', 'P2']),
    title: z.string().min(1),
    owner: z.string().min(1).optional(),
    accountId: z.string().min(1).optional(),
    opportunityId: z.string().min(1).optional(),
    dueDate: z.string().date().optional(),
    evidenceIds: z.array(z.string().min(1)),
    status: z.literal('new')
}).strict()

export const initialWorkflowOutputSchema = z.object({
    contractVersion: z.literal('1.0'),
    workflowId: z.enum(initialWorkflowIds),
    generatedAt: z.string().datetime(),
    scope: scopeRefSchema,
    card: workflowResultCardSchema,
    queueItems: z.array(workflowQueueItemSchema),
    lineage: z.array(mcpEvidenceLineageSchema).min(1),
    sourceHealth: z.array(sourceHealthSchema).min(1)
}).strict()

export type WorkflowQueueItem = z.infer<typeof workflowQueueItemSchema>
export type InitialWorkflowOutput = z.infer<typeof initialWorkflowOutputSchema>
export type InitialWorkflowInput = {
    asOf: string
    staleAfterDays?: number
    lookbackDays?: number
    maximumActiveItems?: number
    followUpAfterDays?: number
    meetingWindowDays?: number
}

export function parseInitialWorkflowInput(workflowId: InitialWorkflowId, input: unknown): InitialWorkflowInput {
    return initialWorkflowInputSchemas[workflowId].parse(input) as InitialWorkflowInput
}

export const initialWorkflowDefinitions: readonly WorkflowDefinition[] = Object.freeze([
    createDefinition('WF-001', 'Stale opportunity sweep', ['AE', 'Manager'], 'portfolio-hygiene', 'record-table', [
        { connector: 'dataverse-mcp', operation: 'read_query', required: true },
        { connector: 'msx-mcp', operation: 'list_pipeline', required: false }
    ]),
    createDefinition('WF-002', 'Overdue milestone triage', ['Specialist', 'SE'], 'portfolio-hygiene', 'action-list', [
        { connector: 'dataverse-mcp', operation: 'read_query', required: true },
        { connector: 'msx-mcp', operation: 'list_pipeline', required: false }
    ]),
    createDefinition('WF-003', 'Stage-evidence mismatch queue', ['Specialist', 'ATS'], 'stage-governance', 'exception-list', [
        { connector: 'dataverse-mcp', operation: 'read_query', required: true },
        { connector: 'msx-mcp', operation: 'list_pipeline', required: false }
    ]),
    createDefinition('WF-005', 'Weekly governance exceptions', ['Manager'], 'governance', 'exception-list', [
        { connector: 'dataverse-mcp', operation: 'read_query', required: true },
        { connector: 'msx-mcp', operation: 'list_pipeline', required: false }
    ]),
    createDefinition('WF-006', 'Commit-risk conflict list', ['Manager', 'CSAM'], 'forecast-readiness', 'record-table', [
        { connector: 'dataverse-mcp', operation: 'read_query', required: true },
        { connector: 'msx-mcp', operation: 'get_forecast_snapshot', required: false }
    ]),
    createDefinition('WF-007', 'Next-meeting prep pack', ['AE', 'ATS'], 'meeting-preparation', 'record-table', [
        { connector: 'dataverse-mcp', operation: 'read_query', required: true },
        { connector: 'msx-mcp', operation: 'list_pipeline', required: false }
    ]),
    createDefinition('WF-009', 'Owner workload imbalance', ['Manager'], 'ownership', 'metric-strip', [
        { connector: 'dataverse-mcp', operation: 'read_query', required: true }
    ]),
    createDefinition('WF-010', 'Activity follow-up debt', ['Seller', 'SE'], 'activity-compliance', 'action-list', [
        { connector: 'dataverse-mcp', operation: 'read_query', required: true }
    ]),
    createDefinition('WF-012', 'Stage exit evidence packet', ['Specialist', 'SE'], 'stage-governance', 'action-list', [
        { connector: 'dataverse-mcp', operation: 'read_query', required: true },
        { connector: 'msx-mcp', operation: 'list_pipeline', required: false }
    ])
].map((definition) => workflowDefinitionSchema.parse(definition)))

function createDefinition(
    id: InitialWorkflowId,
    name: string,
    personaTargets: string[],
    category: string,
    cardStyle: WorkflowDefinition['ui']['cardStyle'],
    connectorPlan: WorkflowDefinition['connectorPlan'],
    executionMode: WorkflowDefinition['executionMode'] = connectorPlan.length > 1 ? 'composite' : 'deterministic'
): WorkflowDefinition {
    return {
        contractVersion: '1.0',
        id,
        name,
        version: '1.0.0',
        scope: 'portfolio',
        personaTargets,
        category,
        executionMode,
        connectorPlan,
        inputSchemaRef: `workflow-input-${id.toLowerCase()}.v1`,
        outputSchemaRef: `workflow-output-${id.toLowerCase()}.v1`,
        sla: { targetMs: 4_000, timeoutMs: 12_000 },
        auth: { requiresDelegatedUser: true, allowedWrite: false },
        ui: { cardStyle, resultPriority: 'high', showInQuickLaunch: true }
    }
}