import { z } from 'zod'
import {
    scopeRefSchema,
    workflowContractVersion,
    workflowDefinitionSchema,
    workflowGuidanceHandoffSchema,
    workflowRunSchema,
    type ScopeRef,
    type WorkflowGuidanceHandoff,
    type WorkflowDefinition,
    type WorkflowRun
} from '../../common/index.js'
import { initialWorkflowOutputSchema } from './cohort.js'
import { WorkflowRegistry } from './registry.js'
import { WorkflowRuntime, WorkflowRuntimeError } from './runtime.js'

const workflowIdSchema = z.string().regex(/^WF-[0-9]{3}$/)
const runIdSchema = z.string().uuid()

export const listWorkflowDefinitionsRequestSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    scope: z.enum(['portfolio', 'account', 'opportunity']).optional()
}).strict()

export const startWorkflowHostRequestSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    workflowId: workflowIdSchema,
    scope: scopeRefSchema,
    input: z.unknown().optional(),
    correlationId: z.string().uuid().optional()
}).strict()

export const workflowRunRequestSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    runId: runIdSchema
}).strict()

export const workflowGuidanceRequestSchema = workflowRunRequestSchema.extend({
    queueItemId: z.string().min(1).max(200),
    capability: workflowGuidanceHandoffSchema.shape.capability
}).strict()

export const listWorkflowRunsRequestSchema = z.object({
    contractVersion: z.literal(workflowContractVersion),
    scope: scopeRefSchema.optional(),
    limit: z.number().int().min(1).max(100).default(25)
}).strict()

export const workflowRunViewSchema = z.object({
    run: workflowRunSchema,
    output: initialWorkflowOutputSchema.optional()
}).strict()

export type ListWorkflowDefinitionsRequest = z.infer<typeof listWorkflowDefinitionsRequestSchema>
export type StartWorkflowHostRequest = z.infer<typeof startWorkflowHostRequestSchema>
export type WorkflowRunRequest = z.infer<typeof workflowRunRequestSchema>
export type ListWorkflowRunsRequest = z.input<typeof listWorkflowRunsRequestSchema>
export type WorkflowRunView = z.infer<typeof workflowRunViewSchema>
export type WorkflowGuidanceRequest = z.infer<typeof workflowGuidanceRequestSchema>

export const workflowHostOperationSchema = z.enum(['list', 'start', 'get', 'cancel', 'history', 'guidance'])
export type WorkflowHostOperation = z.infer<typeof workflowHostOperationSchema>

export interface WorkflowHost {
    listDefinitions(request: unknown): WorkflowDefinition[]
    start(request: unknown): WorkflowRun
    get(request: unknown): WorkflowRunView
    cancel(request: unknown): WorkflowRun
    listRuns(request: unknown): WorkflowRun[]
    prepareGuidance(request: unknown): WorkflowGuidanceHandoff
}

export class SharedWorkflowHost implements WorkflowHost {
    constructor(
        private readonly registry: WorkflowRegistry,
        private readonly runtime: WorkflowRuntime
    ) { }

    listDefinitions(rawRequest: unknown): WorkflowDefinition[] {
        const request = listWorkflowDefinitionsRequestSchema.parse(rawRequest)
        return z.array(workflowDefinitionSchema).parse(this.registry.list(request.scope))
    }

    start(rawRequest: unknown): WorkflowRun {
        const request = startWorkflowHostRequestSchema.parse(rawRequest)
        return workflowRunSchema.parse(this.runtime.start({
            workflowId: request.workflowId,
            scope: request.scope,
            ...(request.input === undefined ? {} : { input: request.input }),
            ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
        }))
    }

    get(rawRequest: unknown): WorkflowRunView {
        const request = workflowRunRequestSchema.parse(rawRequest)
        const run = this.runtime.get(request.runId)
        if (!run) throw new WorkflowRuntimeError('run_not_found', `Workflow run ${request.runId} is not available.`)
        const result = run.resultRef ? this.runtime.getResult(run.resultRef) : undefined
        return workflowRunViewSchema.parse({
            run,
            ...(result?.output === undefined ? {} : { output: initialWorkflowOutputSchema.parse(result.output) })
        })
    }

    cancel(rawRequest: unknown): WorkflowRun {
        const request = workflowRunRequestSchema.parse(rawRequest)
        return workflowRunSchema.parse(this.runtime.cancel(request.runId))
    }

    listRuns(rawRequest: unknown): WorkflowRun[] {
        const request = listWorkflowRunsRequestSchema.parse(rawRequest)
        return z.array(workflowRunSchema).parse(this.runtime.list(request.scope as ScopeRef | undefined, request.limit))
    }

    prepareGuidance(rawRequest: unknown): WorkflowGuidanceHandoff {
        const request = workflowGuidanceRequestSchema.parse(rawRequest)
        const view = this.get({ contractVersion: workflowContractVersion, runId: request.runId })
        if (view.run.status !== 'completed' || !view.run.resultRef || !view.output) {
            throw new WorkflowRuntimeError('result_not_available', 'Guidance requires a completed workflow result.')
        }
        const item = view.output.queueItems.find(({ id }) => id === request.queueItemId)
        if (!item) throw new WorkflowRuntimeError('queue_item_not_found', `Queue item ${request.queueItemId} is not available.`)
        if (!item.accountId || !item.opportunityId) {
            throw new WorkflowRuntimeError('opportunity_scope_required', 'Guidance requires an opportunity-scoped queue item.')
        }
        const lineageIds = new Set(view.output.lineage.map(({ toolCallId }) => toolCallId))
        if (item.evidenceIds.some((evidenceId) => !lineageIds.has(evidenceId))) {
            throw new WorkflowRuntimeError('invalid_evidence', 'Queue-item evidence does not belong to the workflow result.')
        }
        const facts = [
            { label: 'Priority', value: item.priority },
            ...(item.owner ? [{ label: 'Owner', value: item.owner }] : []),
            ...(item.dueDate ? [{ label: 'Due date', value: item.dueDate }] : [])
        ]
        const prompt = [
            `Review ${view.output.workflowId} result "${item.title}" and recommend the next evidence-backed action.`,
            ...facts.map(({ label, value }) => `${label}: ${value}`),
            `Evidence IDs: ${item.evidenceIds.join(', ')}. Cite only these IDs.`
        ].join('\n')
        return workflowGuidanceHandoffSchema.parse({
            contractVersion: workflowContractVersion,
            workflowId: view.output.workflowId,
            resultRef: view.run.resultRef,
            capability: request.capability,
            scope: { kind: 'opportunity', accountId: item.accountId, opportunityId: item.opportunityId },
            prompt,
            context: {
                cardTitle: view.output.card.title,
                queueItemId: item.id,
                queueItemTitle: item.title,
                facts,
                evidenceIds: item.evidenceIds
            }
        })
    }
}

export function invokeWorkflowHost(host: WorkflowHost, rawOperation: unknown, request: unknown): unknown {
    const operation = workflowHostOperationSchema.parse(rawOperation)
    switch (operation) {
        case 'list': return z.array(workflowDefinitionSchema).parse(host.listDefinitions(request))
        case 'start': return workflowRunSchema.parse(host.start(request))
        case 'get': return workflowRunViewSchema.parse(host.get(request))
        case 'cancel': return workflowRunSchema.parse(host.cancel(request))
        case 'history': return z.array(workflowRunSchema).parse(host.listRuns(request))
        case 'guidance': return workflowGuidanceHandoffSchema.parse(host.prepareGuidance(request))
    }
}