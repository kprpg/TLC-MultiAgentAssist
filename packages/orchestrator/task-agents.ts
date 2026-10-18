import type { TokenCredential } from '@azure/core-auth'
import type { FoundryEnvironment } from '../common/configuration/foundry-environment.js'
import { workflowAgentCapabilityValues } from '../common/contracts/workflows.js'
import { createFoundryOpenAIClient, FoundryPromptAgent, type FoundryOpenAIClient } from '../connectors/foundry/index.js'
import type { AgentTaskContext, TaskAgentRegistry } from './index.js'

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
