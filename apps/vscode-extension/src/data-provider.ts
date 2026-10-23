import {
    workflowContractVersion,
    discoverySnapshotRequestSchema,
    discoverySnapshotSchema,
    discoverySnapshotVersion,
    seDomainIds,
    type DiscoverySnapshot,
    type DiscoverySnapshotRequest,
    type Account,
    type AccountCandidate,
    type AccountListOptions,
    type AccountSearchRequest,
    type AccountVisibility,
    type AgentCapability,
    type AgentTaskResponse,
    type AgentTaskStreamEvent,
    type DealTeamJoinResult,
    type DealTeamLeaveResult,
    type DiscoverableOpportunity,
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
    type RecordCreationCatalogRequest,
    type RecordCreationPreview,
    type RecordCreationPreviewRequest,
    type RecordCreationCommitRequest,
    type RecordCreationResult,
    type RecordCreationDraftResult,
    type ScopeRef,
    type SeDomainId,
    type WorkflowDefinition,
    type WorkflowGuidanceHandoff,
    type WorkflowRun
} from '../../../packages/common/index.js'
import type { TokenCredential } from '@azure/core-auth'
import { portfolioReadVersion, portfolioReadRequestSchema, portfolioIndexSchema, portfolioWorkspaceRequestSchema, portfolioWorkspaceSchema, type PortfolioReadRequest, type PortfolioIndex, type PortfolioWorkspaceRequest, type PortfolioWorkspace } from '../../../packages/common/contracts/index.js'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
    createSampleWorkflowHost,
    type WorkflowHost,
    type WorkflowRunView
} from '../../../packages/orchestrator/workflows/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { createSellerDashboardHost, type SellerDashboardHost } from '../../../packages/orchestrator/seller-dashboard.js'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { SampleRecordCreationCatalog } from '../../../packages/connectors/local-store/sample-record-creation-catalog.js'
import { RecordCreationService } from '../../../packages/orchestrator/record-creation/service.js'
import { ExtensionMcemGuidanceConnector } from './mcem-guidance.js'
import { buildLiveDataProvider, buildLiveTaskAgents } from './live-provider-core.js'
import { buildFoundryMeetingExtractor } from './live-provider.js'
import type { SessionPortfolio } from '../../shared/session-portfolio.js'
import type { MutationSyncRequest, MutationSyncResponse } from '../../../packages/common/contracts/cache-sync.js'
import {
    buildSampleAgentResponse,
    buildSampleEvaluation,
    addSampleAccount,
    discoverSampleOpportunities,
    findSampleOpportunity,
    joinSampleDealTeam,
    joinSampleMilestoneTeam,
    leaveSampleDealTeam,
    leaveSampleMilestoneTeam,
    listSampleAccounts,
    listSampleDiscoverableMilestones,
    listSampleMilestoneActivities,
    createSampleMilestoneActivity,
    listSampleMilestones,
    listSampleOpportunities,
    searchSampleAccounts,
    setSampleAccountVisibility,
    transitionSampleStage,
    updateSampleMilestone,
    updateSampleOpportunity
} from './sample-data.js'

/** A transcript source for a proposal: a seeded id or an uploaded/pasted recording. */
export interface MeetingTranscriptSource {
    transcriptId?: string
    rawTranscript?: { content: string; format?: 'vtt' | 'text'; meetingType?: MeetingType }
}

/**
 * Host-neutral data surface consumed by the pure bridge router. A provider owns the
 * decision of sample vs live; the router never learns which mode is active.
 */
