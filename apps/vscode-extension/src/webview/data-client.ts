import { request, streamRequest } from './bridge.js'
import { AgentStreamError, createAgentStreamAccumulator, type AgentStreamProgress } from '../../../shared/agent-stream.js'
import { voiceRequestSchema, voiceResponseSchema, type VoiceRequest } from '../../../../packages/common/contracts/voice.js'
import { sellerDashboardRequestSchema, sellerDashboardResponseSchema, type SellerDashboardRequest } from '../../../../packages/common/contracts/seller-dashboard.js'
import { seReportingRequestSchema, seReportingResponseSchema, type SeReportingRequest } from '../../../../packages/common/contracts/se-reporting.js'
import { stagePipelineRequestSchema, stagePipelineResponseSchema, type StagePipelineRequest } from '../../../../packages/common/contracts/stage-pipeline-review.js'
import { momentumFocusRequestSchema, momentumFocusResponseSchema, type MomentumFocusRequest } from '../../../../packages/common/contracts/momentum-focus.js'
import { knowledgeSearchRequestSchema, knowledgeSearchResponseSchema, type KnowledgeSearchRequest } from '../../../../packages/common/contracts/knowledge.js'
import {
    workingSessionPrepareRequestSchema, workingSessionResultSchema, workingSessionTopicRequestSchema, workingSessionTopicResponseSchema,
    type WorkingSessionPrepareRequest, type WorkingSessionTopicRequest
} from '../../../../packages/common/contracts/working-session.js'
import {
    recordCreationCatalogSchema,
    recordCreationPreviewSchema,
    recordCreationPreviewRequestSchema,
    recordCreationCommitRequestSchema,
    recordCreationResultSchema,
    recordCreationDraftResultSchema,
    type RecordCreationDraft,
    type RecordCreationPreview,
    type RecordCreationPreviewRequest
} from '../../../../packages/common/contracts/record-creation.js'
import { contractVersion } from '../../../../packages/common/contracts/version.js'
import { discoverySnapshotSchema, discoverySnapshotVersion, portfolioIndexSchema } from '../../../../packages/common/contracts/index.js'
import * as syncContracts from '../../../../packages/common/contracts/index.js'
import { SessionPortfolio } from '../../../shared/session-portfolio.js'
import { MutationSyncClient } from '../../../shared/mutation-sync.js'
import { pollWorkflow } from '../../../shared/workflow-polling.js'
import type { WorkflowResultsMembershipView } from './view-types.js'
import type {
    AccountView,
    AccountCandidateView,
    AgentCapability,
    AgentTaskView,
    DealTeamJoinResultView,
    DealTeamLeaveResultView,
    DiscoverableOpportunityView,
    GuidanceHandoffView,
    McemTransitionView,
    McemView,
    MeetingChangeSetApprovalInput,
    MeetingChangeSetProposalView,
    MeetingChangeSetResultView,
    MeetingTranscriptSummaryView,
    MeetingTranscriptView,
    MeetingTypeView,
    MilestoneActivityView,
    CreateMilestoneActivityInput,
    MilestoneTeamJoinResultView,
    MilestoneTeamLeaveResultView,
    MilestoneUpdateInput,
    MilestoneView,
    OpportunityView,
    PortfolioIndexView,
    PortfolioWorkspaceView,
    SeDomainView,
    WorkflowDefinitionView,
    WorkflowRunResultView,
    WorkflowRunView
} from './view-types.js'

