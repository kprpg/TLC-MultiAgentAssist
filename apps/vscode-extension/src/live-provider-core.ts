import {
    contractVersion,
    workflowContractVersion,
    type AgentCapability,
    type MeetingChangeSetApproval,
    type MeetingChangeSetProposal,
    type MeetingChangeSetResult,
    type MeetingTranscript,
    type MeetingTranscriptSummary,
    type ScopeRef
} from '../../../packages/common/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { workflowAgentCapabilityValues } from '../../../packages/common/contracts/workflows.js'
export { createDeterministicLiveTaskAgents as buildLiveTaskAgents } from '../../../packages/orchestrator/task-agents.js'
import type { WorkflowHost } from '../../../packages/orchestrator/workflows/index.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'
import type { MeetingExtractorFn } from '../../../packages/connectors/local-store/index.js'
import type { ExtensionDataProvider, MeetingTranscriptSource } from './data-provider.js'
import { createSellerDashboardHost } from '../../../packages/orchestrator/seller-dashboard.js'

export const AGENT_CAPABILITIES: readonly AgentCapability[] = workflowAgentCapabilityValues
const MCEM_COACH_PROMPT = 'Evaluate the current MCEM stage exit criteria and recommend the next best actions.'

/** Minimal meeting-capture surface a connector must provide (LocalStore implements it today). */
export interface MeetingCaptureConnector {
    listMeetingTranscripts(opportunityId?: string): Promise<MeetingTranscriptSummary[]>
    getMeetingTranscript(transcriptId: string): Promise<MeetingTranscript | undefined>
    proposeMeetingChangeSet(request: { opportunityId: string; transcriptId?: string; transcript?: MeetingTranscript }, extractor?: MeetingExtractorFn): Promise<MeetingChangeSetProposal>
    applyMeetingChangeSet(input: { proposal: MeetingChangeSetProposal; approval: MeetingChangeSetApproval }): Promise<MeetingChangeSetResult>
}

export interface LiveDataProviderParts {
    getSourceToken?(): Promise<string>
    orchestrator: ThinSliceOrchestrator
    host: WorkflowHost
    account: string
    dispose: () => Promise<void>
    /** Present for the SQLite sample store; absent for fixture and (for now) live. */
    meetingConnector?: MeetingCaptureConnector
    /** Optional Foundry model-backed extractor; falls back to the deterministic one when absent. */
    meetingExtractor?: MeetingExtractorFn
}

/** Assembles the provider surface from injected parts so MCEM/agent/Play wiring is unit-testable. */
export function buildLiveDataProvider(
    { orchestrator, host, account, dispose, meetingConnector, meetingExtractor, getSourceToken }: LiveDataProviderParts,
    mode: ExtensionDataProvider['mode'] = 'live'
): ExtensionDataProvider {
    const requireMeeting = (): MeetingCaptureConnector => {
        if (!meetingConnector) throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.')
        return meetingConnector
    }
    return {
        sourceCore: orchestrator,
        ...(getSourceToken ? { getSourceToken } : {}),
        mode,
        sellerDashboard: createSellerDashboardHost({ mode, resolveUserEmail: async () => account }),
        getCurrentUserEmail: async () => account,
        listAccounts: (options) => orchestrator.listAccounts(options),
        getPortfolioIndex: (request) => orchestrator.getPortfolioIndex(request),
        getPortfolioWorkspace: (request) => orchestrator.getPortfolioWorkspace(request),
        getDiscoverySnapshot: (request) => orchestrator.getDiscoverySnapshot(request),
        searchAccounts: (request) => orchestrator.searchAccounts(request),
        addAccount: (accountId) => orchestrator.addAccount(accountId),
        setAccountVisibility: (accountId, visibility) => orchestrator.setAccountVisibility(accountId, visibility),
        listOpportunities: (accountId) => orchestrator.listOpportunities(accountId),
        getRecordCreationCatalog: (request) => orchestrator.getRecordCreationCatalog(request),
        previewRecordCreation: (request) => orchestrator.previewRecordCreation(request),
        commitRecordCreation: (request) => orchestrator.commitRecordCreation(request),
        exportRecordCreationDraft: (request) => orchestrator.exportRecordCreationDraft(request),
        discoverOpportunities: (domain) => orchestrator.discoverOpportunities(domain),
        joinDealTeam: (opportunityId) => orchestrator.joinDealTeam(opportunityId),
        leaveDealTeam: (opportunityId) => orchestrator.leaveDealTeam(opportunityId),
        joinMilestoneTeam: (opportunityId, milestoneId) => orchestrator.joinMilestoneTeam(opportunityId, milestoneId),
        leaveMilestoneTeam: (opportunityId, milestoneId) => orchestrator.leaveMilestoneTeam(opportunityId, milestoneId),
        listMilestones: (opportunityId) => orchestrator.listMilestones(opportunityId),
        listDiscoverableMilestones: (opportunityId) => orchestrator.listDiscoverableMilestones(opportunityId),
        listMilestoneActivities: (opportunityId, milestoneId) => orchestrator.listMilestoneActivities(opportunityId, milestoneId),
        createMilestoneActivity: (opportunityId, milestoneId, request) => orchestrator.createMilestoneActivity(opportunityId, milestoneId, request),
        updateOpportunity: (opportunityId, update) => orchestrator.updateOpportunity(opportunityId, update),
        updateMilestone: (opportunityId, milestoneId, update) => orchestrator.updateMilestone(opportunityId, milestoneId, update),
        runMcemCoach: (accountId, opportunityId) => orchestrator.runMcemCoach({
            contractVersion,
            accountId,
            opportunityId,
            prompt: MCEM_COACH_PROMPT
        }),
        transitionOpportunityStage: (accountId, opportunityId, targetStage, reason) => orchestrator.transitionOpportunityStage({
            contractVersion,
            accountId,
            opportunityId,
            targetStage,
            ...(reason ? { reason } : {})
        }),
        runAgentTask: (capability, accountId, opportunityId, prompt) => orchestrator.runAgentTask({
            contractVersion,
            capability,
            accountId,
            opportunityId,
            prompt
        }),
        listWorkflowDefinitions: async (scope?: ScopeRef['kind']) => host.listDefinitions({ contractVersion: workflowContractVersion, ...(scope ? { scope } : {}) }),
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
        listMeetingTranscripts: async (opportunityId?: string) => requireMeeting().listMeetingTranscripts(opportunityId),
        getMeetingTranscript: async (transcriptId: string) => (await requireMeeting().getMeetingTranscript(transcriptId)) ?? null,
        proposeMeetingChangeSet: async (request: { opportunityId: string } & MeetingTranscriptSource) => {
            const connector = requireMeeting()
            const transcript = request.rawTranscript
                ? parseTranscriptContent(request.rawTranscript.content, {
                    opportunityId: request.opportunityId,
                    ...(request.rawTranscript.format ? { format: request.rawTranscript.format } : {}),
                    ...(request.rawTranscript.meetingType ? { meetingType: request.rawTranscript.meetingType } : {})
                })
                : undefined
            return connector.proposeMeetingChangeSet({
                opportunityId: request.opportunityId,
                ...(request.transcriptId ? { transcriptId: request.transcriptId } : {}),
                ...(transcript ? { transcript } : {})
            }, meetingExtractor)
        },
        applyMeetingChangeSet: async (input) => requireMeeting().applyMeetingChangeSet(input),
        dispose
    }
}
