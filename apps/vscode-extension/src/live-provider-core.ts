import {
    contractVersion,
    workflowContractVersion,
    type AgentCapability,
    type ScopeRef
} from '../../../packages/common/index.js'
import { ThinSliceOrchestrator, type AgentTaskContext, type TaskAgentRegistry } from '../../../packages/orchestrator/index.js'
import type { WorkflowHost } from '../../../packages/orchestrator/workflows/index.js'
import type { ExtensionDataProvider } from './data-provider.js'

export const AGENT_CAPABILITIES: readonly AgentCapability[] = ['account-pulse', 'mcem-coach', 'pursuit-executive', 'risk-solution-play']
const LIVE_AGENT_VERSION = 'guidance-live-v1'
const MCEM_COACH_PROMPT = 'Evaluate the current MCEM stage exit criteria and recommend the next best actions.'

/** Deterministic guidance rendered over live MSX context + MCEM evaluation (no Foundry dependency). */
function formatLiveAgentGuidance(capability: AgentCapability, context: AgentTaskContext): string {
    const evaluation = context.localEvaluation
    const opportunity = context.opportunityContext.opportunity
    const headline: Record<AgentCapability, string> = {
        'account-pulse': `Focus for ${opportunity.name}: close the highest-priority Stage ${evaluation.recordedStage} evidence gaps and confirm the next customer commitment.`,
        'mcem-coach': evaluation.summary,
        'pursuit-executive': `Prepare the pursuit for ${opportunity.name} around its Stage ${evaluation.recordedStage} gaps, decision team, and customer commitments.`,
        'risk-solution-play': `${opportunity.name} has ${evaluation.recommendations.length} progression risk${evaluation.recommendations.length === 1 ? '' : 's'} to resolve before Stage ${evaluation.evidenceBasedStage}.`
    }
    const criteria = evaluation.criteria.map((criterion) => `- **${criterion.label}: ${criterion.status}** — ${criterion.rationale}`).join('\n')
    const recommendations = evaluation.recommendations.map((recommendation) => `| ${recommendation.ownerRole} | ${recommendation.action} | ${recommendation.confidence} |`).join('\n')
    const missing = evaluation.missingData.length > 0
        ? evaluation.missingData.map((item) => `- ${item}`).join('\n')
        : '- All current-stage exit criteria have supporting evidence.'
    return [
        '## Summary', '', headline[capability], '',
        `> Requested: ${context.request.prompt}`, '',
        '## Context used', '',
        `**Opportunity:** ${opportunity.name}`,
        `**Owner:** ${opportunity.owner ?? 'Account team'}`,
        `**Recorded / evidence-based stage:** ${evaluation.recordedStage} / ${evaluation.evidenceBasedStage}`,
        `**MCEM guidance:** ${context.guidance.title}`, '',
        '## Exit criteria', '', criteria, '',
        '## Recommended actions', '',
        '| Owner | Action | Confidence |', '| --- | --- | --- |', recommendations, '',
        '## Assumptions and missing information', '', missing
    ].join('\n')
}

export function buildLiveTaskAgents(): TaskAgentRegistry {
    return Object.fromEntries(AGENT_CAPABILITIES.map((capability) => [capability, {
        version: LIVE_AGENT_VERSION,
        agent: { invoke: async (context: AgentTaskContext) => formatLiveAgentGuidance(capability, context) }
    }])) as TaskAgentRegistry
}

export interface LiveDataProviderParts {
    orchestrator: ThinSliceOrchestrator
    host: WorkflowHost
    account: string
    dispose: () => Promise<void>
}

/** Assembles the provider surface from injected parts so MCEM/agent/Play wiring is unit-testable. */
export function buildLiveDataProvider({ orchestrator, host, account, dispose }: LiveDataProviderParts): ExtensionDataProvider {
    return {
        mode: 'live',
        getCurrentUserEmail: async () => account,
        listAccounts: () => orchestrator.listAccounts(),
        listOpportunities: (accountId) => orchestrator.listOpportunities(accountId),
        listMilestones: (opportunityId) => orchestrator.listMilestones(opportunityId),
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
        dispose
    }
}
