import {
    errorResponse,
    parseBridgeParams,
    requestEnvelopeSchema,
    successResponse,
    type ResponseEnvelope
} from './message-contracts.js'
import type { ExtensionDataProvider } from './data-provider.js'

function extractId(raw: unknown): string {
    if (raw && typeof raw === 'object' && 'id' in raw) {
        const id = (raw as { id: unknown }).id
        if (typeof id === 'string' && id.length > 0 && id.length <= 200) return id
    }
    return 'unknown'
}

function sanitizeMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message.slice(0, 1000)
    return 'The request could not be completed.'
}

/**
 * Pure dispatch for one inbound webview message. Contains no VS Code API and no I/O of
 * its own; every side effect flows through the injected {@link ExtensionDataProvider}.
 * `openEvidence` is intentionally rejected here because it must be executed by the host
 * (native VS Code open-external), not the data plane.
 */
export async function routeBridgeMessage(provider: ExtensionDataProvider, raw: unknown): Promise<ResponseEnvelope> {
    const parsed = requestEnvelopeSchema.safeParse(raw)
    if (!parsed.success) {
        return errorResponse(extractId(raw), 'The request envelope was rejected.', 'invalid_envelope')
    }
    const { id, method } = parsed.data
    try {
        switch (method) {
            case 'getCurrentUserEmail':
                return successResponse(id, await provider.getCurrentUserEmail() ?? null)
            case 'listAccounts':
                return successResponse(id, await provider.listAccounts())
            case 'listOpportunities': {
                const params = parseBridgeParams('listOpportunities', parsed.data.params)
                return successResponse(id, await provider.listOpportunities(params.accountId))
            }
            case 'listMilestones': {
                const params = parseBridgeParams('listMilestones', parsed.data.params)
                return successResponse(id, await provider.listMilestones(params.opportunityId))
            }
            case 'updateOpportunity': {
                const params = parseBridgeParams('updateOpportunity', parsed.data.params)
                return successResponse(id, await provider.updateOpportunity(params.opportunityId, params.update))
            }
            case 'updateMilestone': {
                const params = parseBridgeParams('updateMilestone', parsed.data.params)
                return successResponse(id, await provider.updateMilestone(params.opportunityId, params.milestoneId, params.update))
            }
            case 'runMcemCoach': {
                const params = parseBridgeParams('runMcemCoach', parsed.data.params)
                return successResponse(id, await provider.runMcemCoach(params.accountId, params.opportunityId))
            }
            case 'transitionOpportunityStage': {
                const params = parseBridgeParams('transitionOpportunityStage', parsed.data.params)
                return successResponse(id, await provider.transitionOpportunityStage(params.accountId, params.opportunityId, params.targetStage, params.reason))
            }
            case 'runAgentTask': {
                const params = parseBridgeParams('runAgentTask', parsed.data.params)
                return successResponse(id, await provider.runAgentTask(params.capability, params.accountId, params.opportunityId, params.prompt))
            }
            case 'listWorkflowDefinitions': {
                const params = parseBridgeParams('listWorkflowDefinitions', parsed.data.params)
                return successResponse(id, await provider.listWorkflowDefinitions(params?.scope))
            }
            case 'startWorkflow': {
                const params = parseBridgeParams('startWorkflow', parsed.data.params)
                return successResponse(id, await provider.startWorkflow({
                    workflowId: params.workflowId,
                    scope: params.scope,
                    ...(params.input === undefined ? {} : { input: params.input }),
                    ...(params.correlationId === undefined ? {} : { correlationId: params.correlationId })
                }))
            }
            case 'getWorkflowRun': {
                const params = parseBridgeParams('getWorkflowRun', parsed.data.params)
                return successResponse(id, await provider.getWorkflowRun(params.runId))
            }
            case 'cancelWorkflowRun': {
                const params = parseBridgeParams('cancelWorkflowRun', parsed.data.params)
                return successResponse(id, await provider.cancelWorkflowRun(params.runId))
            }
            case 'listWorkflowRuns': {
                const params = parseBridgeParams('listWorkflowRuns', parsed.data.params)
                return successResponse(id, await provider.listWorkflowRuns(params?.scope, params?.limit))
            }
            case 'prepareWorkflowGuidance': {
                const params = parseBridgeParams('prepareWorkflowGuidance', parsed.data.params)
                return successResponse(id, await provider.prepareWorkflowGuidance(params.runId, params.queueItemId, params.capability))
            }
            case 'openEvidence':
                return errorResponse(id, 'openEvidence must be handled by the extension host.', 'host_only')
            case 'exportContent':
                return errorResponse(id, 'exportContent must be handled by the extension host.', 'host_only')
            case 'composeEmail':
                return errorResponse(id, 'composeEmail must be handled by the extension host.', 'host_only')
            default:
                return errorResponse(id, 'The requested method is not supported.', 'unknown_method')
        }
    } catch (error) {
        return errorResponse(id, sanitizeMessage(error), 'request_failed')
    }
}
