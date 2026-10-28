import {
    errorResponse,
    parseBridgeParams,
    requestEnvelopeSchema,
    streamCancelEnvelopeSchema,
    streamRequestEnvelopeSchema,
    successResponse,
    type ResponseEnvelope,
    type StreamEventEnvelope
} from './message-contracts.js'
import type { ExtensionDataProvider } from './data-provider.js'
import type { AgentTaskStreamEvent } from '../../../packages/common/contracts/index.js'
import {
    recordCreationCatalogSchema,
    recordCreationPreviewSchema,
    recordCreationResultSchema,
    recordCreationDraftResultSchema
} from '../../../packages/common/index.js'
import { discoverySnapshotSchema, portfolioIndexSchema, portfolioWorkspaceSchema } from '../../../packages/common/contracts/index.js'
import { cacheControlResponseSchema, mutationSyncResponseSchema } from '../../../packages/common/contracts/cache-sync.js'
import { knowledgeSearchResponseSchema } from '../../../packages/common/contracts/knowledge.js'
import { workingSessionResultSchema, workingSessionTopicResponseSchema } from '../../../packages/common/contracts/working-session.js'
import { withFoundrySignIn } from './foundry-sign-in.js'

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
 * Pure router for progressive agent runs. Contains no VS Code API; the controller supplies `post`.
 * Every run ends with exactly one terminal `complete` or `error` event on the bridge.
 */