const transport = {
    searchKnowledge: async (input: KnowledgeSearchRequest) => knowledgeSearchResponseSchema.parse(
        await request('searchKnowledge', knowledgeSearchRequestSchema.parse(input))),
    deriveWorkingSessionTopic: async (input: WorkingSessionTopicRequest) => workingSessionTopicResponseSchema.parse(
        await request('workingSessionTopic', workingSessionTopicRequestSchema.parse(input))),
    prepareWorkingSession: async (input: WorkingSessionPrepareRequest) => workingSessionResultSchema.parse(
        await request('workingSessionPrepare', workingSessionPrepareRequestSchema.parse(input))),
    openWorkingSessionFolder: async (folderPath: string): Promise<void> => { await request('workingSessionOpenFolder', { folderPath }) },
    invokeSeReporting: async (input: SeReportingRequest) => seReportingResponseSchema.parse(
        await request('seReporting', seReportingRequestSchema.parse(input))
    ),
    invokeMutationSync: async (input: syncContracts.MutationSyncRequest) =>
        syncContracts.mutationSyncResponseSchema.parse(await request('mutationSync', input)),
    invokeSellerDashboard: async (input: SellerDashboardRequest) => sellerDashboardResponseSchema.parse(
        await request('sellerDashboard', sellerDashboardRequestSchema.parse(input))
    ),
    invokeStagePipelineReview: async (input: StagePipelineRequest) => stagePipelineResponseSchema.parse(
        await request('stagePipelineReview', stagePipelineRequestSchema.parse(input))
    ),
    invokeMomentumFocus: async (input: MomentumFocusRequest) => momentumFocusResponseSchema.parse(
        await request('momentumFocus', momentumFocusRequestSchema.parse(input))
    ),
    invokeVoice: async (input: VoiceRequest) => voiceResponseSchema.parse(await request('voiceInput', voiceRequestSchema.parse(input))),
    getCurrentUserEmail: () => request<string | null>('getCurrentUserEmail'),
    listAccounts: (includeHidden = false) => request<AccountView[]>('listAccounts', { includeHidden }),
    getPortfolioIndex: (includeHidden = false) => request<PortfolioIndexView>('getPortfolioIndex', { contractVersion: '1.0', includeHidden }),
    getPortfolioWorkspace: (input: { accountId?: string; opportunityId?: string; includeHidden?: boolean } = {}) =>
        request<PortfolioWorkspaceView>('getPortfolioWorkspace', { contractVersion: '1.0', ...input }),
    getDiscoverySnapshot: async () => discoverySnapshotSchema.parse(await request('getDiscoverySnapshot', { contractVersion: discoverySnapshotVersion })),
    searchAccounts: (query: string, matchBy: 'name' | 'tpid') => request<AccountCandidateView[]>('searchAccounts', { query, matchBy }),
    addAccount: (accountId: string) => request<AccountView>('addAccount', { accountId }),
    setAccountVisibility: (accountId: string, visibility: 'visible' | 'hidden') => request<AccountView>('setAccountVisibility', { accountId, visibility }),
    listOpportunities: (accountId: string) => request<OpportunityView[]>('listOpportunities', { accountId }),
    getRecordCreationCatalog: async (accountId: string) => recordCreationCatalogSchema.parse(
        await request('getRecordCreationCatalog', { contractVersion, accountId })
    ),
    previewRecordCreation: async (target: RecordCreationPreviewRequest['target'], draft: RecordCreationDraft) =>
        recordCreationPreviewSchema.parse(await request('previewRecordCreation',
            recordCreationPreviewRequestSchema.parse({ contractVersion, target, draft }))),
    commitRecordCreation: async (preview: RecordCreationPreview) =>
        recordCreationResultSchema.parse(await request('commitRecordCreation',
            recordCreationCommitRequestSchema.parse({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true }))),
    exportRecordCreationDraft: async (preview: RecordCreationPreview) =>
        recordCreationDraftResultSchema.parse(await request('exportRecordCreationDraft',
            recordCreationCommitRequestSchema.parse({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true }))),
    discoverOpportunities: (domain: SeDomainView) => request<DiscoverableOpportunityView[]>('discoverOpportunities', { domain }),
    joinDealTeam: (opportunityId: string) => request<DealTeamJoinResultView>('joinDealTeam', { opportunityId }),
    leaveDealTeam: (opportunityId: string) => request<DealTeamLeaveResultView>('leaveDealTeam', { opportunityId }),
    joinMilestoneTeam: (opportunityId: string, milestoneId: string) => request<MilestoneTeamJoinResultView>('joinMilestoneTeam', { opportunityId, milestoneId }),
    leaveMilestoneTeam: (opportunityId: string, milestoneId: string) => request<MilestoneTeamLeaveResultView>('leaveMilestoneTeam', { opportunityId, milestoneId }),
    listMilestones: (opportunityId: string) => request<MilestoneView[]>('listMilestones', { opportunityId }),
    listDiscoverableMilestones: (opportunityId: string) => request<MilestoneView[]>('listDiscoverableMilestones', { opportunityId }),
    listMilestoneActivities: (opportunityId: string, milestoneId: string) => request<MilestoneActivityView[]>('listMilestoneActivities', { opportunityId, milestoneId }),
    createMilestoneActivity: (opportunityId: string, milestoneId: string, activity: CreateMilestoneActivityInput) => request<MilestoneActivityView>('createMilestoneActivity', { opportunityId, milestoneId, request: activity }),
    updateOpportunity: (opportunityId: string, comments: string) => request<OpportunityView>('updateOpportunity', { opportunityId, update: { comments } }),
    updateMilestone: (opportunityId: string, milestoneId: string, update: MilestoneUpdateInput) => request<MilestoneView>('updateMilestone', { opportunityId, milestoneId, update }),
    runMcemCoach: (accountId: string, opportunityId: string) => request<McemView>('runMcemCoach', { accountId, opportunityId }),
    transitionOpportunityStage: (accountId: string, opportunityId: string, targetStage: number, reason?: string) =>
        request<McemTransitionView>('transitionOpportunityStage', { accountId, opportunityId, targetStage, ...(reason ? { reason } : {}) }),
    runAgentTask: (capability: AgentCapability, accountId: string, opportunityId: string, prompt: string) =>
        request<AgentTaskView>('runAgentTask', { capability, accountId, opportunityId, prompt }),
    /** Progressive run: reports the instant draft and streamed text via `onProgress`, resolves with the authoritative response. */
    runAgentTaskStream: (capability: AgentCapability, accountId: string, opportunityId: string, prompt: string,
        onProgress?: (progress: AgentStreamProgress) => void, signal?: AbortSignal) =>
        new Promise<syncContracts.AgentTaskResponse>((resolve, reject) => {
            if (signal?.aborted) {
                reject(new AgentStreamError('cancelled', 'The request was cancelled.'))
                return
            }
            const accumulator = createAgentStreamAccumulator(onProgress)
            const finish = () => {
                signal?.removeEventListener('abort', onAbort)
                handle.end()
            }
            const onAbort = () => {
                handle.cancel()
                finish()
                reject(new AgentStreamError('cancelled', 'The request was cancelled.'))
            }
            const handle = streamRequest('runAgentTaskStream', { capability, accountId, opportunityId, prompt }, (raw) => {
                try {
                    accumulator.push(syncContracts.agentTaskStreamEventSchema.parse(raw))
                    const event = raw as { type?: string }
                    if (event.type === 'complete') { finish(); resolve(accumulator.result()) }
                } catch (error) {
                    finish()
                    reject(error)
                }
            })
            signal?.addEventListener('abort', onAbort, { once: true })
        }),
    listWorkflowDefinitions: () => request<WorkflowDefinitionView[]>('listWorkflowDefinitions', { scope: 'portfolio' }),
    getWorkflowResultsView: (runId: string, filter: 'all' | 'mine') =>
        request<WorkflowResultsMembershipView>('getWorkflowResultsView', { runId, filter }),
    listWorkflowRuns: (limit = 10) => request<WorkflowRunView[]>('listWorkflowRuns', { limit }),
    openEvidence: async (url: string): Promise<void> => {
    await request<null>('openEvidence', { url })
    },
    exportContent: (title: string, content: string) => request<{ saved: boolean }>('exportContent', { title, content }),
    composeEmail: (subject: string, title: string, body: string) => request<{ drafted: boolean }>('composeEmail', { subject, title, body }),

    // Meeting capture: list/get a transcript, propose a reviewable change set, apply all-or-none.
    listMeetingTranscripts: (opportunityId?: string) =>
        request<MeetingTranscriptSummaryView[]>('listMeetingTranscripts', opportunityId ? { opportunityId } : {}),
    getMeetingTranscript: (transcriptId: string) =>
        request<MeetingTranscriptView | null>('getMeetingTranscript', { transcriptId }),
    proposeMeetingFromTranscript: (opportunityId: string, transcriptId: string) =>
        request<MeetingChangeSetProposalView>('proposeMeetingChangeSet', { opportunityId, transcriptId }),
    proposeMeetingFromRaw: (opportunityId: string, content: string, meetingType: MeetingTypeView, format?: 'vtt' | 'text') =>
        request<MeetingChangeSetProposalView>('proposeMeetingChangeSet', { opportunityId, rawTranscript: { content, meetingType, ...(format ? { format } : {}) } }),
    applyMeetingChangeSet: (proposal: MeetingChangeSetProposalView, approval: MeetingChangeSetApprovalInput) =>
        request<MeetingChangeSetResultView>('applyMeetingChangeSet', { proposal, approval }),

    // Preserve queue-item scope and evidence: prepare the handoff, then run the capability with it.
    async sendQueueItemToGuidance(runId: string, queueItemId: string, capability: AgentCapability): Promise<{ handoff: GuidanceHandoffView; response: AgentTaskView }> {
        const handoff = await request<GuidanceHandoffView>('prepareWorkflowGuidance', { runId, queueItemId, capability })
        const response = await request<AgentTaskView>('runAgentTask', {
            capability: handoff.capability,
            accountId: handoff.scope.accountId,
            opportunityId: handoff.scope.opportunityId,
            prompt: handoff.prompt
        })
        return { handoff, response }
    },

    async runWorkflowToCompletion(
        workflowId: string,
        asOf: string,
        timeoutMs: number,
        onUpdate?: (view: WorkflowRunResultView) => void
    ): Promise<WorkflowRunResultView> {
        const run = await request<WorkflowRunView>('startWorkflow', {
            workflowId,
            scope: { kind: 'portfolio' },
            input: { asOf }
        })
        return pollWorkflow(
            () => request<WorkflowRunResultView>('getWorkflowRun', { runId: run.runId }),
            timeoutMs,
            onUpdate
        )
    }
}

