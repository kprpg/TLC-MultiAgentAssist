import {
    accountSchema,
    accountCandidateSchema,
    agentTaskResponseSchema,
    agentTaskStreamEventSchema,
    contractVersion,
    workflowContractVersion,
    dealTeamJoinResultSchema,
    dealTeamLeaveResultSchema,
    discoverableOpportunitySchema,
    mcemStageTransitionRequestSchema,
    mcemStageTransitionResultSchema,
    mcemResponseSchema,
    meetingChangeSetProposalSchema,
    meetingChangeSetResultSchema,
    meetingTranscriptSchema,
    meetingTranscriptSummarySchema,
    milestoneSchema,
    milestoneActivitySchema,
    createMilestoneActivityRequestSchema,
    milestoneTeamJoinResultSchema,
    milestoneTeamLeaveResultSchema,
    milestoneUpdateSchema,
    opportunitySchema,
    opportunityUpdateSchema,
    recordCreationCatalogSchema,
    recordCreationCatalogRequestSchema,
    recordCreationPreviewSchema,
    recordCreationPreviewRequestSchema,
    recordCreationCommitRequestSchema,
    recordCreationResultSchema,
    recordCreationDraftResultSchema,
    workflowDefinitionSchema,
    workflowGuidanceHandoffSchema,
    workflowRunSchema,
    type ScopeRef,
    type WorkflowDefinition,
    type WorkflowGuidanceHandoff,
    type WorkflowRun,
    type Account,
    type AccountCandidate,
    type AccountListOptions,
    type AccountSearchRequest,
    type AccountVisibility,
    type AgentCapability,
    type AgentTaskResponse,
    type DealTeamJoinResult,
    type DealTeamLeaveResult,
    type DesktopDataStatus,
    type DiscoverableOpportunity,
    type EmailComposeRequest,
    type EmailComposeResult,
    type ExportResponseRequest,
    type ExportResponseResult,
    type McemResponse,
    type McemStageTransitionResult,
    type MeetingChangeSetApproval,
    type MeetingChangeSetProposal,
    type MeetingChangeSetResult,
    type MeetingTranscript,
    type MeetingTranscriptSummary,
    type MeetingType,
    type Milestone,
    type MilestoneActivity,
    type CreateMilestoneActivityRequest,
    type MilestoneTeamJoinResult,
    type MilestoneTeamLeaveResult,
    type MilestoneUpdate,
    type Opportunity,
    type OpportunityUpdate,
    type RecordCreationCatalog,
    type RecordCreationDraft,
    type RecordCreationPreview,
    type RecordCreationPreviewRequest,
    type RecordCreationResult,
    type RecordCreationDraftResult,
    type RecordCreationCommitRequest
} from '../../../../packages/common/contracts/index.js'
import type { SeDomainId } from '../../../../packages/common/configuration/se-domains.js'
import {
    workflowRunViewSchema,
    type WorkflowRunView
} from '../../../../packages/common/contracts/workflow-output.js'
import type { StartWorkflowHostRequest, WorkflowHostOperation } from '../../../../packages/orchestrator/workflows/host.js'
import { buildPreviewEvaluation } from './preview/preview-evaluation.js'
import { voiceRequestSchema, voiceResponseSchema, type VoiceRequest, type VoiceResponse } from '../../../../packages/common/contracts/voice.js'
import { sellerDashboardRequestSchema, sellerDashboardResponseSchema, type SellerDashboardRequest, type SellerDashboardResponse } from '../../../../packages/common/contracts/seller-dashboard.js'
import { createSampleSellerDashboard } from '../../../../packages/common/fixtures/seller-dashboard.js'
import { stagePipelineRequestSchema, stagePipelineResponseSchema, type StagePipelineRequest, type StagePipelineResponse } from '../../../../packages/common/contracts/stage-pipeline-review.js'
import { createSampleStagePipelineReview } from '../../../../packages/common/fixtures/stage-pipeline-review.js'
import { seReportingRequestSchema, seReportingResponseSchema, type SeReportingRequest, type SeReportingResponse } from '../../../../packages/common/contracts/se-reporting.js'
import { createPreviewSeReportingHost } from './preview/preview-reporting.js'
import {
    additionalSampleAccounts,
    additionalSampleMilestones,
    additionalSampleOpportunities
} from '../../../../packages/common/fixtures/additional-sample-portfolio.js'
import { withSampleOpportunityIntents } from '../../../../packages/common/fixtures/sample-opportunity-intent.js'
import { samplePortfolioDiscoveryOpportunities } from '../../../../packages/common/fixtures/sample-discovery.js'
import { portfolioReadVersion, portfolioReadRequestSchema, portfolioIndexSchema, portfolioWorkspaceRequestSchema, portfolioWorkspaceSchema, type PortfolioReadRequest, type PortfolioIndex, type PortfolioWorkspaceRequest, type PortfolioWorkspace } from '../../../../packages/common/contracts/index.js'
import { discoverySnapshotRequestSchema, discoverySnapshotSchema, discoverySnapshotVersion, type DiscoverySnapshot, type DiscoverySnapshotRequest } from '../../../../packages/common/contracts/index.js'
import { SessionPortfolio } from '../../../shared/session-portfolio.js'
import { createAgentStreamAccumulator, readNdjson, type AgentStreamProgress } from '../../../shared/agent-stream.js'
import { MutationSyncClient, type MutationInvoker } from '../../../shared/mutation-sync.js'
import * as syncContracts from '../../../../packages/common/contracts/index.js'
import { knowledgeSearchRequestSchema, knowledgeSearchResponseSchema, type KnowledgeSearchRequest, type KnowledgeSearchResponse } from '../../../../packages/common/contracts/knowledge.js'
import { sampleKnowledgeSearchResponse } from '../../../../packages/common/fixtures/knowledge.js'
import {
  workingSessionPrepareRequestSchema, workingSessionResultSchema, workingSessionTopicRequestSchema, workingSessionTopicResponseSchema,
  type WorkingSessionPrepareRequest, type WorkingSessionResult, type WorkingSessionTopicRequest, type WorkingSessionTopicResponse
} from '../../../../packages/common/contracts/working-session.js'
import type { WorkingSessionClient } from '../../../shared/working-session/types.js'
import { fetchAndSave } from '../../../shared/working-session/download.js'

export interface RevampDataClient extends WorkingSessionClient {
    searchKnowledge(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse>
    cacheSession?: SessionPortfolio
    mutationSession?: MutationSyncClient
    invokeMutationSync?: MutationInvoker
    onSourceCacheChanged?(listener: (state: syncContracts.CacheReadState) => void): () => void
    setActiveReads?(keys: readonly string[], active: boolean, consumer?: string): void | Promise<void>
    refreshSources?(opportunityId?: string): void
    getDataMode(): Promise<'sample' | 'live'>
    invokeSellerDashboard(request: SellerDashboardRequest): Promise<SellerDashboardResponse>
    invokeStagePipelineReview(request: StagePipelineRequest): Promise<StagePipelineResponse>
    invokeSeReporting(request: SeReportingRequest): Promise<SeReportingResponse>
    invokeVoice(request: VoiceRequest): Promise<VoiceResponse>
    readonly mode: 'desktop' | 'web-live' | 'web-sample'
    readonly canExitApplication?: boolean
    exitApplication(): Promise<void>
    getCurrentUserEmail(): Promise<string | undefined>
    listAccounts(options?: AccountListOptions): Promise<Account[]>
    getPortfolioIndex(request?: PortfolioReadRequest): Promise<PortfolioIndex>
    getPortfolioWorkspace(request: PortfolioWorkspaceRequest): Promise<PortfolioWorkspace>
    getDiscoverySnapshot(request?: DiscoverySnapshotRequest): Promise<DiscoverySnapshot>
    searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]>
    addAccount(accountId: string): Promise<Account>
    setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account>
    listOpportunities(accountId: string): Promise<Opportunity[]>
    getRecordCreationCatalog(accountId: string): Promise<RecordCreationCatalog>
    previewRecordCreation(target: RecordCreationPreviewRequest['target'], draft: RecordCreationDraft): Promise<RecordCreationPreview>
    commitRecordCreation(preview: RecordCreationPreview): Promise<RecordCreationResult>
    exportRecordCreationDraft(preview: RecordCreationPreview): Promise<RecordCreationDraftResult>
    discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]>
    joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult>
    leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult>
    joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult>
    leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult>
    listMilestones(opportunityId: string): Promise<Milestone[]>
    listDiscoverableMilestones(opportunityId: string): Promise<Milestone[]>
    listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]>
    createMilestoneActivity(opportunityId: string, milestoneId: string, request: CreateMilestoneActivityRequest): Promise<MilestoneActivity>
    listMeetingTranscripts(opportunityId?: string): Promise<MeetingTranscriptSummary[]>
    getMeetingTranscript(transcriptId: string): Promise<MeetingTranscript | null>
    proposeMeetingFromTranscript(opportunityId: string, transcriptId: string): Promise<MeetingChangeSetProposal>
    proposeMeetingFromRaw(opportunityId: string, content: string, meetingType: MeetingType, format?: 'vtt' | 'text'): Promise<MeetingChangeSetProposal>
    applyMeetingChangeSet(proposal: MeetingChangeSetProposal, approval: MeetingChangeSetApproval): Promise<MeetingChangeSetResult>
    updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone>
    updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity>
    transitionOpportunityStage(accountId: string, opportunityId: string, targetStage: number, reason?: string): Promise<McemStageTransitionResult>
    runMcemCoach(accountId: string, opportunityId: string): Promise<McemResponse>
    runAgentTask(capability: AgentCapability, accountId: string, opportunityId: string, prompt: string): Promise<AgentTaskResponse>
    /** Progressive variant (instant draft, streamed text, authoritative final); callers fall back to `runAgentTask` when absent. */
    runAgentTaskStream?(capability: AgentCapability, accountId: string, opportunityId: string, prompt: string, onProgress?: (progress: AgentStreamProgress) => void, signal?: AbortSignal): Promise<AgentTaskResponse>
    openEmailCompose(request: EmailComposeRequest): Promise<EmailComposeResult>
    exportAgentResponse(request: ExportResponseRequest): Promise<ExportResponseResult>
    openEvidence(url: string): Promise<void>
    listWorkflowDefinitions(scope?: ScopeRef['kind']): Promise<WorkflowDefinition[]>
    startWorkflow(request: StartWorkflowHostRequest): Promise<WorkflowRun>
    getWorkflowRun(runId: string): Promise<WorkflowRunView>
    cancelWorkflowRun(runId: string): Promise<WorkflowRun>
    listWorkflowRuns(scope?: ScopeRef, limit?: number): Promise<WorkflowRun[]>
    prepareWorkflowGuidance(runId: string, queueItemId: string, capability: AgentCapability): Promise<WorkflowGuidanceHandoff>
}