export interface ExtensionDataProvider {
    readonly sourceCore?: ThinSliceOrchestrator
    readonly getSourceToken?: () => Promise<string>
    readonly cacheSession?: SessionPortfolio
    setCacheInterest?(consumer: string, keys: readonly string[], active: boolean): void
    setCacheSuspended?(consumer: string, suspended: boolean): void
    mutationSync?(request: MutationSyncRequest): Promise<MutationSyncResponse>
    drainMutations?(): Promise<void>
    readonly sellerDashboard?: SellerDashboardHost
    readonly mode: 'sample' | 'live'
    getCurrentUserEmail(): Promise<string | undefined>
    listAccounts(options?: AccountListOptions): Promise<Account[]>
    getPortfolioIndex(request: PortfolioReadRequest): Promise<PortfolioIndex>
    getPortfolioWorkspace(request: PortfolioWorkspaceRequest): Promise<PortfolioWorkspace>
    getDiscoverySnapshot(request: DiscoverySnapshotRequest): Promise<DiscoverySnapshot>
    searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]>
    addAccount(accountId: string): Promise<Account>
    setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account>
    listOpportunities(accountId: string): Promise<Opportunity[]>
    getRecordCreationCatalog(request: RecordCreationCatalogRequest): Promise<RecordCreationCatalog>
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
    updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity>
    updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone>
    runMcemCoach(accountId: string, opportunityId: string): Promise<McemResponse>
    transitionOpportunityStage(accountId: string, opportunityId: string, targetStage: number, reason?: string): Promise<McemStageTransitionResult>
    runAgentTask(capability: AgentCapability, accountId: string, opportunityId: string, prompt: string): Promise<AgentTaskResponse>
    /** Progressive variant; when absent the host falls back to `runAgentTask` and emits one `complete` event. */
    runAgentTaskStream?(capability: AgentCapability, accountId: string, opportunityId: string, prompt: string, onEvent: (event: AgentTaskStreamEvent) => void, signal?: AbortSignal): Promise<void>
    listWorkflowDefinitions(scope?: ScopeRef['kind']): Promise<WorkflowDefinition[]>
    startWorkflow(request: { workflowId: string; scope: ScopeRef; input?: unknown; correlationId?: string }): Promise<WorkflowRun>
    getWorkflowRun(runId: string): Promise<WorkflowRunView>
    cancelWorkflowRun(runId: string): Promise<WorkflowRun>
    listWorkflowRuns(scope?: ScopeRef, limit?: number): Promise<WorkflowRun[]>
    prepareWorkflowGuidance(runId: string, queueItemId: string, capability: AgentCapability): Promise<WorkflowGuidanceHandoff>
    listMeetingTranscripts(opportunityId?: string): Promise<MeetingTranscriptSummary[]>
    getMeetingTranscript(transcriptId: string): Promise<MeetingTranscript | null>
    proposeMeetingChangeSet(request: { opportunityId: string } & MeetingTranscriptSource): Promise<MeetingChangeSetProposal>
    applyMeetingChangeSet(input: { proposal: MeetingChangeSetProposal; approval: MeetingChangeSetApproval }): Promise<MeetingChangeSetResult>
    dispose(): Promise<void>
}

function opportunityForOrThrow(opportunityId: string): Opportunity {
    const opportunity = findSampleOpportunity(opportunityId)
    if (!opportunity) throw new Error('Unknown sample opportunity.')
    return opportunity
}

/**
 * Local SQLite test-store provider (sample/test data). Portfolio, discovery, writes, MCEM
 * evaluation, and agent guidance flow through the shared orchestrator over the relational
 * {@link LocalStoreMsxConnector}; selected when `TLC_DATA_STORE=sqlite` or the `tlc.dataStore`
 * setting is `sqlite`. Pass `storePath` for file-backed records that survive
 * extension-host restarts; the no-path form remains isolated for tests.
 */
