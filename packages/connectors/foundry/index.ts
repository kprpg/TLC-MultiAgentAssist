import { AIProjectClient } from '@azure/ai-projects'
import type { TokenCredential } from '@azure/core-auth'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { McemAgent, McemAgentContext } from '../../orchestrator/index.js'

export interface FoundryMcemAgentOptions {
  projectEndpoint: string
  agentName: string
  requestTimeoutMs: number
  credential: TokenCredential
}

export class FoundryMcemAgent implements McemAgent {
  private readonly openAIClient

  constructor(private readonly options: FoundryMcemAgentOptions) {
    const project = new AIProjectClient(options.projectEndpoint, options.credential)
    this.openAIClient = project.getOpenAIClient()
  }

  async invoke(context: McemAgentContext): Promise<void> {
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
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class RecordingMcemAgent implements McemAgent {
  constructor(private readonly capturePath: string) {}

  async invoke(context: McemAgentContext): Promise<void> {
    await mkdir(dirname(this.capturePath), { recursive: true })
    await writeFile(this.capturePath, `${JSON.stringify(context, null, 2)}\n`, 'utf8')
  }
}