export function createAgentStreamRouter(getProvider: () => ExtensionDataProvider, post: (message: StreamEventEnvelope) => void) {
    const active = new Map<string, AbortController>()
    const emit = (id: string, event: AgentTaskStreamEvent) => post({ kind: 'stream-event', id, event })
    return {
        handles(raw: unknown): boolean {
            const kind = raw && typeof raw === 'object' ? (raw as { kind?: unknown }).kind : undefined
            return kind === 'stream-request' || kind === 'stream-cancel'
        },
        async handle(raw: unknown): Promise<void> {
            const cancel = streamCancelEnvelopeSchema.safeParse(raw)
            if (cancel.success) {
                active.get(cancel.data.id)?.abort()
                return
            }
            const parsed = streamRequestEnvelopeSchema.safeParse(raw)
            if (!parsed.success) {
                emit(extractId(raw), { type: 'error', code: 'failed', message: 'The request envelope was rejected.' })
                return
            }
            const { id, params } = parsed.data
            if (active.has(id)) return
            const controller = new AbortController()
            active.set(id, controller)
            try {
                const provider = getProvider()
                if (provider.runAgentTaskStream) {
                    await provider.runAgentTaskStream(params.capability, params.accountId, params.opportunityId, params.prompt, (event) => emit(id, event), controller.signal)
                } else {
                    const response = await provider.runAgentTask(params.capability, params.accountId, params.opportunityId, params.prompt)
                    emit(id, { type: 'complete', response })
                }
            } catch (error) {
                emit(id, { type: 'error', code: controller.signal.aborted ? 'cancelled' : 'failed', message: sanitizeMessage(error) })
            } finally {
                active.delete(id)
            }
        },
        dispose(): void {
            for (const controller of active.values()) controller.abort()
            active.clear()
        }
    }
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
            case 'searchKnowledge':
                return successResponse(id, knowledgeSearchResponseSchema.parse(
                    await provider.searchKnowledge(parseBridgeParams('searchKnowledge', parsed.data.params))))
            case 'cacheControl': {
                const input = parseBridgeParams('cacheControl', parsed.data.params)
                if (!provider.cacheSession) throw new Error('The presentation cache owner is unavailable.')
                if (input.operation === 'interest') provider.setCacheInterest?.(`webview:${input.consumer ?? 'main'}`, input.keys, input.active)
                if (input.operation === 'refresh') provider.cacheSession.refresh(input.opportunityId)
                return successResponse(id, cacheControlResponseSchema.parse({ contractVersion: '1.0', state: provider.cacheSession.getState() }))
            }
            case 'mutationSync': {
                const input = parseBridgeParams('mutationSync', parsed.data.params)
                if (!provider.mutationSync) {
                    if (input.operation !== 'capabilities') throw new Error('Durable source synchronization is not configured.')
                    return successResponse(id, { contractVersion: '1.0', kind: 'capabilities', capabilities: {
                        contractVersion: '1.0', available: false, readCacheOwner: 'host', operations: [],
                        reason: 'Protected durable source synchronization is unavailable in this provider.'
                    } })
                }
                return successResponse(id, mutationSyncResponseSchema.parse(await provider.mutationSync(input)))
            }
            case 'sellerDashboard': {
                const params = parseBridgeParams('sellerDashboard', parsed.data.params)
                if (!provider.sellerDashboard) throw new Error('The Seller Dashboard host is unavailable.')
                return successResponse(id, await provider.sellerDashboard.invoke(params))
            }
            case 'stagePipelineReview': {
                const params = parseBridgeParams('stagePipelineReview', parsed.data.params)
                if (!provider.stagePipelineReview) throw new Error('The Stage and Pipeline Review host is unavailable.')
                return successResponse(id, await provider.stagePipelineReview.invoke(params))
            }
            case 'seReporting': {
                const params = parseBridgeParams('seReporting', parsed.data.params)
                const host = provider.seReporting
                if (!host) throw new Error('The SE Reporting Dashboard host is unavailable.')
                return successResponse(id, await withFoundrySignIn(() => host.invoke(params)))
            }
            case 'voiceInput':
                return errorResponse(id, 'Voice input must be handled by the local presentation host.', 'host_only')
            case 'getCurrentUserEmail':
                return successResponse(id, await provider.getCurrentUserEmail() ?? null)
            case 'listAccounts': {
                const params = parseBridgeParams('listAccounts', parsed.data.params)
                return successResponse(id, await provider.listAccounts(params))
            }
            case 'getPortfolioIndex':
                return successResponse(id, portfolioIndexSchema.parse(await provider.getPortfolioIndex(parseBridgeParams('getPortfolioIndex', parsed.data.params))))
            case 'getPortfolioWorkspace':
                return successResponse(id, portfolioWorkspaceSchema.parse(await provider.getPortfolioWorkspace(parseBridgeParams('getPortfolioWorkspace', parsed.data.params))))
            case 'getDiscoverySnapshot':
                return successResponse(id, discoverySnapshotSchema.parse(await provider.getDiscoverySnapshot(parseBridgeParams('getDiscoverySnapshot', parsed.data.params))))
            case 'searchAccounts': {
                const params = parseBridgeParams('searchAccounts', parsed.data.params)
                return successResponse(id, await provider.searchAccounts(params))
            }
            case 'addAccount': {
                const params = parseBridgeParams('addAccount', parsed.data.params)
                return successResponse(id, await provider.addAccount(params.accountId))
            }
            case 'setAccountVisibility': {
                const params = parseBridgeParams('setAccountVisibility', parsed.data.params)
                return successResponse(id, await provider.setAccountVisibility(params.accountId, params.visibility))
            }
            case 'listOpportunities': {
                const params = parseBridgeParams('listOpportunities', parsed.data.params)
                return successResponse(id, await provider.listOpportunities(params.accountId))
            }
            case 'getRecordCreationCatalog': {
                const params = parseBridgeParams('getRecordCreationCatalog', parsed.data.params)
                return successResponse(id, recordCreationCatalogSchema.parse(await provider.getRecordCreationCatalog(params)))
            }
            case 'previewRecordCreation': {
                const params = parseBridgeParams('previewRecordCreation', parsed.data.params)
                return successResponse(id, recordCreationPreviewSchema.parse(await provider.previewRecordCreation(params)))
            }
            case 'commitRecordCreation': {
                const params = parseBridgeParams('commitRecordCreation', parsed.data.params)
                return successResponse(id, recordCreationResultSchema.parse(await provider.commitRecordCreation(params)))
            }
            case 'exportRecordCreationDraft': {
                const params = parseBridgeParams('exportRecordCreationDraft', parsed.data.params)
                return successResponse(id, recordCreationDraftResultSchema.parse(await provider.exportRecordCreationDraft(params)))
            }
            case 'discoverOpportunities': {
                const params = parseBridgeParams('discoverOpportunities', parsed.data.params)
                return successResponse(id, await provider.discoverOpportunities(params.domain))
            }
            case 'joinDealTeam': {
                const params = parseBridgeParams('joinDealTeam', parsed.data.params)
                return successResponse(id, await provider.joinDealTeam(params.opportunityId))
            }
            case 'leaveDealTeam': {
                const params = parseBridgeParams('leaveDealTeam', parsed.data.params)
                return successResponse(id, await provider.leaveDealTeam(params.opportunityId))
            }
            case 'joinMilestoneTeam': {
                const params = parseBridgeParams('joinMilestoneTeam', parsed.data.params)
                return successResponse(id, await provider.joinMilestoneTeam(params.opportunityId, params.milestoneId))
            }
            case 'leaveMilestoneTeam': {
                const params = parseBridgeParams('leaveMilestoneTeam', parsed.data.params)
                return successResponse(id, await provider.leaveMilestoneTeam(params.opportunityId, params.milestoneId))
            }
            case 'listMilestones': {
                const params = parseBridgeParams('listMilestones', parsed.data.params)
                return successResponse(id, await provider.listMilestones(params.opportunityId))
            }
            case 'listDiscoverableMilestones': {
                const params = parseBridgeParams('listDiscoverableMilestones', parsed.data.params)
                return successResponse(id, await provider.listDiscoverableMilestones(params.opportunityId))
            }
            case 'listMilestoneActivities': {
                const params = parseBridgeParams('listMilestoneActivities', parsed.data.params)
                return successResponse(id, await provider.listMilestoneActivities(params.opportunityId, params.milestoneId))
            }
            case 'createMilestoneActivity': {
                const params = parseBridgeParams('createMilestoneActivity', parsed.data.params)
                return successResponse(id, await provider.createMilestoneActivity(params.opportunityId, params.milestoneId, params.request))
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
            case 'getWorkflowResultsView': {
                const params = parseBridgeParams('getWorkflowResultsView', parsed.data.params)
                return successResponse(id, await provider.getWorkflowResultsView(params.runId, params.filter))
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
            case 'listMeetingTranscripts': {
                const params = parseBridgeParams('listMeetingTranscripts', parsed.data.params)
                return successResponse(id, await provider.listMeetingTranscripts(params?.opportunityId))
            }
            case 'getMeetingTranscript': {
                const params = parseBridgeParams('getMeetingTranscript', parsed.data.params)
                return successResponse(id, await provider.getMeetingTranscript(params.transcriptId))
            }
            case 'proposeMeetingChangeSet': {
                const params = parseBridgeParams('proposeMeetingChangeSet', parsed.data.params)
                const rawTranscript = params.rawTranscript
                    ? {
                        content: params.rawTranscript.content,
                        ...(params.rawTranscript.format ? { format: params.rawTranscript.format } : {}),
                        ...(params.rawTranscript.meetingType ? { meetingType: params.rawTranscript.meetingType } : {})
                    }
                    : undefined
                return successResponse(id, await provider.proposeMeetingChangeSet({
                    opportunityId: params.opportunityId,
                    ...(params.transcriptId ? { transcriptId: params.transcriptId } : {}),
                    ...(rawTranscript ? { rawTranscript } : {})
                }))
            }
            case 'applyMeetingChangeSet': {
                const params = parseBridgeParams('applyMeetingChangeSet', parsed.data.params)
                return successResponse(id, await provider.applyMeetingChangeSet({ proposal: params.proposal, approval: params.approval }))
            }
            case 'openEvidence':
                return errorResponse(id, 'openEvidence must be handled by the extension host.', 'host_only')
            case 'exportContent':
                return errorResponse(id, 'exportContent must be handled by the extension host.', 'host_only')
            case 'composeEmail':
                return errorResponse(id, 'composeEmail must be handled by the extension host.', 'host_only')
            case 'workingSessionOpenFolder':
                return errorResponse(id, 'workingSessionOpenFolder must be handled by the extension host.', 'host_only')
            case 'workingSessionTopic': {
                const host = provider.workingSession
                if (!host) throw new Error('Preparing a working session is not available on this connection.')
                const params = parseBridgeParams('workingSessionTopic', parsed.data.params)
                return successResponse(id, workingSessionTopicResponseSchema.parse(await withFoundrySignIn(() => host.deriveTopic(params))))
            }
            case 'workingSessionPrepare': {
                const host = provider.workingSession
                if (!host) throw new Error('Preparing a working session is not available on this connection.')
                const params = parseBridgeParams('workingSessionPrepare', parsed.data.params)
                return successResponse(id, workingSessionResultSchema.parse(await withFoundrySignIn(() => host.prepare(params))))
            }
            default:
                return errorResponse(id, 'The requested method is not supported.', 'unknown_method')
        }
    } catch (error) {
        return errorResponse(id, sanitizeMessage(error), 'request_failed')
    }
}
