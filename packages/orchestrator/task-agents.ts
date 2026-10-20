import type { TokenCredential } from '@azure/core-auth'
import type { FoundryEnvironment } from '../common/configuration/foundry-environment.js'
import { workflowAgentCapabilityValues } from '../common/contracts/workflows.js'
import { createFoundryOpenAIClient, FoundryPromptAgent, type FoundryOpenAIClient } from '../connectors/foundry/index.js'
import type { AgentTaskContext, TaskAgentRegistry } from './index.js'
import type { AgentCapability } from '../common/index.js'

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

export function createDeterministicLiveTaskAgents(): TaskAgentRegistry {
  return Object.fromEntries(workflowAgentCapabilityValues.map((capability) => [capability, {
    version: 'guidance-live-v1',
    agent: { invoke: async (context: AgentTaskContext) => formatLiveAgentGuidance(capability, context) }
  }]))
}

export function createFoundryTaskAgents(environment: FoundryEnvironment, credential: TokenCredential, client: FoundryOpenAIClient = createFoundryOpenAIClient(environment.foundry.projectEndpoint, credential)): TaskAgentRegistry {
  const bindings = environment.foundry.agents
  const agents = {
    'account-pulse': bindings.accountPulse,
    'mcem-coach': bindings.mcemCoach,
    'pursuit-executive': bindings.pursuitExecutive,
    'risk-solution-play': bindings.riskSolutionPlay
  }
  return Object.fromEntries(workflowAgentCapabilityValues.map((capability) => [capability, {
    version: 'active',
    agent: new FoundryPromptAgent<AgentTaskContext>({
      projectEndpoint: environment.foundry.projectEndpoint, agentName: agents[capability].name,
      requestTimeoutMs: environment.foundry.requestTimeoutMs, credential, openAIClient: client
    })
  }]))
}

export function createSampleTaskAgents(version = 'sample-v1'): TaskAgentRegistry {
  return Object.fromEntries(workflowAgentCapabilityValues.map((capability) => [capability, {
    version,
    agent: {
      invoke: async (context: AgentTaskContext) =>
        `## ${capability.replaceAll('-', ' ')}\n\nSample guidance for **${context.opportunityContext.opportunity.name}**.\n\n${context.request.prompt}`
    }
  }]))
}
