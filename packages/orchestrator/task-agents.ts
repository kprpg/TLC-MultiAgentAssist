import type { TokenCredential } from '@azure/core-auth'
import type { FoundryEnvironment } from '../common/configuration/foundry-environment.js'
import { workflowAgentCapabilityValues } from '../common/contracts/workflows.js'
import { createFoundryOpenAIClient, FoundryPromptAgent, type FoundryOpenAIClient } from '../connectors/foundry/index.js'
import { formatLiveAgentGuidance } from './instant-draft.js'
import type { AgentTaskContext, TaskAgentRegistry } from './index.js'
import type { PerformanceReporter } from '../common/index.js'


export function createDeterministicLiveTaskAgents(): TaskAgentRegistry {
  return Object.fromEntries(workflowAgentCapabilityValues.map((capability) => [capability, {
    version: 'guidance-live-v1',
    agent: { invoke: async (context: AgentTaskContext) => formatLiveAgentGuidance(capability, context) }
  }]))
}

export function createFoundryTaskAgents(environment: FoundryEnvironment, credential: TokenCredential, client: FoundryOpenAIClient = createFoundryOpenAIClient(environment.foundry.projectEndpoint, credential), performanceReporter?: PerformanceReporter): TaskAgentRegistry {
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
      requestTimeoutMs: environment.foundry.requestTimeoutMs, credential, openAIClient: client,
      ...foundryAgentTuning(environment, performanceReporter)
    })
  }]))
}

/** Optional latency controls shared by every host that builds Foundry prompt agents. */
export function foundryAgentTuning(environment: FoundryEnvironment, performanceReporter?: PerformanceReporter) {
  return {
    firstTokenTimeoutMs: environment.foundry.firstTokenTimeoutMs,
    maxOutputTokens: environment.foundry.maxOutputTokens,
    performanceReporter
  }
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