export function createLocalStoreDataProvider(options: { foundryCredential?: TokenCredential | undefined; storePath?: string } = {}): ExtensionDataProvider {
    const { foundryCredential, storePath } = options
    if (storePath !== undefined && !storePath.trim()) throw new Error('The SQLite sample store path cannot be blank.')
    if (storePath) mkdirSync(dirname(storePath), { recursive: true })
    const store = new LocalStore(storePath ? { path: storePath } : {})
    const connector = new LocalStoreMsxConnector(store)
    const writer = connector.createRecordCreationWriter()
    const creation = new RecordCreationService(connector, writer, { writer })
    const orchestrator = new ThinSliceOrchestrator(connector, new ExtensionMcemGuidanceConnector(), buildLiveTaskAgents(), undefined, creation)
    const host: WorkflowHost = createSampleWorkflowHost(async () => {
        const { accounts, opportunities } = await connector.getPortfolioIndex()
        return {
            accountIds: accounts.map((candidate) => candidate.id),
            opportunityIds: opportunities.map((candidate) => candidate.id)
        }
    })
    const meetingExtractor = buildFoundryMeetingExtractor(process.env, foundryCredential)
    return buildLiveDataProvider({ orchestrator, host, account: 'sample.user@example.com', meetingConnector: connector, ...(meetingExtractor ? { meetingExtractor } : {}), dispose: async () => { store.close() } }, 'sample')
}

/**
 * Sample provider. Reuses the shared sample workflow host so workflow behavior is
 * identical to the desktop and web sample hosts; layers sanitized account, opportunity,
 * milestone, and agent data on top.
 */
