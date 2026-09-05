import { AIProjectClient } from '@azure/ai-projects'
import type { TokenCredential } from '@azure/core-auth'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentInvoker, McemAgentContext } from '../../orchestrator/index.js'

export interface FoundryPromptAgentOptions {
  projectEndpoint: string
  agentName: string
  requestTimeoutMs: number
  credential: TokenCredential
  openAIClient?: FoundryOpenAIClient
}

export type FoundryOpenAIClient = ReturnType<AIProjectClient['getOpenAIClient']>

export function createFoundryOpenAIClient(
  projectEndpoint: string,
  credential: TokenCredential
): FoundryOpenAIClient {
  return new AIProjectClient(projectEndpoint, credential).getOpenAIClient()
}

export class FoundryPromptAgent<TContext> implements AgentInvoker<TContext> {
  private readonly openAIClient

  constructor(private readonly options: FoundryPromptAgentOptions) {
    this.openAIClient = options.openAIClient ?? createFoundryOpenAIClient(options.projectEndpoint, options.credential)
  }

  async invoke(context: TContext): Promise<string> {
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), this.options.requestTimeoutMs)

    try {
      const response = await this.openAIClient.responses.create(
        { input: JSON.stringify(context) },
        {
          body: {
            agent_reference: {
              name: this.options.agentName,
              type: 'agent_reference'
            }
          },
          signal: abortController.signal
        }
      )
      if (!response.output_text?.trim()) {
        throw new Error(`Foundry agent ${this.options.agentName} returned no text output.`)
      }
      return response.output_text.trim()
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class FoundryMcemAgent extends FoundryPromptAgent<McemAgentContext> {}

export class RecordingMcemAgent implements AgentInvoker<McemAgentContext> {
  constructor(private readonly capturePath: string) {}

  async invoke(context: McemAgentContext): Promise<string> {
    await mkdir(dirname(this.capturePath), { recursive: true })
    await writeFile(this.capturePath, `${JSON.stringify(context, null, 2)}\n`, 'utf8')
    return 'Recorded MCEM context for deterministic UI validation.'
  }
}

export class StaticPromptAgent<TContext> implements AgentInvoker<TContext> {
  constructor(private readonly content: string) {}

  async invoke(): Promise<string> {
    return this.content
  }
}