type Fetcher = typeof fetch & {
    assertScope?(generation?: number): void
    scopeVersion?(): number
}

class WebApiRequestError extends Error {
    constructor(readonly status: number, message: string, readonly retryAfterMs?: number) {
        super(message)
    }
}

function downloadBlob(blob: Blob, fileName: string): void {
    const downloadUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = fileName
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 0)
}

async function apiRequest(fetcher: Fetcher, path: string, init?: RequestInit): Promise<unknown> {
    const generation = fetcher.scopeVersion?.()
    const response = await fetcher(path, {
        ...init,
        credentials: 'same-origin',
        headers: {
            accept: 'application/json',
            ...(init?.body ? { 'content-type': 'application/json' } : {}),
            ...init?.headers
        }
    })
    const payload = await response.json().catch(() => null) as { error?: string } | null
    if (!response.ok) {
        const retry = response.headers.get('retry-after')
        const delay = retry === null ? undefined : /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())
        throw new WebApiRequestError(response.status, payload?.error ?? `The server request failed (${response.status}).`,
            delay !== undefined && Number.isFinite(delay) ? delay : undefined)
    }
    fetcher.assertScope?.(generation)
    return payload
}

export function createWebApiClient(fetcher: Fetcher = fetch, mode: 'web-live' | 'web-sample' = 'web-live'): RevampDataClient {
    const baseFetcher = fetcher
    let scope: string | undefined
    let generation = 0
    let invalidated = false
    const listeners = new Set<(state: syncContracts.CacheReadState) => void>()
    const state = (): syncContracts.CacheReadState => ({ revision: generation, generation, refreshing: false, stale: false })
    const invalidate = () => { generation++; for (const listener of listeners) listener(state()) }
    fetcher = Object.assign(async (input: Parameters<Fetcher>[0], init?: RequestInit) => {
        if (invalidated) throw new WebApiRequestError(401, 'The source identity changed. Reload this page before reading private data.')
        const response = await baseFetcher(input, init)
        const identity = response.headers.get('x-tlc-source-scope')
        if (scope !== undefined && identity !== null && scope !== identity) {
            invalidated = true; invalidate()
            throw new WebApiRequestError(401, 'The source identity changed. Reload this page before reading private data.')
        }
        if (identity !== null) scope = identity
        if (response.status === 401) invalidate()
        return response
    }, {
        scopeVersion: () => generation,
        assertScope: (started?: number) => {
            if (invalidated || started !== undefined && started !== generation) throw new WebApiRequestError(401, 'Source access changed. Reload before reading private data.')
        }
    })
    const background = typeof document !== 'undefined' && document.querySelector<HTMLMetaElement>('meta[name="tlc-background-sync"]')?.content === '1'
    const invokeWorkflow = (operation: WorkflowHostOperation, request: unknown) => apiRequest(
        fetcher,
        `/api/workflows/${operation}`,
        { method: 'POST', body: JSON.stringify(request) }
    )
    return {
        onSourceCacheChanged: (listener) => { listeners.add(listener); listener(state()); return () => listeners.delete(listener) },
        ...(background ? { invokeMutationSync: async (request: syncContracts.MutationSyncRequest) =>
            syncContracts.mutationSyncResponseSchema.parse(await apiRequest(fetcher, '/api/mutation-sync', { method: 'POST', body: JSON.stringify(request) })) } : {}),
        mode,
        canExitApplication: typeof document !== 'undefined'
            && document.querySelector<HTMLMetaElement>('meta[name="tlc-local-exit"]')?.content === '1',
        getDataMode: async () => mode === 'web-live' ? 'live' : 'sample',
        searchKnowledge: async (request) => knowledgeSearchResponseSchema.parse(await apiRequest(fetcher, '/api/knowledge/search', {
            method: 'POST', body: JSON.stringify(knowledgeSearchRequestSchema.parse(request))
        })),
        deriveWorkingSessionTopic: async (request) => workingSessionTopicResponseSchema.parse(await apiRequest(fetcher, '/api/working-session/topic', {
            method: 'POST', body: JSON.stringify(workingSessionTopicRequestSchema.parse(request))
        })),
        prepareWorkingSession: async (request) => workingSessionResultSchema.parse(await apiRequest(fetcher, '/api/working-session/prepare', {
            method: 'POST', body: JSON.stringify(workingSessionPrepareRequestSchema.parse(request))
        })),
        downloadWorkingSession: (downloadId, fileName) => fetchAndSave(fetcher, `/api/working-session/download/${encodeURIComponent(downloadId)}`, fileName),
        invokeSellerDashboard: async (request) => sellerDashboardResponseSchema.parse(await apiRequest(fetcher, '/api/seller-dashboard', {
            method: 'POST', body: JSON.stringify(sellerDashboardRequestSchema.parse(request))
        })),
        invokeStagePipelineReview: async (request) => stagePipelineResponseSchema.parse(await apiRequest(fetcher, '/api/stage-pipeline-review', {
            method: 'POST', body: JSON.stringify(stagePipelineRequestSchema.parse(request))
        })),
        invokeSeReporting: async (request) => seReportingResponseSchema.parse(await apiRequest(fetcher, '/api/se-reporting', {
            method: 'POST', body: JSON.stringify(seReportingRequestSchema.parse(request))
        })),
        invokeVoice: async (request) => voiceResponseSchema.parse(await apiRequest(fetcher, '/api/voice', {
            method: 'POST', body: JSON.stringify(voiceRequestSchema.parse(request))
        })),
        exitApplication: async () => { await apiRequest(fetcher, '/api/exit', { method: 'POST' }) },
        getCurrentUserEmail: async () => {
            const result = await apiRequest(fetcher, '/api/me') as { email?: unknown }
            return typeof result.email === 'string' ? result.email : undefined
        },
        getDiscoverySnapshot: async (request = { contractVersion: discoverySnapshotVersion }) => discoverySnapshotSchema.parse(
            await apiRequest(fetcher, '/api/discovery/snapshot', { method: 'POST', body: JSON.stringify(discoverySnapshotRequestSchema.parse(request)) })
        ),
        listAccounts: async (options) => accountSchema.array().parse(await apiRequest(fetcher, `/api/accounts${options?.includeHidden ? '?includeHidden=true' : ''}`)),
        getPortfolioIndex: async (request = { contractVersion: portfolioReadVersion }) => portfolioIndexSchema.parse(await apiRequest(fetcher, '/api/portfolio/index', {
            method: 'POST', body: JSON.stringify(portfolioReadRequestSchema.parse(request))
        })),
        getPortfolioWorkspace: async (request) => portfolioWorkspaceSchema.parse(await apiRequest(fetcher, '/api/portfolio/workspace', {
            method: 'POST', body: JSON.stringify(portfolioWorkspaceRequestSchema.parse(request))
        })),
        searchAccounts: async (request) => accountCandidateSchema.array().parse(await apiRequest(fetcher, `/api/account-candidates?matchBy=${encodeURIComponent(request.matchBy)}&query=${encodeURIComponent(request.query)}`)),
        addAccount: async (accountId) => accountSchema.parse(await apiRequest(fetcher, '/api/accounts', { method: 'POST', body: JSON.stringify({ accountId }) })),
        setAccountVisibility: async (accountId, visibility) => accountSchema.parse(await apiRequest(fetcher, `/api/accounts/${encodeURIComponent(accountId)}/visibility`, { method: 'PATCH', body: JSON.stringify({ visibility }) })),
        listOpportunities: async (accountId) => opportunitySchema.array().parse(await apiRequest(fetcher, `/api/accounts/${encodeURIComponent(accountId)}/opportunities`)),
        getRecordCreationCatalog: async (accountId) => recordCreationCatalogSchema.parse(await apiRequest(fetcher,
            `/api/record-creation/catalog?accountId=${encodeURIComponent(accountId)}`)),
        previewRecordCreation: async (target, draft) => recordCreationPreviewSchema.parse(await apiRequest(fetcher,
            '/api/record-creation/preview',
            { method: 'POST', body: JSON.stringify(recordCreationPreviewRequestSchema.parse({ contractVersion, target, draft })) }
        )),
        commitRecordCreation: async (preview) => recordCreationResultSchema.parse(await apiRequest(fetcher,
            '/api/record-creation/commit',
            { method: 'POST', body: JSON.stringify(recordCreationCommitRequestSchema.parse({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true })) }
        )),
        exportRecordCreationDraft: async (preview) => recordCreationDraftResultSchema.parse(await apiRequest(fetcher,
            '/api/record-creation/draft',
            { method: 'POST', body: JSON.stringify(recordCreationCommitRequestSchema.parse({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true })) }
        )),
        discoverOpportunities: async (domain) => discoverableOpportunitySchema.array().parse(await apiRequest(fetcher, `/api/discover/${encodeURIComponent(domain)}`)),
        joinDealTeam: async (opportunityId) => dealTeamJoinResultSchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/deal-team`, { method: 'POST', body: JSON.stringify({}) })),
        leaveDealTeam: async (opportunityId) => dealTeamLeaveResultSchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/deal-team`, { method: 'DELETE', body: JSON.stringify({}) })),
        joinMilestoneTeam: async (opportunityId, milestoneId) => milestoneTeamJoinResultSchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/milestones/${encodeURIComponent(milestoneId)}/team/me`, { method: 'POST', body: JSON.stringify({}) })),
        leaveMilestoneTeam: async (opportunityId, milestoneId) => milestoneTeamLeaveResultSchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/milestones/${encodeURIComponent(milestoneId)}/team/me`, { method: 'DELETE', body: JSON.stringify({}) })),
        listMilestones: async (opportunityId) => milestoneSchema.array().parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/milestones`)),
        listDiscoverableMilestones: async (opportunityId) => milestoneSchema.array().parse(await apiRequest(fetcher, `/api/discover/opportunities/${encodeURIComponent(opportunityId)}/milestones`)),
        listMilestoneActivities: async (opportunityId, milestoneId) => milestoneActivitySchema.array().parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/milestones/${encodeURIComponent(milestoneId)}/activities`)),
        createMilestoneActivity: async (opportunityId, milestoneId, request) => milestoneActivitySchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/milestones/${encodeURIComponent(milestoneId)}/activities`, { method: 'POST', body: JSON.stringify(createMilestoneActivityRequestSchema.parse(request)) })),
        listMeetingTranscripts: async (opportunityId) => meetingTranscriptSummarySchema.array().parse(await apiRequest(fetcher, `/api/meeting-transcripts${opportunityId ? `?opportunityId=${encodeURIComponent(opportunityId)}` : ''}`)),
        getMeetingTranscript: async (transcriptId) => meetingTranscriptSchema.nullable().parse(await apiRequest(fetcher, `/api/meeting-transcripts/${encodeURIComponent(transcriptId)}`)),
        proposeMeetingFromTranscript: async (opportunityId, transcriptId) => meetingChangeSetProposalSchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/meeting-change-set`, { method: 'POST', body: JSON.stringify({ transcriptId }) })),
        proposeMeetingFromRaw: async (opportunityId, content, meetingType, format) => meetingChangeSetProposalSchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/meeting-change-set`, { method: 'POST', body: JSON.stringify({ rawTranscript: { content, meetingType, ...(format ? { format } : {}) } }) })),
        applyMeetingChangeSet: async (proposal, approval) => meetingChangeSetResultSchema.parse(await apiRequest(fetcher, '/api/meeting-change-set/apply', { method: 'POST', body: JSON.stringify({ proposal, approval }) })),
        updateMilestone: async (opportunityId, milestoneId, update) => milestoneSchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/milestones/${encodeURIComponent(milestoneId)}`, { method: 'PATCH', body: JSON.stringify(milestoneUpdateSchema.parse(update)) })),
        updateOpportunity: async (opportunityId, update) => opportunitySchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}`, { method: 'PATCH', body: JSON.stringify(opportunityUpdateSchema.parse(update)) })),
        transitionOpportunityStage: async (accountId, opportunityId, targetStage, reason) => mcemStageTransitionResultSchema.parse(await apiRequest(fetcher, '/api/mcem-stage-transition', {
            method: 'POST',
            body: JSON.stringify(mcemStageTransitionRequestSchema.parse({ contractVersion, accountId, opportunityId, targetStage, reason }))
        })),
        runMcemCoach: async (accountId, opportunityId) => mcemResponseSchema.parse(await apiRequest(fetcher, '/api/mcem-coach', {
            method: 'POST',
            body: JSON.stringify({ contractVersion, accountId, opportunityId, prompt: 'How do we move this opportunity to the next MCEM stage?' })
        })),
        runAgentTask: async (capability, accountId, opportunityId, prompt) => agentTaskResponseSchema.parse(await apiRequest(fetcher, '/api/agent-task', {
            method: 'POST',
            body: JSON.stringify({ contractVersion, capability, accountId, opportunityId, prompt })
        })),
        runAgentTaskStream: async (capability, accountId, opportunityId, prompt, onProgress, signal) => {
            const generation = fetcher.scopeVersion?.()
            const response = await fetcher('/api/agent-task/stream', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { accept: 'application/x-ndjson', 'content-type': 'application/json' },
                body: JSON.stringify({ contractVersion, capability, accountId, opportunityId, prompt }),
                ...(signal ? { signal } : {})
            })
            if (!response.ok || !response.body) {
                const payload = await response.json().catch(() => null) as { error?: string } | null
                throw new WebApiRequestError(response.status, payload?.error ?? `The server request failed (${response.status}).`)
            }
            const accumulator = createAgentStreamAccumulator(onProgress)
            await readNdjson(response.body, (value) => {
                fetcher.assertScope?.(generation)
                accumulator.push(agentTaskStreamEventSchema.parse(value))
            }, signal)
            return accumulator.result()
        },
        openEmailCompose: async (request) => {
            const response = await fetcher('/api/open-email-compose', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { accept: 'message/rfc822', 'content-type': 'application/json' },
                body: JSON.stringify(request)
            })
            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null
                throw new Error(payload?.error ?? `The server request failed (${response.status}).`)
            }
            const blob = await response.blob()
            fetcher.assertScope?.()
            downloadBlob(blob, response.headers.get('x-tlc-file-name') || 'TLC-agent-response.eml')
            return { state: 'opened' }
        },
        exportAgentResponse: async (request) => {
            const response = await fetcher('/api/export-agent-response', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { accept: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-type': 'application/json' },
                body: JSON.stringify(request)
            })
            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null
                throw new Error(payload?.error ?? `The server request failed (${response.status}).`)
            }
            const blob = await response.blob()
            fetcher.assertScope?.()
            const fileName = response.headers.get('x-tlc-file-name') || 'TLC-agent-response.docx'
            downloadBlob(blob, fileName)
            return { state: 'saved', filePath: fileName }
        },
        openEvidence: async (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
        listWorkflowDefinitions: async (scope) => workflowDefinitionSchema.array().parse(await invokeWorkflow('list', { contractVersion: workflowContractVersion, ...(scope ? { scope } : {}) })),
        startWorkflow: async (request) => workflowRunSchema.parse(await invokeWorkflow('start', request)),
        getWorkflowRun: async (runId) => workflowRunViewSchema.parse(await invokeWorkflow('get', { contractVersion: workflowContractVersion, runId })),
        cancelWorkflowRun: async (runId) => workflowRunSchema.parse(await invokeWorkflow('cancel', { contractVersion: workflowContractVersion, runId })),
        listWorkflowRuns: async (scope, limit) => workflowRunSchema.array().parse(await invokeWorkflow('history', {
            contractVersion: workflowContractVersion,
            ...(scope ? { scope } : {}),
            ...(limit === undefined ? {} : { limit })
        })),
        prepareWorkflowGuidance: async (runId, queueItemId, capability) => workflowGuidanceHandoffSchema.parse(await invokeWorkflow('guidance', {
            contractVersion: workflowContractVersion, runId, queueItemId, capability
        }))
    }
}

interface DesktopBridge {
    searchKnowledge(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse>
    deriveWorkingSessionTopic(request: WorkingSessionTopicRequest): Promise<WorkingSessionTopicResponse>
    prepareWorkingSession(request: WorkingSessionPrepareRequest): Promise<WorkingSessionResult>
    openWorkingSessionFolder(folderPath: string): Promise<void>
    invokeMutationSync?: MutationInvoker
    onCacheChanged?(listener: (state: syncContracts.CacheReadState) => void): () => void
    cacheControl?(request: syncContracts.CacheControlRequest): Promise<syncContracts.CacheControlResponse>
    setActiveReads?(keys: readonly string[], active: boolean): void
    getPortfolioIndex(request: PortfolioReadRequest): Promise<PortfolioIndex>
    getPortfolioWorkspace(request: PortfolioWorkspaceRequest): Promise<PortfolioWorkspace>
    invokeSellerDashboard(request: SellerDashboardRequest): Promise<SellerDashboardResponse>
    invokeStagePipelineReview(request: StagePipelineRequest): Promise<StagePipelineResponse>
    invokeSeReporting(request: SeReportingRequest): Promise<SeReportingResponse>
    invokeVoice(request: VoiceRequest): Promise<VoiceResponse>
    exitApplication(): Promise<void>
    getDataStatus(): Promise<DesktopDataStatus>
    getDiscoverySnapshot(request: DiscoverySnapshotRequest): Promise<DiscoverySnapshot>
    listAccounts(options?: AccountListOptions): Promise<Account[]>
    searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]>
    addAccount(accountId: string): Promise<Account>
    setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account>
    listOpportunities(accountId: string): Promise<Opportunity[]>
    getRecordCreationCatalog(request: { contractVersion: typeof contractVersion; accountId: string }): Promise<RecordCreationCatalog>
    previewRecordCreation(request: RecordCreationPreviewRequest): Promise<RecordCreationPreview>
    commitRecordCreation(request: RecordCreationCommitRequest): Promise<RecordCreationResult>
    exportRecordCreationDraft(request: RecordCreationCommitRequest): Promise<RecordCreationDraftResult>
    discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]>
    joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult>
    leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult>
    joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult>
    leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult>
    listMilestones(opportunityId: string): Promise<Milestone[]>
    listDiscoverableMilestones(opportunityId: string): Promise<Milestone[]>
    listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]>
    createMilestoneActivity(opportunityId: string, milestoneId: string, request: CreateMilestoneActivityRequest): Promise<MilestoneActivity>
    listMeetingTranscripts(opportunityId?: string): Promise<MeetingTranscriptSummary[]>
    getMeetingTranscript(transcriptId: string): Promise<MeetingTranscript | null>
    proposeMeetingChangeSet(request: { opportunityId: string; transcriptId?: string; rawTranscript?: { content: string; format?: 'vtt' | 'text'; meetingType?: MeetingType } }): Promise<MeetingChangeSetProposal>
    applyMeetingChangeSet(proposal: MeetingChangeSetProposal, approval: MeetingChangeSetApproval): Promise<MeetingChangeSetResult>
    updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone>
    updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity>
    transitionOpportunityStage(request: { contractVersion: typeof contractVersion; accountId: string; opportunityId: string; targetStage: number; reason?: string }): Promise<McemStageTransitionResult>
    runMcemCoach(request: { contractVersion: typeof contractVersion; accountId: string; opportunityId: string; prompt: string }): Promise<McemResponse>
    runAgentTask(request: { contractVersion: typeof contractVersion; capability: AgentCapability; accountId: string; opportunityId: string; prompt: string }): Promise<AgentTaskResponse>
    runAgentTaskStream?(request: { contractVersion: typeof contractVersion; capability: AgentCapability; accountId: string; opportunityId: string; prompt: string }, onEvent: (event: unknown) => void): { cancel(): void; done: Promise<void> }
    openEmailCompose(request: EmailComposeRequest): Promise<EmailComposeResult>
    exportAgentResponse(request: ExportResponseRequest): Promise<ExportResponseResult>
    openEvidence(url: string): Promise<void>
    invokeWorkflow(operation: WorkflowHostOperation, request: unknown): Promise<unknown>
}

declare global {
    interface Window {
        tlc?: DesktopBridge
    }
}

const accounts: Account[] = [
    { id: 'account-contoso', name: 'Contoso Energy', segment: 'Strategic', tpid: '1000001' },
    { id: 'account-fabrikam', name: 'Fabrikam Retail', segment: 'Enterprise', tpid: '1000002' },
    { id: 'account-northwind', name: 'Northwind Health', segment: 'Enterprise', tpid: '1000003' },
    { id: 'account-zava', name: 'Zava Inc.', segment: 'Strategic', tpid: '1000004' },
    { id: 'account-adventureworks', name: 'Adventure Works Cycles', segment: 'Enterprise', tpid: '1000005' },
    ...additionalSampleAccounts
]

const opportunities: Opportunity[] = withSampleOpportunityIntents([
    { id: 'opp-grid-modernization', accountId: 'account-contoso', name: 'Grid operations modernization', owner: 'Avery Johnson', recordedStage: 3, value: 4200000, currency: 'USD', closeDate: '2026-10-30' },
    { id: 'opp-cloud-security-readiness', accountId: 'account-contoso', name: 'Cloud security readiness', owner: 'Jordan Lee', recordedStage: 1, value: 900000, currency: 'USD', closeDate: '2027-02-26' },
    { id: 'opp-data-estate-consolidation', accountId: 'account-contoso', name: 'Data estate consolidation', recordedStage: 2, value: 2650000, currency: 'USD', closeDate: '2027-01-29' },
    { id: 'opp-resilient-cloud-foundation', accountId: 'account-contoso', name: 'Resilient cloud foundation - ready to advance', recordedStage: 1, value: 1450000, currency: 'USD', closeDate: '2027-03-12' },
    { id: 'opp-ai-service', accountId: 'account-fabrikam', name: 'AI-assisted customer service', recordedStage: 2, value: 1750000, currency: 'USD', closeDate: '2026-12-18' },
    { id: 'opp-store-modernization', accountId: 'account-fabrikam', name: 'Connected store modernization', recordedStage: 1, value: 1200000, currency: 'USD', closeDate: '2027-03-19' },
    { id: 'opp-unified-commerce', accountId: 'account-fabrikam', name: 'Unified commerce platform', recordedStage: 3, value: 3800000, currency: 'USD', closeDate: '2026-12-11' },
    { id: 'opp-customer-data-platform', accountId: 'account-fabrikam', name: 'Customer data platform - ready to advance', owner: 'Morgan Lee', recordedStage: 2, value: 3200000, currency: 'USD', closeDate: '2027-01-15' },
    { id: 'opp-zava-ai-platform', accountId: 'account-zava', name: 'Zava AI platform foundation', owner: 'Avery Johnson', recordedStage: 2, value: 2900000, currency: 'USD', closeDate: '2027-04-02' },
    { id: 'opp-zava-migration', accountId: 'account-zava', name: 'Zava datacenter exit', recordedStage: 1, value: 1600000, currency: 'USD', closeDate: '2027-05-28' },
    { id: 'opp-aw-commerce', accountId: 'account-adventureworks', name: 'Adventure Works commerce replatform', owner: 'Morgan Diaz', recordedStage: 3, value: 3100000, currency: 'USD', closeDate: '2027-01-08' },
    ...additionalSampleOpportunities
])

const discoverableOpportunities: DiscoverableOpportunity[] = [
    ...samplePortfolioDiscoveryOpportunities(accounts, opportunities),
    { id: 'opp-discover-hybrid-networking', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Hybrid networking modernization', recordedStage: 2, value: 1850000, currency: 'USD', closeDate: '2027-02-12', domain: 'infra', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Advanced Networking', onDealTeam: false },
    { id: 'opp-discover-vmware-migration', accountId: 'account-fabrikam', accountName: 'Fabrikam Retail', name: 'Datacenter exit to Azure VMware Solution', recordedStage: 1, value: 2950000, currency: 'USD', closeDate: '2027-04-02', domain: 'infra', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Azure VMware Solutions', onDealTeam: false },
    { id: 'opp-discover-synapse-analytics', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Enterprise analytics on Synapse and Power BI', recordedStage: 2, value: 2100000, currency: 'USD', closeDate: '2027-01-22', domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'New Analytics with Synapse & PowerBI', onDealTeam: false },
    { id: 'opp-discover-sql-managed-instance', accountId: 'account-fabrikam', accountName: 'Fabrikam Retail', name: 'SQL Server migration to Azure SQL MI', recordedStage: 3, value: 1650000, currency: 'USD', closeDate: '2026-12-19', domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'SQL Server Migration to Azure SQL MI', onDealTeam: false },
    { id: 'opp-discover-azure-ai-ml', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Azure AI and ML platform adoption', recordedStage: 2, value: 3400000, currency: 'USD', closeDate: '2027-02-05', domain: 'ai-apps', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Azure AI and ML', onDealTeam: false },
    { id: 'opp-discover-cloud-native-apps', accountId: 'account-fabrikam', accountName: 'Fabrikam Retail', name: 'Cloud-native apps on AKS and Cosmos DB', recordedStage: 1, value: 2750000, currency: 'USD', closeDate: '2027-03-27', domain: 'ai-apps', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB', onDealTeam: false },
    { id: 'opp-discover-zero-trust', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Zero Trust security modernization', recordedStage: 2, value: 2200000, currency: 'USD', closeDate: '2027-02-18', domain: 'security', solutionArea: 'Security', technicalCapability: 'Threat Protection', onDealTeam: false },
    { id: 'opp-discover-teams-calling', accountId: 'account-fabrikam', accountName: 'Fabrikam Retail', name: 'Teams Phone and calling rollout', recordedStage: 1, value: 980000, currency: 'USD', closeDate: '2027-03-05', domain: 'modern-work', technicalCapability: 'Calling', onDealTeam: false },
    { id: 'opp-discover-d365-customer-service', accountId: 'account-fabrikam', accountName: 'Fabrikam Retail', name: 'Dynamics 365 Customer Service transformation', recordedStage: 2, value: 1750000, currency: 'USD', closeDate: '2027-01-28', domain: 'biz-apps', solutionArea: 'AI Business Solutions', technicalCapability: 'Customer Service', onDealTeam: false },
    { id: 'opp-discover-surface-deployment', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Surface device deployment and management', recordedStage: 1, value: 640000, currency: 'USD', closeDate: '2027-04-15', domain: 'devices', solutionArea: 'Windows and Devices', technicalCapability: 'Surface & Partner Devices', onDealTeam: false },
    { id: 'opp-discover-cloud-advisory', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Cloud advisory and adoption services', recordedStage: 2, value: 850000, currency: 'USD', closeDate: '2027-02-22', domain: 'services', solutionArea: 'Microsoft Services', technicalCapability: 'Advisory Services', onDealTeam: false },
    { id: 'opp-discover-northwind-data', accountId: 'account-northwind', accountName: 'Northwind Health', name: 'Clinical data platform modernization', recordedStage: 1, value: 2100000, currency: 'USD', closeDate: '2027-05-20', domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Analytics', onDealTeam: false }
]

const dealTeamOpportunityIds = new Set(opportunities.map((opportunity) => opportunity.id))
const manualAccountIds = new Set<string>()
const hiddenAccountIds = new Set<string>()

function sampleAccountRows(includeHidden = false): Account[] {
    const dealTeamAccountIds = new Set(opportunities
        .filter((opportunity) => dealTeamOpportunityIds.has(opportunity.id))
        .map((opportunity) => opportunity.accountId))
    return accounts
        .filter((account) => dealTeamAccountIds.has(account.id) || manualAccountIds.has(account.id) || hiddenAccountIds.has(account.id))
        .map((account) => ({
            ...account,
            provenance: dealTeamAccountIds.has(account.id) && manualAccountIds.has(account.id)
                ? 'both' as const
                : manualAccountIds.has(account.id) ? 'manual' as const : 'deal-team' as const,
            visibility: hiddenAccountIds.has(account.id) ? 'hidden' as const : 'visible' as const
        }))
        .filter((account) => includeHidden || account.visibility !== 'hidden')
}

const milestones: Milestone[] = opportunities.flatMap((opportunity, index) => {
    const shared = additionalSampleMilestones.filter((milestone) => milestone.opportunityId === opportunity.id)
    return shared.length > 0 ? shared : [{
        id: `${opportunity.id}-milestone`,
        opportunityId: opportunity.id,
        name: index % 2 === 0 ? 'Customer outcome validation' : 'Technical validation workshop',
        status: index % 3 === 0 ? 'On track' : 'In progress',
        targetDate: opportunity.closeDate,
        estimatedMonthlyUsage: opportunity.value / 12,
        owner: opportunity.owner ?? 'Account team',
        commitment: index % 2 === 0 ? 'Committed' : 'Best case'
    }]
})
// A representative subset of milestones the signed-in sample user is on, so both the "+" (join)
// and "-" (leave) states are visible in the in-browser sample. Independent of Deal Team membership.
const milestoneTeamIds = new Set(milestones.filter((_milestone, index) => index % 2 === 0).map((milestone) => milestone.id))
// Discoverable opportunities each get a milestone so Discovery milestone expansion is demoable.
const discoverableMilestones: Milestone[] = discoverableOpportunities.map((opportunity) => ({
    id: `${opportunity.id}-milestone`,
    opportunityId: opportunity.id,
    name: 'Customer outcome validation',
    status: 'On track',
    targetDate: opportunity.closeDate,
    estimatedMonthlyUsage: opportunity.value / 12,
    owner: 'Account team',
    commitment: 'Best case'
}))
// In-memory milestone activities (Tasks) keyed by milestone id, seeded so the list is non-empty.
const milestoneActivities: MilestoneActivity[] = [{
    id: 'act-sample-seed', milestoneId: milestones[0]?.id ?? 'milestone-0', opportunityId: milestones[0]?.opportunityId ?? '',
    subject: 'Architecture design session', activityType: 'task', status: 'Open', priority: 'Normal',
    taskCategory: 'Architecture Design Session', due: opportunities[0]?.closeDate, owner: 'Account team', createdBy: 'Account team'
}]
let webSampleActivitySequence = 0
const roleByStage = ['Account Executive', 'Specialist / SSP', 'Solution Engineer', 'Cloud Solution Architect', 'CSAM']

function webClient(): RevampDataClient {
    const seReporting = createPreviewSeReportingHost()
    const unavailable = (): never => {
        throw new Error('Record creation needs the hosted Web app or Desktop. The standalone preview does not save records.')
    }
    return {
        mode: 'web-sample',
        getDataMode: async () => 'sample',
        searchKnowledge: async (request) => sampleKnowledgeSearchResponse(request),
        deriveWorkingSessionTopic: async () => unavailable(),
        prepareWorkingSession: async () => unavailable(),
        invokeSellerDashboard: async (request) => {
            sellerDashboardRequestSchema.parse(request)
            return createSampleSellerDashboard()
        },
        invokeStagePipelineReview: async (request) => {
            const input = stagePipelineRequestSchema.parse(request)
            return createSampleStagePipelineReview({ scope: input.scope, ...(input.reportIds ? { reportIds: input.reportIds } : {}) })
        },
        invokeSeReporting: (request) => seReporting.invoke(request),
        exitApplication: async () => { await apiRequest(fetch, '/api/exit', { method: 'POST' }) },
        getCurrentUserEmail: async () => undefined,
        async getDiscoverySnapshot(input = { contractVersion: discoverySnapshotVersion }) {
            discoverySnapshotRequestSchema.parse(input)
            const portfolio = await this.getPortfolioIndex({ contractVersion: portfolioReadVersion, includeHidden: true })
            const visibleIds = new Set(portfolio.accounts.filter((account) => account.visibility !== 'hidden').map((account) => account.id))
            return discoverySnapshotSchema.parse({
                contractVersion: discoverySnapshotVersion, generatedAt: new Date().toISOString(), accounts: portfolio.accounts,
                portfolioOpportunities: portfolio.opportunities,
                opportunities: discoverableOpportunities.filter((item) => visibleIds.has(item.accountId))
                    .map((item) => ({ ...item, onDealTeam: dealTeamOpportunityIds.has(item.id) })),
                milestoneTeamOpportunityIds: [...new Set(milestones.filter((item) => item.onMilestoneTeam).map((item) => item.opportunityId))]
            })
        },
        listAccounts: async (options) => structuredClone(sampleAccountRows(options?.includeHidden)),
        getPortfolioIndex: async (input = { contractVersion: portfolioReadVersion }) => {
            const request = portfolioReadRequestSchema.parse(input)
            const accountRows = sampleAccountRows(request.includeHidden)
            const visibleIds = new Set(accountRows.filter((item) => item.visibility !== 'hidden').map((item) => item.id))
            return portfolioIndexSchema.parse({ contractVersion: portfolioReadVersion, accounts: accountRows,
                opportunities: opportunities.filter((item) => visibleIds.has(item.accountId) && dealTeamOpportunityIds.has(item.id)) })
        },
        async getPortfolioWorkspace(input) {
            const request = portfolioWorkspaceRequestSchema.parse(input)
            const index = await this.getPortfolioIndex({ contractVersion: portfolioReadVersion, ...(request.includeHidden === undefined ? {} : { includeHidden: request.includeHidden }) })
            const account = request.accountId ? index.accounts.find((item) => item.id === request.accountId && item.visibility !== 'hidden') : index.accounts.find((item) => item.visibility !== 'hidden')
            if (request.accountId && !account) throw new Error('The selected account is not in the current visible portfolio.')
            const items = index.opportunities.filter((item) => item.accountId === account?.id)
            const opportunity = request.opportunityId ? items.find((item) => item.id === request.opportunityId) : items[0]
            if (request.opportunityId && !opportunity) throw new Error('The selected opportunity is not in the selected account portfolio.')
            return portfolioWorkspaceSchema.parse({ contractVersion: portfolioReadVersion, accounts: index.accounts, opportunities: items,
                milestones: opportunity ? await this.listMilestones(opportunity.id) : [],
                ...(account ? { selectedAccountId: account.id } : {}), ...(opportunity ? { selectedOpportunityId: opportunity.id } : {}) })
        },
        searchAccounts: async (request) => {
            const query = request.query.trim().toLocaleLowerCase()
            const currentById = new Map(sampleAccountRows(true).map((account) => [account.id, account]))
            return structuredClone(accounts
                .filter((account) => request.matchBy === 'name'
                    ? account.name.toLocaleLowerCase().includes(query)
                    : account.tpid === request.query.trim())
                .map((account) => {
                    const current = currentById.get(account.id)
                    return {
                        ...(current ?? account),
                        state: current?.visibility === 'hidden' ? 'hidden' as const : current ? 'visible' as const : 'not-added' as const
                    }
                }))
        },
        addAccount: async (accountId) => {
            const account = accounts.find((item) => item.id === accountId)
            if (!account) throw new Error('Unknown sample account.')
            manualAccountIds.add(accountId)
            return structuredClone(sampleAccountRows(true).find((item) => item.id === accountId)!)
        },
        setAccountVisibility: async (accountId, visibility) => {
            const account = accounts.find((item) => item.id === accountId)
            if (!account) throw new Error('Unknown sample account.')
            if (visibility === 'hidden') hiddenAccountIds.add(accountId)
            else hiddenAccountIds.delete(accountId)
            const current = sampleAccountRows(true).find((item) => item.id === accountId)
            return structuredClone(current ?? { ...account, visibility })
        },
        listOpportunities: async (accountId) => structuredClone(opportunities.filter((item) =>
            item.accountId === accountId && dealTeamOpportunityIds.has(item.id) && !hiddenAccountIds.has(accountId))),
        getRecordCreationCatalog: async () => unavailable(),
        previewRecordCreation: async () => unavailable(),
        commitRecordCreation: async () => unavailable(),
        exportRecordCreationDraft: async () => unavailable(),
        discoverOpportunities: async (domain) => {
            const visibleAccountIds = new Set(sampleAccountRows().map((account) => account.id))
            return structuredClone(discoverableOpportunities
                .filter((item) => item.domain === domain && visibleAccountIds.has(item.accountId))
                .map((item) => ({ ...item, onDealTeam: dealTeamOpportunityIds.has(item.id) })))
        },
        joinDealTeam: async (opportunityId) => {
            const seed = discoverableOpportunities.find((item) => item.id === opportunityId)
            if (!seed) throw new Error('Unknown sample opportunity.')
            const alreadyMember = dealTeamOpportunityIds.has(opportunityId)
            if (!alreadyMember) {
                dealTeamOpportunityIds.add(opportunityId)
                if (!opportunities.some((item) => item.id === opportunityId)) {
                    const { domain, accountName, solutionArea, technicalCapability, onDealTeam, ...opportunity } = seed
                    void domain; void accountName; void solutionArea; void technicalCapability; void onDealTeam
                    opportunities.push(structuredClone(opportunity))
                }
            }
            return { opportunityId, onDealTeam: true, alreadyMember }
        },
        leaveDealTeam: async (opportunityId) => {
            const alreadyAbsent = !dealTeamOpportunityIds.has(opportunityId)
            dealTeamOpportunityIds.delete(opportunityId)
            return { opportunityId, onDealTeam: false, alreadyAbsent }
        },
        joinMilestoneTeam: async (opportunityId, milestoneId) => {
            const existing = milestones.find((item) => item.opportunityId === opportunityId && item.id === milestoneId)
            if (!existing) {
                // Joining a milestone for a discovery candidate promotes its opportunity into the portfolio.
                const discoverable = discoverableOpportunities.find((item) => item.id === opportunityId)
                const seeded = discoverableMilestones.find((item) => item.opportunityId === opportunityId && item.id === milestoneId)
                if (!discoverable || !seeded) throw new Error('Unknown sample milestone.')
                if (!opportunities.some((item) => item.id === opportunityId)) {
                    const { domain, accountName, solutionArea, technicalCapability, onDealTeam, ...opportunity } = discoverable
                    void domain; void accountName; void solutionArea; void technicalCapability; void onDealTeam
                    opportunities.push(structuredClone(opportunity))
                }
                if (!milestones.some((item) => item.id === milestoneId)) milestones.push(structuredClone(seeded))
            }
            const alreadyMember = milestoneTeamIds.has(milestoneId)
            milestoneTeamIds.add(milestoneId)
            return { opportunityId, milestoneId, onMilestoneTeam: true, alreadyMember }
        },
        leaveMilestoneTeam: async (opportunityId, milestoneId) => {
            const milestone = milestones.find((item) => item.opportunityId === opportunityId && item.id === milestoneId)
                ?? discoverableMilestones.find((item) => item.opportunityId === opportunityId && item.id === milestoneId)
            if (!milestone) throw new Error('Unknown sample milestone.')
            const alreadyAbsent = !milestoneTeamIds.has(milestoneId)
            milestoneTeamIds.delete(milestoneId)
            return { opportunityId, milestoneId, onMilestoneTeam: false, alreadyAbsent }
        },
        listMilestones: async (opportunityId) => structuredClone(milestones.filter((item) => item.opportunityId === opportunityId))
            .map((item) => ({ ...item, onMilestoneTeam: milestoneTeamIds.has(item.id) })),
        listDiscoverableMilestones: async (opportunityId) => {
            const promoted = milestones.filter((item) => item.opportunityId === opportunityId)
            const source = promoted.length > 0 ? promoted : discoverableMilestones.filter((item) => item.opportunityId === opportunityId)
            return structuredClone(source).map((item) => ({ ...item, onMilestoneTeam: milestoneTeamIds.has(item.id) }))
        },
        listMilestoneActivities: async (_opportunityId, milestoneId) => structuredClone(milestoneActivities.filter((item) => item.milestoneId === milestoneId)),
        createMilestoneActivity: async (opportunityId, milestoneId, request) => {
            const parsed = createMilestoneActivityRequestSchema.parse(request)
            const activity: MilestoneActivity = {
                id: `act-web-${++webSampleActivitySequence}`,
                milestoneId,
                opportunityId,
                subject: parsed.subject,
                activityType: 'task',
                status: 'Open',
                priority: parsed.priority,
                owner: 'Account team',
                createdBy: 'Account team',
                createdOn: new Date().toISOString(),
                ...(parsed.taskCategory ? { taskCategory: parsed.taskCategory } : {}),
                ...(parsed.due ? { due: parsed.due } : {}),
                ...(parsed.durationMinutes !== undefined ? { durationMinutes: parsed.durationMinutes } : {}),
                ...(parsed.description ? { description: parsed.description } : {})
            }
            milestoneActivities.unshift(activity)
            return structuredClone(activity)
        },
        listMeetingTranscripts: async () => { throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.') },
        getMeetingTranscript: async () => { throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.') },
        proposeMeetingFromTranscript: async () => { throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.') },
        proposeMeetingFromRaw: async () => { throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.') },
        applyMeetingChangeSet: async () => { throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.') },
        updateMilestone: async (opportunityId, milestoneId, update) => {
            const milestone = milestones.find((item) => item.opportunityId === opportunityId && item.id === milestoneId)
            if (!milestone) throw new Error('Unknown sample milestone.')
            Object.assign(milestone, update, update.customerCommitment !== undefined ? { commitment: update.customerCommitment } : {})
            delete (milestone as Milestone & { customerCommitment?: string }).customerCommitment
            return structuredClone(milestone)
        },
        updateOpportunity: async (opportunityId, update) => {
            const opportunity = opportunities.find((item) => item.id === opportunityId)
            if (!opportunity) throw new Error('Unknown sample opportunity.')
            opportunity.comments = update.comments
            return structuredClone(opportunity)
        },
        transitionOpportunityStage: async (accountId, opportunityId, targetStage, reason) => {
            const opportunity = opportunities.find((item) => item.id === opportunityId && item.accountId === accountId)
            if (!opportunity) throw new Error('Unknown sample opportunity.')
            if (Math.abs(targetStage - opportunity.recordedStage) !== 1) throw new Error('MCEM stage changes must move to an adjacent stage.')
            const previousStage = opportunity.recordedStage
            const evaluation = buildPreviewEvaluation(opportunity, milestones.filter((item) => item.opportunityId === opportunity.id), roleByStage)
            const advancing = targetStage > previousStage
            const hasGaps = evaluation.criteria.some((criterion) => criterion.status !== 'met')
            if ((!advancing || hasGaps) && !reason?.trim()) throw new Error(advancing ? 'An exception reason is required.' : 'A recycle reason is required.')
            const disposition = advancing ? hasGaps ? 'override' : 'advanced' : 'recycled'
            const auditNote = `[MCEM sample transition] Stage ${previousStage} -> Stage ${targetStage}; disposition: ${disposition}.${reason ? ` Reason: ${reason.trim()}` : ''}`
            opportunity.recordedStage = targetStage
            opportunity.comments = [opportunity.comments, auditNote].filter(Boolean).join('\n\n')
            return mcemStageTransitionResultSchema.parse({ opportunity: structuredClone(opportunity), previousStage, targetStage, disposition, auditNote })
        },
        runMcemCoach: async (_accountId, opportunityId) => {
            const opportunity = opportunities.find((item) => item.id === opportunityId)
            if (!opportunity) throw new Error('Unknown sample opportunity.')
            return buildPreviewEvaluation(opportunity, milestones.filter((item) => item.opportunityId === opportunityId), roleByStage)
        },
        runAgentTask: async (capability, _accountId, opportunityId, prompt) => {
            const opportunity = opportunities.find((item) => item.id === opportunityId)
            if (!opportunity) throw new Error('Unknown sample opportunity.')
            const generatedAt = new Date().toISOString()
            return {
                contractVersion,
                correlationId: '20000000-0000-4000-8000-000000000002',
                capability,
                agentVersion: 'web-sample-v1',
                generatedAt,
                mode: 'sample',
                state: 'complete',
                content: `## ${capability.replaceAll('-', ' ')}\n\n**${opportunity.name}** is shown using sanitized web-preview evidence.\n\n> Requested: ${prompt}\n\nOwner-based plan to close gaps\n\n1. ATS — Customer outcomes\n\n- Gap: Missing\n- Evidence: Confirm the accountable role and target date.\n\nRecommended sequence\n\n- Validate the next customer commitment.\n- Record the outcome in MSX after human review.\n\nAssumptions / cautions\n\n- Do not treat internal evidence as customer approval.`,
                sourceHealth: [{ source: 'msx', state: 'sample', detail: 'Sanitized static sample.', checkedAt: generatedAt }]
            }
        },
        openEmailCompose: createWebApiClient().openEmailCompose,
        exportAgentResponse: createWebApiClient().exportAgentResponse,
        openEvidence: createWebApiClient().openEvidence,
        listWorkflowDefinitions: createWebApiClient().listWorkflowDefinitions,
        startWorkflow: createWebApiClient().startWorkflow,
        getWorkflowRun: createWebApiClient().getWorkflowRun,
        cancelWorkflowRun: createWebApiClient().cancelWorkflowRun,
        listWorkflowRuns: createWebApiClient().listWorkflowRuns,
        prepareWorkflowGuidance: createWebApiClient().prepareWorkflowGuidance,
        invokeVoice: createWebApiClient().invokeVoice
    }
}