const session = new SessionPortfolio({
    getPortfolioIndex: async () => portfolioIndexSchema.parse(await transport.getPortfolioIndex(true)),
    getDiscoverySnapshot: () => transport.getDiscoverySnapshot(),
    listMilestones: (id) => transport.listMilestones(id),
    listDiscoverableMilestones: (id) => transport.listDiscoverableMilestones(id)
})

const hostOwned = document.getElementById('root')?.dataset.cacheOwner === 'host'
const sync = new MutationSyncClient(document.getElementById('root')?.dataset.backgroundSync === '1' ? transport.invokeMutationSync : undefined, {
    onConfirmed: (operation, result, input) => { session.applyMutation(operation, result); session.finishDraft(operation, input) },
    onRecovered: () => { session.refresh(); session.cache.changed() },
    onAccessDenied: () => session.clear(),
    validateReview: (review) => session.validateMutationReview(review),
    captureReview: (operation, input) => session.captureReview(operation, input)
})
const mutate = <T>(operation: syncContracts.SyncMutationOperation, input: Record<string, unknown>, action: () => Promise<T>, parse: (value: unknown) => T) =>
    sync.run(operation, input, action, parse)
let hostGeneration: number | undefined
let hostDataRevision: number | undefined
const interests = new Map<string, { keys: readonly string[]; active: boolean }>()
window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const value = event.data
    if (value === null || typeof value !== 'object' || !('kind' in value) || value.kind !== 'cache-state') return
    const parsed = syncContracts.cacheControlResponseSchema.safeParse({ contractVersion: 'contractVersion' in value ? value.contractVersion : undefined,
        state: 'state' in value ? value.state : undefined })
    if (!parsed.success) return
    const nextDataRevision = parsed.data.state.dataRevision ?? parsed.data.state.revision
    session.cache.batch(() => {
        if (hostGeneration !== undefined && hostGeneration !== parsed.data.state.generation) { session.clear(); sync.reset() }
        else if (hostDataRevision !== undefined && hostDataRevision !== nextDataRevision) session.cache.invalidateAll()
        if (parsed.data.state.error) session.cache.reportError(new Error(parsed.data.state.error))
        else session.cache.recovered()
        if (hostOwned) session.cache.observeSourceState(parsed.data.state)
    })
    hostGeneration = parsed.data.state.generation
    hostDataRevision = nextDataRevision
})

