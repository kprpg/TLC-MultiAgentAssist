import { z } from 'zod'
import { milestoneUpdateSchema, opportunityUpdateSchema, scopeRefSchema } from '../../../packages/common/index.js'

/**
 * Strict, discriminated message envelopes for the webview <-> extension-host bridge.
 * The host rejects any payload that does not parse. No token, raw MCP payload, or
 * stack trace is ever placed on this channel.
 */

export const agentCapabilitySchema = z.enum([
    'account-pulse',
    'mcem-coach',
    'pursuit-executive',
    'risk-solution-play'
])

export const bridgeMethodSchema = z.enum([
    'getCurrentUserEmail',
    'listAccounts',
    'listOpportunities',
    'listMilestones',
    'updateOpportunity',
    'updateMilestone',
    'runMcemCoach',
    'transitionOpportunityStage',
    'runAgentTask',
    'listWorkflowDefinitions',
    'startWorkflow',
    'getWorkflowRun',
    'cancelWorkflowRun',
    'listWorkflowRuns',
    'prepareWorkflowGuidance',
    'openEvidence',
    'exportContent',
    'composeEmail'
])

export type BridgeMethod = z.infer<typeof bridgeMethodSchema>

const scopeKindSchema = z.enum(['portfolio', 'account', 'opportunity'])

export const bridgeParamSchemas = {
    getCurrentUserEmail: z.void().optional(),
    listAccounts: z.void().optional(),
    listOpportunities: z.object({ accountId: z.string().min(1).max(200) }).strict(),
    listMilestones: z.object({ opportunityId: z.string().min(1).max(200) }).strict(),
    updateOpportunity: z.object({
        opportunityId: z.string().min(1).max(200),
        update: opportunityUpdateSchema
    }).strict(),
    updateMilestone: z.object({
        opportunityId: z.string().min(1).max(200),
        milestoneId: z.string().min(1).max(200),
        update: milestoneUpdateSchema
    }).strict(),
    runMcemCoach: z.object({
        accountId: z.string().min(1).max(200),
        opportunityId: z.string().min(1).max(200)
    }).strict(),
    transitionOpportunityStage: z.object({
        accountId: z.string().min(1).max(200),
        opportunityId: z.string().min(1).max(200),
        targetStage: z.number().int().min(1).max(5),
        reason: z.string().trim().min(1).max(1000).optional()
    }).strict(),
    runAgentTask: z.object({
        capability: agentCapabilitySchema,
        accountId: z.string().min(1).max(200),
        opportunityId: z.string().min(1).max(200),
        prompt: z.string().min(1).max(4000)
    }).strict(),
    listWorkflowDefinitions: z.object({ scope: scopeKindSchema.optional() }).strict().optional(),
    startWorkflow: z.object({
        workflowId: z.string().regex(/^WF-[0-9]{3}$/),
        scope: scopeRefSchema,
        input: z.unknown().optional(),
        correlationId: z.string().uuid().optional()
    }).strict(),
    getWorkflowRun: z.object({ runId: z.string().uuid() }).strict(),
    cancelWorkflowRun: z.object({ runId: z.string().uuid() }).strict(),
    listWorkflowRuns: z.object({
        scope: scopeRefSchema.optional(),
        limit: z.number().int().min(1).max(100).optional()
    }).strict().optional(),
    prepareWorkflowGuidance: z.object({
        runId: z.string().uuid(),
        queueItemId: z.string().min(1).max(200),
        capability: agentCapabilitySchema
    }).strict(),
    openEvidence: z.object({ url: z.string().url().max(2048) }).strict(),
    exportContent: z.object({
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(200_000)
    }).strict(),
    composeEmail: z.object({
        subject: z.string().min(1).max(200),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(200_000)
    }).strict()
} satisfies Record<BridgeMethod, z.ZodTypeAny>

const MAX_MESSAGE_ID = 200

export const requestEnvelopeSchema = z.object({
    kind: z.literal('request'),
    id: z.string().min(1).max(MAX_MESSAGE_ID),
    method: bridgeMethodSchema,
    params: z.unknown().optional()
}).strict()

export type RequestEnvelope = z.infer<typeof requestEnvelopeSchema>

export const responseEnvelopeSchema = z.discriminatedUnion('ok', [
    z.object({
        kind: z.literal('response'),
        id: z.string().min(1).max(MAX_MESSAGE_ID),
        ok: z.literal(true),
        result: z.unknown()
    }).strict(),
    z.object({
        kind: z.literal('response'),
        id: z.string().min(1).max(MAX_MESSAGE_ID),
        ok: z.literal(false),
        error: z.object({
            message: z.string().min(1).max(1000),
            code: z.string().min(1).max(100).optional()
        }).strict()
    }).strict()
])

export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>

export const hostEventSchema = z.object({
    kind: z.literal('event'),
    type: z.enum(['init', 'modeChanged', 'refresh']),
    payload: z.object({
        mode: z.enum(['sample', 'live']),
        userEmail: z.string().max(320).optional()
    }).strict()
}).strict()

export type HostEvent = z.infer<typeof hostEventSchema>

export function parseBridgeParams<M extends BridgeMethod>(method: M, params: unknown): z.infer<(typeof bridgeParamSchemas)[M]> {
    return bridgeParamSchemas[method].parse(params) as z.infer<(typeof bridgeParamSchemas)[M]>
}

export function successResponse(id: string, result: unknown): ResponseEnvelope {
    return { kind: 'response', id, ok: true, result }
}

export function errorResponse(id: string, message: string, code?: string): ResponseEnvelope {
    return {
        kind: 'response',
        id,
        ok: false,
        error: { message, ...(code === undefined ? {} : { code }) }
    }
}