function desktopClient(bridge: DesktopBridge): RevampDataClient {
    return {
        ...(bridge.invokeMutationSync ? { invokeMutationSync: (request) => bridge.invokeMutationSync!(request) } : {}),
        ...(bridge.onCacheChanged ? { onSourceCacheChanged: (listener) => bridge.onCacheChanged!(listener) } : {}),
        ...(bridge.cacheControl ? {
            setActiveReads: async (keys: readonly string[], active: boolean, consumer?: string) => { await bridge.cacheControl!({ contractVersion: '1.0', operation: 'interest', keys: [...keys], active, ...(consumer ? { consumer } : {}) }) },
            refreshSources: (opportunityId?: string) => {
                void bridge.cacheControl!({ contractVersion: '1.0', operation: 'refresh', ...(opportunityId ? { opportunityId } : {}) })
                    .catch(() => console.error('[cache-sync] host-refresh-control-failed'))
            }
        } : {}),
        mode: 'desktop',
        getDataMode: async () => (await bridge.getDataStatus()).mode,
        searchKnowledge: async (request) => knowledgeSearchResponseSchema.parse(
            await bridge.searchKnowledge(knowledgeSearchRequestSchema.parse(request))),
        deriveWorkingSessionTopic: async (request) => workingSessionTopicResponseSchema.parse(
            await bridge.deriveWorkingSessionTopic(workingSessionTopicRequestSchema.parse(request))),
        prepareWorkingSession: async (request) => workingSessionResultSchema.parse(
            await bridge.prepareWorkingSession(workingSessionPrepareRequestSchema.parse(request))),
        openWorkingSessionFolder: (folderPath) => bridge.openWorkingSessionFolder(folderPath),
        invokeStagePipelineReview: async (request) => stagePipelineResponseSchema.parse(
            await bridge.invokeStagePipelineReview(stagePipelineRequestSchema.parse(request))
        ),
        invokeSellerDashboard: async (request) => sellerDashboardResponseSchema.parse(
            await bridge.invokeSellerDashboard(sellerDashboardRequestSchema.parse(request))
        ),
        invokeSeReporting: async (request) => seReportingResponseSchema.parse(
            await bridge.invokeSeReporting(seReportingRequestSchema.parse(request))
        ),
        invokeVoice: async (request) => voiceResponseSchema.parse(await bridge.invokeVoice(voiceRequestSchema.parse(request))),
        exitApplication: () => bridge.exitApplication(),
        getCurrentUserEmail: async () => (await bridge.getDataStatus()).auth.userEmail,
        getDiscoverySnapshot: async (request = { contractVersion: discoverySnapshotVersion }) =>
            discoverySnapshotSchema.parse(await bridge.getDiscoverySnapshot(discoverySnapshotRequestSchema.parse(request))),
        listAccounts: (options) => bridge.listAccounts(options),
        getPortfolioIndex: async (request = { contractVersion: portfolioReadVersion }) => portfolioIndexSchema.parse(await bridge.getPortfolioIndex(portfolioReadRequestSchema.parse(request))),
        getPortfolioWorkspace: async (request) => portfolioWorkspaceSchema.parse(await bridge.getPortfolioWorkspace(portfolioWorkspaceRequestSchema.parse(request))),
        searchAccounts: (request) => bridge.searchAccounts(request),
        addAccount: (accountId) => bridge.addAccount(accountId),
        setAccountVisibility: (accountId, visibility) => bridge.setAccountVisibility(accountId, visibility),
        listOpportunities: (accountId) => bridge.listOpportunities(accountId),
        getRecordCreationCatalog: async (accountId) => recordCreationCatalogSchema.parse(await bridge.getRecordCreationCatalog(
            recordCreationCatalogRequestSchema.parse({ contractVersion, accountId })
        )),
        previewRecordCreation: async (target, draft) => recordCreationPreviewSchema.parse(await bridge.previewRecordCreation(
            recordCreationPreviewRequestSchema.parse({ contractVersion, target, draft })
        )),
        commitRecordCreation: async (preview) => recordCreationResultSchema.parse(await bridge.commitRecordCreation(
            recordCreationCommitRequestSchema.parse({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true })
        )),
        exportRecordCreationDraft: async (preview) => recordCreationDraftResultSchema.parse(await bridge.exportRecordCreationDraft(
            recordCreationCommitRequestSchema.parse({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true })
        )),
        discoverOpportunities: (domain) => bridge.discoverOpportunities(domain),
        joinDealTeam: (opportunityId) => bridge.joinDealTeam(opportunityId),
        leaveDealTeam: (opportunityId) => bridge.leaveDealTeam(opportunityId),
        joinMilestoneTeam: (opportunityId, milestoneId) => bridge.joinMilestoneTeam(opportunityId, milestoneId),
        leaveMilestoneTeam: (opportunityId, milestoneId) => bridge.leaveMilestoneTeam(opportunityId, milestoneId),
        listMilestones: (opportunityId) => bridge.listMilestones(opportunityId),
        listDiscoverableMilestones: (opportunityId) => bridge.listDiscoverableMilestones(opportunityId),
        listMilestoneActivities: (opportunityId, milestoneId) => bridge.listMilestoneActivities(opportunityId, milestoneId),
        createMilestoneActivity: (opportunityId, milestoneId, request) => bridge.createMilestoneActivity(opportunityId, milestoneId, request),
        listMeetingTranscripts: (opportunityId) => bridge.listMeetingTranscripts(opportunityId),
        getMeetingTranscript: (transcriptId) => bridge.getMeetingTranscript(transcriptId),
        proposeMeetingFromTranscript: (opportunityId, transcriptId) => bridge.proposeMeetingChangeSet({ opportunityId, transcriptId }),
        proposeMeetingFromRaw: (opportunityId, content, meetingType, format) => bridge.proposeMeetingChangeSet({ opportunityId, rawTranscript: { content, meetingType, ...(format ? { format } : {}) } }),
        applyMeetingChangeSet: (proposal, approval) => bridge.applyMeetingChangeSet(proposal, approval),
        updateMilestone: (opportunityId, milestoneId, update) => bridge.updateMilestone(opportunityId, milestoneId, update),
        updateOpportunity: (opportunityId, update) => bridge.updateOpportunity(opportunityId, update),
        transitionOpportunityStage: (accountId, opportunityId, targetStage, reason) => bridge.transitionOpportunityStage({ contractVersion, accountId, opportunityId, targetStage, ...(reason === undefined ? {} : { reason }) }),
        runMcemCoach: (accountId, opportunityId) => bridge.runMcemCoach({ contractVersion, accountId, opportunityId, prompt: 'How do we move this opportunity to the next MCEM stage?' }),
        runAgentTask: (capability, accountId, opportunityId, prompt) => bridge.runAgentTask({ contractVersion, capability, accountId, opportunityId, prompt }),
        ...(bridge.runAgentTaskStream ? {
            runAgentTaskStream: (capability: AgentCapability, accountId: string, opportunityId: string, prompt: string, onProgress?: (progress: AgentStreamProgress) => void, signal?: AbortSignal) =>
                new Promise<AgentTaskResponse>((resolve, reject) => {
                    const accumulator = createAgentStreamAccumulator(onProgress)
                    let settled = false
                    const finish = (action: () => void) => { if (!settled) { settled = true; action() } }
                    const handle = bridge.runAgentTaskStream!({ contractVersion, capability, accountId, opportunityId, prompt }, (raw) => {
                        try {
                            const event = agentTaskStreamEventSchema.parse(raw)
                            accumulator.push(event)
                            if (event.type === 'complete') finish(() => resolve(accumulator.result()))
                        } catch (error) { finish(() => reject(error)) }
                    })
                    handle.done.then(() => finish(() => { try { resolve(accumulator.result()) } catch (error) { reject(error) } }), (error: unknown) => finish(() => reject(error)))
                    signal?.addEventListener('abort', () => handle.cancel(), { once: true })
                })
        } : {}),
        openEmailCompose: (request) => bridge.openEmailCompose(request),
        exportAgentResponse: (request) => bridge.exportAgentResponse(request),
        openEvidence: (url) => bridge.openEvidence(url),
        listWorkflowDefinitions: async (scope) => workflowDefinitionSchema.array().parse(await bridge.invokeWorkflow('list', { contractVersion: workflowContractVersion, ...(scope ? { scope } : {}) })),
        startWorkflow: async (request) => workflowRunSchema.parse(await bridge.invokeWorkflow('start', request)),
        getWorkflowRun: async (runId) => workflowRunViewSchema.parse(await bridge.invokeWorkflow('get', { contractVersion: workflowContractVersion, runId })),
        cancelWorkflowRun: async (runId) => workflowRunSchema.parse(await bridge.invokeWorkflow('cancel', { contractVersion: workflowContractVersion, runId })),
        listWorkflowRuns: async (scope, limit) => workflowRunSchema.array().parse(await bridge.invokeWorkflow('history', {
            contractVersion: workflowContractVersion,
            ...(scope ? { scope } : {}),
            ...(limit === undefined ? {} : { limit })
        })),
        prepareWorkflowGuidance: async (runId, queueItemId, capability) => workflowGuidanceHandoffSchema.parse(await bridge.invokeWorkflow('guidance', {
            contractVersion: workflowContractVersion, runId, queueItemId, capability
        }))
    }
}