export const dataClient = {
    ...transport,
    cacheSession: session,
    mutationSession: sync,
    setActiveReads: async (keys: readonly string[], active: boolean, consumer = 'main') => {
        if (!active && !keys.length) interests.delete(consumer)
        else interests.set(consumer, { keys, active })
        const visible = [...interests.values()].filter((item) => item.active)
        session.setActiveKeys([...new Set(visible.flatMap((item) => item.keys))])
        if (hostOwned) { session.setActive(false); await request('cacheControl', { contractVersion: '1.0', operation: 'interest', keys: [...keys], active, consumer }) }
        else session.setActive(visible.length > 0)
    },
    refreshSources: () => {
        if (hostOwned) void request('cacheControl', { contractVersion: '1.0', operation: 'refresh' }).catch(() => console.error('[cache-sync] host-refresh-control-failed'))
        session.refresh()
    },
    resetSession: () => { session.clear(); sync.reset() },
    getDiscoverySnapshot: async () => {
        const value = await session.getDiscoverySnapshot()
        return { ...value, opportunities: value.opportunities.map((item) => sync.projectDiscovery(item)),
            portfolioOpportunities: value.portfolioOpportunities.map((item) => sync.projectOpportunity(item)) }
    },
    getPortfolioIndex: async (includeHidden = false) => {
        const value = await session.getPortfolioIndex(includeHidden)
        return { ...value, opportunities: value.opportunities.map((item) => sync.projectOpportunity(item)) }
    },
    getPortfolioWorkspace: (input: { accountId?: string; opportunityId?: string; includeHidden?: boolean } = {}) =>
        session.getPortfolioWorkspace({ contractVersion: '1.0', ...input }),
    listAccounts: (includeHidden = false) => session.listAccounts(includeHidden),
    listOpportunities: async (accountId: string) => (await session.listOpportunities(accountId)).map((item) => sync.projectOpportunity(item)),
    discoverOpportunities: (domain: SeDomainView) => session.discoverOpportunities(domain),
    listMilestones: async (id: string) => (await session.listMilestones(id)).map((item) => sync.projectMilestone(item)),
    listDiscoverableMilestones: async (id: string) => (await session.listMilestones(id, true)).map((item) => sync.projectMilestone(item)),
    listMilestoneActivities: (id: string, milestoneId: string) => session.readDataset(`activities:${id}:${milestoneId}`, () => transport.listMilestoneActivities(id, milestoneId)),
    getRecordCreationCatalog: (id: string) => session.readDataset(`catalog:${id}`, () => transport.getRecordCreationCatalog(id), { reference: true }),
    searchAccounts: (query: string, matchBy: 'name' | 'tpid') => session.readDataset(`search:${matchBy}:${query}`, () => transport.searchAccounts(query, matchBy)),
    addAccount: (id: string) => mutate('addAccount', { accountId: id }, () => transport.addAccount(id), syncContracts.accountSchema.parse),
    setAccountVisibility: (id: string, visibility: 'visible' | 'hidden') => mutate('setAccountVisibility', { accountId: id, visibility }, () => transport.setAccountVisibility(id, visibility), syncContracts.accountSchema.parse),
    joinDealTeam: (id: string) => mutate('joinDealTeam', { opportunityId: id }, () => transport.joinDealTeam(id), syncContracts.dealTeamJoinResultSchema.parse),
    leaveDealTeam: (id: string) => mutate('leaveDealTeam', { opportunityId: id }, () => transport.leaveDealTeam(id), syncContracts.dealTeamLeaveResultSchema.parse),
    joinMilestoneTeam: (id: string, milestoneId: string) => mutate('joinMilestoneTeam', { opportunityId: id, milestoneId }, () => transport.joinMilestoneTeam(id, milestoneId), syncContracts.milestoneTeamJoinResultSchema.parse),
    leaveMilestoneTeam: (id: string, milestoneId: string) => mutate('leaveMilestoneTeam', { opportunityId: id, milestoneId }, () => transport.leaveMilestoneTeam(id, milestoneId), syncContracts.milestoneTeamLeaveResultSchema.parse),
    updateOpportunity: (id: string, comments: string) => mutate('updateOpportunity', { opportunityId: id, update: { comments } }, () => transport.updateOpportunity(id, comments), syncContracts.opportunitySchema.parse),
    updateMilestone: (id: string, milestoneId: string, update: MilestoneUpdateInput) => mutate('updateMilestone', { opportunityId: id, milestoneId, update }, () => transport.updateMilestone(id, milestoneId, update), syncContracts.milestoneSchema.parse),
    createMilestoneActivity: async (id: string, milestoneId: string, activity: CreateMilestoneActivityInput) => {
        const result = await mutate('createMilestoneActivity', { opportunityId: id, milestoneId, request: activity },
            () => transport.createMilestoneActivity(id, milestoneId, activity), syncContracts.milestoneActivitySchema.parse)
        session.invalidateDataset(`activities:${id}:${milestoneId}`)
        return result
    },
    transitionOpportunityStage: (accountId: string, id: string, stage: number, reason?: string) =>
        mutate('transitionOpportunityStage', { contractVersion, accountId, opportunityId: id, targetStage: stage, ...(reason ? { reason } : {}) }, () => transport.transitionOpportunityStage(accountId, id, stage, reason), syncContracts.mcemStageTransitionResultSchema.parse),
    commitRecordCreation: (preview: RecordCreationPreview) => mutate('commitRecordCreation', { contractVersion, preview, expectedDigest: preview.digest, confirmed: true }, () => transport.commitRecordCreation(preview), syncContracts.recordCreationResultSchema.parse),
    applyMeetingChangeSet: (proposal: MeetingChangeSetProposalView, approval: MeetingChangeSetApprovalInput) =>
        mutate('applyMeetingChangeSet', { proposal, approval }, () => transport.applyMeetingChangeSet(proposal, approval), syncContracts.meetingChangeSetResultSchema.parse)
}
