import { request } from './bridge.js'
import type {
    AccountView,
    AgentCapability,
    AgentTaskView,
    GuidanceHandoffView,
    McemTransitionView,
    McemView,
    MilestoneUpdateInput,
    MilestoneView,
    OpportunityView,
    WorkflowDefinitionView,
    WorkflowRunResultView,
    WorkflowRunView
} from './view-types.js'

const POLL_INTERVAL_MS = 300
const POLL_TIMEOUT_MS = 15_000

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const dataClient = {
    getCurrentUserEmail: () => request<string | null>('getCurrentUserEmail'),
    listAccounts: () => request<AccountView[]>('listAccounts'),
    listOpportunities: (accountId: string) => request<OpportunityView[]>('listOpportunities', { accountId }),
    listMilestones: (opportunityId: string) => request<MilestoneView[]>('listMilestones', { opportunityId }),
    updateOpportunity: (opportunityId: string, comments: string) => request<OpportunityView>('updateOpportunity', { opportunityId, update: { comments } }),
    updateMilestone: (opportunityId: string, milestoneId: string, update: MilestoneUpdateInput) => request<MilestoneView>('updateMilestone', { opportunityId, milestoneId, update }),
    runMcemCoach: (accountId: string, opportunityId: string) => request<McemView>('runMcemCoach', { accountId, opportunityId }),
    transitionOpportunityStage: (accountId: string, opportunityId: string, targetStage: number, reason?: string) =>
        request<McemTransitionView>('transitionOpportunityStage', { accountId, opportunityId, targetStage, ...(reason ? { reason } : {}) }),
    runAgentTask: (capability: AgentCapability, accountId: string, opportunityId: string, prompt: string) =>
        request<AgentTaskView>('runAgentTask', { capability, accountId, opportunityId, prompt }),
    listWorkflowDefinitions: () => request<WorkflowDefinitionView[]>('listWorkflowDefinitions', { scope: 'portfolio' }),
    listWorkflowRuns: (limit = 10) => request<WorkflowRunView[]>('listWorkflowRuns', { limit }),
    openEvidence: (url: string) => request<null>('openEvidence', { url }),
    exportContent: (title: string, content: string) => request<{ saved: boolean }>('exportContent', { title, content }),
    composeEmail: (subject: string, title: string, body: string) => request<{ drafted: boolean }>('composeEmail', { subject, title, body }),

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

    async runWorkflowToCompletion(workflowId: string, asOf: string): Promise<WorkflowRunResultView> {
        const run = await request<WorkflowRunView>('startWorkflow', {
            workflowId,
            scope: { kind: 'portfolio' },
            input: { asOf }
        })
        const deadline = Date.now() + POLL_TIMEOUT_MS
        let view = await request<WorkflowRunResultView>('getWorkflowRun', { runId: run.runId })
        while (view.run.status !== 'completed' && view.run.status !== 'failed' && view.run.status !== 'cancelled') {
            if (Date.now() > deadline) throw new Error('The play timed out before completing.')
            await delay(POLL_INTERVAL_MS)
            view = await request<WorkflowRunResultView>('getWorkflowRun', { runId: run.runId })
        }
        return view
    }
}