export function withSessionPortfolio(source: RevampDataClient): RevampDataClient {
    const session = new SessionPortfolio({
        getPortfolioIndex: () => source.getPortfolioIndex({ contractVersion: portfolioReadVersion, includeHidden: true }),
        getDiscoverySnapshot: () => source.getDiscoverySnapshot(),
        listMilestones: (id) => source.listMilestones(id),
        listDiscoverableMilestones: (id) => source.listDiscoverableMilestones(id)
    })
    const sync = new MutationSyncClient(source.invokeMutationSync, {
        onConfirmed: (operation, result, input) => { session.applyMutation(operation, result); session.finishDraft(operation, input) },
        onRecovered: () => session.refresh(),
        onAccessDenied: () => session.clear(),
        validateReview: (review) => session.validateMutationReview(review),
        captureReview: (operation, input) => session.captureReview(operation, input)
    })
    let hostGeneration: number | undefined
    let hostDataRevision: number | undefined
    source.onSourceCacheChanged?.((state) => {
        const nextDataRevision = state.dataRevision ?? state.revision
        session.cache.batch(() => {
            if (hostGeneration !== undefined && hostGeneration !== state.generation) session.clear()
            else if (hostDataRevision !== undefined && hostDataRevision !== nextDataRevision) session.cache.invalidateAll()
            if (state.error) session.cache.reportError(new Error(state.error))
            else session.cache.recovered()
            if (source.setActiveReads) session.cache.observeSourceState(state)
        })
        hostGeneration = state.generation
        hostDataRevision = nextDataRevision
    })
    const mutate = <T>(operation: syncContracts.SyncMutationOperation, input: Record<string, unknown>, action: () => Promise<T>, parse: (value: unknown) => T) =>
        sync.run(operation, input, action, parse)
    const interests = new Map<string, { keys: readonly string[]; active: boolean }>()
    return {
        ...source,
        cacheSession: session,
        mutationSession: sync,
        setActiveReads: (keys, active, consumer = 'main') => {
            if (!active && !keys.length) interests.delete(consumer)
            else interests.set(consumer, { keys, active })
            const visible = [...interests.values()].filter((item) => item.active)
            session.setActiveKeys([...new Set(visible.flatMap((item) => item.keys))])
            if (source.setActiveReads) { session.setActive(false); return source.setActiveReads(keys, active, consumer) }
            else session.setActive(visible.length > 0)
        },
        refreshSources: (opportunityId) => { source.refreshSources?.(opportunityId); session.refresh(opportunityId) },
        getDiscoverySnapshot: async () => {
            const value = await session.getDiscoverySnapshot()
            return { ...value, opportunities: value.opportunities.map((item) => sync.projectDiscovery(item)),
                portfolioOpportunities: value.portfolioOpportunities.map((item) => sync.projectOpportunity(item)) }
        },
        getPortfolioIndex: async (input = { contractVersion: portfolioReadVersion }) => {
            const value = await session.getPortfolioIndex(portfolioReadRequestSchema.parse(input).includeHidden)
            return { ...value, opportunities: value.opportunities.map((item) => sync.projectOpportunity(item)) }
        },
        getPortfolioWorkspace: async (input) => {
            const value = await session.getPortfolioWorkspace(input)
            return { ...value, opportunities: value.opportunities.map((item) => sync.projectOpportunity(item)),
                milestones: value.milestones.map((item) => sync.projectMilestone(item)) }
        },
        listAccounts: (options) => session.listAccounts(options?.includeHidden),
        listOpportunities: async (accountId) => (await session.listOpportunities(accountId)).map((item) => sync.projectOpportunity(item)),
        discoverOpportunities: async (domain) => (await session.discoverOpportunities(domain)).map((item) => sync.projectDiscovery(item)),
        listMilestones: async (id) => (await session.listMilestones(id)).map((item) => sync.projectMilestone(item)),
        listDiscoverableMilestones: async (id) => (await session.listMilestones(id, true)).map((item) => sync.projectMilestone(item)),
        listMilestoneActivities: (id, milestoneId) => session.readDataset(`activities:${id}:${milestoneId}`, () => source.listMilestoneActivities(id, milestoneId)),
        getRecordCreationCatalog: (id) => session.readDataset(`catalog:${id}`, () => source.getRecordCreationCatalog(id), { reference: true }),
        searchAccounts: (request) => session.readDataset(`search:${request.matchBy}:${request.query}`, () => source.searchAccounts(request)),
        addAccount: (id) => mutate('addAccount', { accountId: id }, () => source.addAccount(id), syncContracts.accountSchema.parse),
        setAccountVisibility: (id, visibility) => mutate('setAccountVisibility', { accountId: id, visibility }, () => source.setAccountVisibility(id, visibility), syncContracts.accountSchema.parse),
        joinDealTeam: (id) => mutate('joinDealTeam', { opportunityId: id }, () => source.joinDealTeam(id), syncContracts.dealTeamJoinResultSchema.parse),
        leaveDealTeam: (id) => mutate('leaveDealTeam', { opportunityId: id }, () => source.leaveDealTeam(id), syncContracts.dealTeamLeaveResultSchema.parse),
        joinMilestoneTeam: (id, milestoneId) => mutate('joinMilestoneTeam', { opportunityId: id, milestoneId }, () => source.joinMilestoneTeam(id, milestoneId), syncContracts.milestoneTeamJoinResultSchema.parse),
        leaveMilestoneTeam: (id, milestoneId) => mutate('leaveMilestoneTeam', { opportunityId: id, milestoneId }, () => source.leaveMilestoneTeam(id, milestoneId), syncContracts.milestoneTeamLeaveResultSchema.parse),
        updateOpportunity: (id, update) => mutate('updateOpportunity', { opportunityId: id, update }, () => source.updateOpportunity(id, update), syncContracts.opportunitySchema.parse),
        updateMilestone: (id, milestoneId, update) => mutate('updateMilestone', { opportunityId: id, milestoneId, update }, () => source.updateMilestone(id, milestoneId, update), syncContracts.milestoneSchema.parse),
        createMilestoneActivity: async (id, milestoneId, request) => {
            const result = await mutate('createMilestoneActivity', { opportunityId: id, milestoneId, request }, () => source.createMilestoneActivity(id, milestoneId, request), syncContracts.milestoneActivitySchema.parse)
            session.invalidateDataset(`activities:${id}:${milestoneId}`)
            return result
        },
        transitionOpportunityStage: (accountId, id, stage, reason) => mutate('transitionOpportunityStage',
            { contractVersion, accountId, opportunityId: id, targetStage: stage, ...(reason ? { reason } : {}) },
            () => source.transitionOpportunityStage(accountId, id, stage, reason), syncContracts.mcemStageTransitionResultSchema.parse),
        commitRecordCreation: (preview) => mutate('commitRecordCreation', { contractVersion, preview, expectedDigest: preview.digest, confirmed: true }, () => source.commitRecordCreation(preview), syncContracts.recordCreationResultSchema.parse),
        applyMeetingChangeSet: (proposal, approval) => mutate('applyMeetingChangeSet', { proposal, approval }, () => source.applyMeetingChangeSet(proposal, approval), syncContracts.meetingChangeSetResultSchema.parse)
    }
}

function createTransportClient(shell: 'desktop' | 'web'): RevampDataClient {
    if (shell === 'desktop') {
        if (!window.tlc) throw new Error('The desktop data bridge is unavailable.')
        return desktopClient(window.tlc)
    }
    const hostedMode = document.querySelector<HTMLMetaElement>('meta[name="tlc-data-mode"]')?.content
    if (hostedMode === 'live') return createWebApiClient()
    if (hostedMode === 'sample') return createWebApiClient(fetch, 'web-sample')
    if (window.location.protocol === 'file:') return webClient()
    return webClient()
}

export function createDataClient(shell: 'desktop' | 'web'): RevampDataClient {
    return withSessionPortfolio(createTransportClient(shell))
}

export function stageOwner(stage: number): string {
    return roleByStage[stage - 1] ?? 'Account team'
}