export function createSampleDataProvider(): ExtensionDataProvider {
    const sampleMsx = {
        listAccounts: async (options?: AccountListOptions) => listSampleAccounts(options),
        listOpportunities: async (accountId: string) => listSampleOpportunities(accountId)
    }
    const creation = new RecordCreationService(sampleMsx, new SampleRecordCreationCatalog(sampleMsx))
    const host: WorkflowHost = createSampleWorkflowHost(async () => {
        const accounts = listSampleAccounts()
        const opportunities = (await Promise.all(accounts.map((candidate) => listSampleOpportunities(candidate.id)))).flat()
        return {
            accountIds: accounts.map((candidate) => candidate.id),
            opportunityIds: opportunities.map((candidate) => candidate.id)
        }
    })
    return {
        mode: 'sample',
        sellerDashboard: createSellerDashboardHost({ mode: 'sample', resolveUserEmail: async () => undefined }),
        getCurrentUserEmail: async () => undefined,
        getDiscoverySnapshot: async (input) => {
            discoverySnapshotRequestSchema.parse(input)
            const accounts = listSampleAccounts({ includeHidden: true })
            const portfolioOpportunities = accounts.filter((account) => account.visibility !== 'hidden').flatMap((account) => listSampleOpportunities(account.id))
            return discoverySnapshotSchema.parse({
                contractVersion: discoverySnapshotVersion, generatedAt: new Date().toISOString(), accounts, portfolioOpportunities,
                opportunities: seDomainIds.flatMap((domain) => discoverSampleOpportunities(domain)),
                milestoneTeamOpportunityIds: portfolioOpportunities.filter((opportunity) =>
                    listSampleMilestones(opportunity.id).some((milestone) => milestone.onMilestoneTeam)).map((opportunity) => opportunity.id)
            })
        },
        listAccounts: async (options) => listSampleAccounts(options),
        getPortfolioIndex: async (input) => {
            const request = portfolioReadRequestSchema.parse(input)
            const accounts = listSampleAccounts({ ...(request.includeHidden === undefined ? {} : { includeHidden: request.includeHidden }) })
            return portfolioIndexSchema.parse({ contractVersion: portfolioReadVersion, accounts,
                opportunities: accounts.filter((account) => account.visibility !== 'hidden').flatMap((account) => listSampleOpportunities(account.id)) })
        },
        getPortfolioWorkspace: async (input) => {
            const request = portfolioWorkspaceRequestSchema.parse(input)
            const accounts = listSampleAccounts({ ...(request.includeHidden === undefined ? {} : { includeHidden: request.includeHidden }) })
            const account = request.accountId ? accounts.find((item) => item.id === request.accountId && item.visibility !== 'hidden') : accounts.find((item) => item.visibility !== 'hidden')
            if (request.accountId && !account) throw new Error('The selected account is not in the current visible portfolio.')
            const opportunities = account ? listSampleOpportunities(account.id) : []
            const opportunity = request.opportunityId ? opportunities.find((item) => item.id === request.opportunityId) : opportunities[0]
            if (request.opportunityId && !opportunity) throw new Error('The selected opportunity is not in the selected account portfolio.')
            return portfolioWorkspaceSchema.parse({ contractVersion: portfolioReadVersion, accounts, opportunities,
                milestones: opportunity ? listSampleMilestones(opportunity.id) : [],
                ...(account ? { selectedAccountId: account.id } : {}), ...(opportunity ? { selectedOpportunityId: opportunity.id } : {}) })
        },
        searchAccounts: async (request) => searchSampleAccounts(request),
        addAccount: async (accountId) => addSampleAccount(accountId),
        setAccountVisibility: async (accountId, visibility) => setSampleAccountVisibility(accountId, visibility),
        listOpportunities: async (accountId) => listSampleOpportunities(accountId),
        getRecordCreationCatalog: (request) => creation.getCatalog(request),
        previewRecordCreation: (request) => creation.preview(request),
        commitRecordCreation: (request) => creation.commit(request),
        exportRecordCreationDraft: (request) => creation.exportDraft(request),
        discoverOpportunities: async (domain) => discoverSampleOpportunities(domain),
        joinDealTeam: async (opportunityId) => joinSampleDealTeam(opportunityId),
        leaveDealTeam: async (opportunityId) => leaveSampleDealTeam(opportunityId),
        joinMilestoneTeam: async (opportunityId, milestoneId) => joinSampleMilestoneTeam(opportunityId, milestoneId),
        leaveMilestoneTeam: async (opportunityId, milestoneId) => leaveSampleMilestoneTeam(opportunityId, milestoneId),
        listMilestones: async (opportunityId) => listSampleMilestones(opportunityId),
        listDiscoverableMilestones: async (opportunityId) => listSampleDiscoverableMilestones(opportunityId),
        listMilestoneActivities: async (opportunityId, milestoneId) => listSampleMilestoneActivities(opportunityId, milestoneId),
        createMilestoneActivity: async (opportunityId, milestoneId, request) => createSampleMilestoneActivity(opportunityId, milestoneId, request),
        updateOpportunity: async (opportunityId, update) => updateSampleOpportunity(opportunityId, update),
        updateMilestone: async (opportunityId, milestoneId, update) => updateSampleMilestone(opportunityId, milestoneId, update),
        runMcemCoach: async (_accountId, opportunityId) => buildSampleEvaluation(opportunityForOrThrow(opportunityId), undefined, listSampleMilestones(opportunityId)),
        transitionOpportunityStage: async (accountId, opportunityId, targetStage, reason) => transitionSampleStage(accountId, opportunityId, targetStage, reason),
        runAgentTask: async (capability, _accountId, opportunityId, prompt) => buildSampleAgentResponse(capability, opportunityForOrThrow(opportunityId), prompt),
        listWorkflowDefinitions: async (scope) => host.listDefinitions({ contractVersion: workflowContractVersion, ...(scope ? { scope } : {}) }),
        startWorkflow: async (request) => host.start({
            contractVersion: workflowContractVersion,
            workflowId: request.workflowId,
            scope: request.scope,
            ...(request.input === undefined ? {} : { input: request.input }),
            ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId })
        }),
        getWorkflowRun: async (runId) => host.get({ contractVersion: workflowContractVersion, runId }),
        cancelWorkflowRun: async (runId) => host.cancel({ contractVersion: workflowContractVersion, runId }),
        listWorkflowRuns: async (scope, limit) => host.listRuns({
            contractVersion: workflowContractVersion,
            ...(scope ? { scope } : {}),
            ...(limit === undefined ? {} : { limit })
        }),
        prepareWorkflowGuidance: async (runId, queueItemId, capability) => host.prepareGuidance({
            contractVersion: workflowContractVersion,
            runId,
            queueItemId,
            capability
        }),
        listMeetingTranscripts: async () => { throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.') },
        getMeetingTranscript: async () => { throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.') },
        proposeMeetingChangeSet: async () => { throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.') },
        applyMeetingChangeSet: async () => { throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.') },
        dispose: async () => { /* sample host holds no external resources */ }
    }
}
