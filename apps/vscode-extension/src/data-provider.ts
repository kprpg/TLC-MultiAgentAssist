import {
    workflowContractVersion,
    type Account,
    type AgentCapability,
    type AgentTaskResponse,
    type McemResponse,
    type McemStageTransitionResult,
    type Milestone,
    type MilestoneUpdate,
    type Opportunity,
    type OpportunityUpdate,
    type ScopeRef,
    type WorkflowDefinition,
    type WorkflowGuidanceHandoff,
    type WorkflowRun
} from '../../../packages/common/index.js'
import {
    createSampleWorkflowHost,
    type WorkflowHost,
    type WorkflowRunView
} from '../../../packages/orchestrator/workflows/index.js'
import {
    buildSampleAgentResponse,
    buildSampleEvaluation,
    findSampleOpportunity,
    listSampleAccounts,
    listSampleMilestones,
    listSampleOpportunities,
    transitionSampleStage,
    updateSampleMilestone,
    updateSampleOpportunity
} from './sample-data.js'

/**
 * Host-neutral data surface consumed by the pure bridge router. A provider owns the
 * decision of sample vs live; the router never learns which mode is active.
 */
export interface ExtensionDataProvider {
    readonly mode: 'sample' | 'live'
    getCurrentUserEmail(): Promise<string | undefined>
    listAccounts(): Promise<Account[]>
    listOpportunities(accountId: string): Promise<Opportunity[]>
    listMilestones(opportunityId: string): Promise<Milestone[]>
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
    dispose(): Promise<void>
}

function opportunityForOrThrow(opportunityId: string): Opportunity {
    const opportunity = findSampleOpportunity(opportunityId)
    if (!opportunity) throw new Error('Unknown sample opportunity.')
    return opportunity
}

/**
 * Sample provider. Reuses the shared sample workflow host so workflow behavior is
 * identical to the desktop and web sample hosts; layers sanitized account, opportunity,
 * milestone, and agent data on top.
 */
export function createSampleDataProvider(): ExtensionDataProvider {
    const host: WorkflowHost = createSampleWorkflowHost()
    return {
        mode: 'sample',
        getCurrentUserEmail: async () => undefined,
        listAccounts: async () => listSampleAccounts(),
        listOpportunities: async (accountId) => listSampleOpportunities(accountId),
        listMilestones: async (opportunityId) => listSampleMilestones(opportunityId),
        updateOpportunity: async (opportunityId, update) => updateSampleOpportunity(opportunityId, update),
        updateMilestone: async (opportunityId, milestoneId, update) => updateSampleMilestone(opportunityId, milestoneId, update),
        runMcemCoach: async (_accountId, opportunityId) => buildSampleEvaluation(opportunityForOrThrow(opportunityId)),
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
        dispose: async () => { /* sample host holds no external resources */ }
    }
}
