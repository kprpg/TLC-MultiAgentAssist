import type { TokenCredential } from '@azure/core-auth'
import { measurePerformance, type PerformanceReporter } from '../common/index.js'
import type { McemGuidanceConnector } from '../connectors/common/index.js'

export interface AgentPrewarmOptions {
  credential?: TokenCredential | undefined
  /** Foundry token scopes, for example `https://ai.azure.com/.default`. */
  scopes?: readonly string[] | undefined
  guidance?: McemGuidanceConnector | undefined
  performanceReporter?: PerformanceReporter | undefined
}

/**
 * Moves first-use costs (Foundry token acquisition, MCEM guidance parsing) off the first agent click.
 * Best effort: failures are ignored here and surface normally when the agent is actually used.
 */
export function prewarmAgentDependencies(options: AgentPrewarmOptions): Promise<void> {
  const { credential, scopes, guidance } = options
  return measurePerformance('agent.prewarm', options.performanceReporter, async () => {
    await Promise.allSettled([
      credential && scopes?.length ? credential.getToken([...scopes]) : undefined,
      guidance?.getStageGuidance(1)
    ])
  })
}
