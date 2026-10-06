import {
    workflowContractVersion,
    type Account,
    type AccountCandidate,
    type AccountListOptions,
    type AccountSearchRequest,
    type AccountVisibility,
    type AgentCapability,
    type AgentTaskResponse,
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
    type ScopeRef,
    type SeDomainId,
    type WorkflowDefinition,
    type WorkflowGuidanceHandoff,
    type WorkflowRun
} from '../../../packages/common/index.js'
import {
    createSampleWorkflowHost,
    type WorkflowHost,
    type WorkflowRunView
} from '../../../packages/orchestrator/workflows/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { ExtensionMcemGuidanceConnector } from './mcem-guidance.js'
import { buildLiveDataProvider, buildLiveTaskAgents } from './live-provider-core.js'
import { buildFoundryMeetingExtractor } from './live-provider.js'
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
    readonly mode: 'sample' | 'live'
    getCurrentUserEmail(): Promise<string | undefined>
    listAccounts(options?: AccountListOptions): Promise<Account[]>
    searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]>
    addAccount(accountId: string): Promise<Account>
    setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account>
    listOpportunities(accountId: string): Promise<Opportunity[]>
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
 * setting is `sqlite`. No network calls are made.
 */
export function createLocalStoreDataProvider(): ExtensionDataProvider {
    const connector = new LocalStoreMsxConnector(new LocalStore())
    const orchestrator = new ThinSliceOrchestrator(connector, new ExtensionMcemGuidanceConnector(), buildLiveTaskAgents())
    const host: WorkflowHost = createSampleWorkflowHost(async () => {
        const accounts = await connector.listAccounts()
        const opportunities = (await Promise.all(accounts.map((candidate) => connector.listOpportunities(candidate.id)))).flat()
        return {
            accountIds: accounts.map((candidate) => candidate.id),
            opportunityIds: opportunities.map((candidate) => candidate.id)
        }
    })
    const meetingExtractor = buildFoundryMeetingExtractor()
    return buildLiveDataProvider({ orchestrator, host, account: 'sample.user@example.com', meetingConnector: connector, ...(meetingExtractor ? { meetingExtractor } : {}), dispose: async () => { /* in-memory store */ } }, 'sample')
}

/**
 * Sample provider. Reuses the shared sample workflow host so workflow behavior is
 * identical to the desktop and web sample hosts; layers sanitized account, opportunity,
 * milestone, and agent data on top.
 */
export function createSampleDataProvider(): ExtensionDataProvider {
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
        getCurrentUserEmail: async () => undefined,
        listAccounts: async (options) => listSampleAccounts(options),
        searchAccounts: async (request) => searchSampleAccounts(request),
        addAccount: async (accountId) => addSampleAccount(accountId),
        setAccountVisibility: async (accountId, visibility) => setSampleAccountVisibility(accountId, visibility),
        listOpportunities: async (accountId) => listSampleOpportunities(accountId),
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
