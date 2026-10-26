import type { TokenCredential } from '@azure/core-auth'
import type { FoundryEnvironment } from '../../../../packages/common/configuration/foundry-environment.js'
import type { PerformanceReporter } from '../../../../packages/common/index.js'
import type { FoundryOpenAIClient } from '../../../../packages/connectors/foundry/index.js'
import type { TaskAgentRegistry } from '../../../../packages/orchestrator/index.js'
import { createFoundryTaskAgents } from '../../../../packages/orchestrator/task-agents.js'
import type { SampleInference } from '../../../../packages/orchestrator/sample-inference.js'

/**
 * Desktop keeps its own sample guidance; live mode uses the shared Foundry factory so the model
 * input is serialized identically to every other host.
 */
export function createDesktopTaskAgents(options: {
  environment?: FoundryEnvironment | undefined
  credential?: TokenCredential | undefined
  client?: FoundryOpenAIClient | undefined
  performanceReporter?: PerformanceReporter | undefined
  sample(): TaskAgentRegistry
  inference?: SampleInference
}): TaskAgentRegistry {
  if (options.inference) return options.inference.taskAgents(options.sample())
  if (!options.environment || !options.credential) return options.sample()
  return createFoundryTaskAgents(options.environment, options.credential, options.client, options.performanceReporter)
}
