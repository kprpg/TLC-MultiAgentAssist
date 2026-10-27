import { AIProjectClient } from '@azure/ai-projects'
import type { TokenCredential } from '@azure/core-auth'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { reportMetrics, type PerformanceReporter } from '../../common/telemetry/performance.js'
import type { AgentInvoker, AgentStreamHandlers, McemAgentContext } from '../../orchestrator/index.js'

export interface FoundryPromptAgentOptions<TContext = unknown> {
  projectEndpoint: string
  agentName: string
  requestTimeoutMs: number
  credential: TokenCredential
  openAIClient?: FoundryOpenAIClient
  /** Streamed calls that produce no text within this window are aborted and retried once. Default 60 s. */
  firstTokenTimeoutMs?: number | undefined
  maxOutputTokens?: number | undefined
  performanceReporter?: PerformanceReporter | undefined
  /** Renders the model input. Defaults to `JSON.stringify(context)`. */
  serializeContext?: ((context: TContext) => string) | undefined
  retryFirstToken?: boolean | undefined
  inlineAgentReference?: boolean | undefined
  prepareCredential?: ((signal?: AbortSignal) => Promise<void>) | undefined
}

export type FoundryOpenAIClient = ReturnType<AIProjectClient['getOpenAIClient']>

export function createFoundryOpenAIClient(
  projectEndpoint: string,
  credential: TokenCredential,
  options?: Parameters<AIProjectClient['getOpenAIClient']>[0]
): FoundryOpenAIClient {
  const client = new AIProjectClient(projectEndpoint, credential).getOpenAIClient(options)
  // SDK 2.5 replaces the fetch option. Its public clone API preserves auth/routing and honors it.
  return options?.fetch ? client.withOptions(options) : client
}

export const defaultFirstTokenTimeoutMs = 60_000

class FirstTokenTimeoutError extends Error {
  constructor() {
    super('The Foundry agent produced no output before the first-token timeout.')
    this.name = 'FirstTokenTimeoutError'
  }
}

interface StreamEvent {
  type: string
  delta?: string
  response?: { usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } } }
  message?: string
}

function isStreamingUnsupported(error: unknown): boolean {
  const status = error !== null && typeof error === 'object' && 'status' in error ? (error as { status?: unknown }).status : undefined
  return status === 400 || status === 404 || status === 405 || status === 501
}

export class FoundryPromptAgent<TContext> implements AgentInvoker<TContext> {
  private readonly openAIClient

  constructor(private readonly options: FoundryPromptAgentOptions<TContext>) {
    this.openAIClient = options.openAIClient ?? createFoundryOpenAIClient(options.projectEndpoint, options.credential)
  }

  private input(context: TContext): string {
    return this.options.serializeContext ? this.options.serializeContext(context) : JSON.stringify(context)
  }

  async invoke(context: TContext): Promise<string> {
    if (this.options.prepareCredential) await this.options.prepareCredential()
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), this.options.requestTimeoutMs)

    try {
      const response = await this.openAIClient.responses.create(
        { input: this.input(context), ...this.outputLimit(), ...this.inlineReference() },
        {
          ...(this.options.inlineAgentReference ? {} : { body: {
            agent_reference: {
              name: this.options.agentName,
              type: 'agent_reference'
            }
          } }),
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

  /** Streams model text through `handlers.onDelta`; resolves to the full trimmed text. */
  async stream(context: TContext, handlers: AgentStreamHandlers): Promise<string> {
    if (this.options.prepareCredential) await this.options.prepareCredential(handlers.signal)
    handlers.signal?.throwIfAborted()
    let attempt = 0
    for (;;) {
      attempt++
      try {
        return await this.streamOnce(context, handlers, attempt)
      } catch (error) {
        if (error instanceof FirstTokenTimeoutError && attempt === 1 && this.options.retryFirstToken !== false && !handlers.signal?.aborted) continue
        if (isStreamingUnsupported(error) && !handlers.signal?.aborted) {
          const text = await this.invoke(context)
          handlers.onDelta(text)
          return text
        }
        throw error
      }
    }
  }

  private outputLimit(): { max_output_tokens?: number } {
    return this.options.maxOutputTokens === undefined ? {} : { max_output_tokens: this.options.maxOutputTokens }
  }

  private inlineReference() {
    return this.options.inlineAgentReference
      ? { agent_reference: { name: this.options.agentName, type: 'agent_reference' as const } } : {}
  }

  private async streamOnce(context: TContext, handlers: AgentStreamHandlers, attempt: number): Promise<string> {
    const controller = new AbortController()
    const startedAt = globalThis.performance.now()
    let firstTokenTimedOut = false
    let text = ''
    let firstTokenMs: number | undefined
    let usage: NonNullable<StreamEvent['response']>['usage']
    const relayAbort = () => controller.abort()
    handlers.signal?.addEventListener('abort', relayAbort, { once: true })
    if (handlers.signal?.aborted) controller.abort()
    const total = setTimeout(() => controller.abort(), this.options.requestTimeoutMs)
    const firstToken = setTimeout(() => { firstTokenTimedOut = true; controller.abort() },
      this.options.firstTokenTimeoutMs ?? defaultFirstTokenTimeoutMs)
    let outcome: 'success' | 'failure' = 'failure'
    try {
      const events = await this.openAIClient.responses.create(
        { input: this.input(context), stream: true, ...this.outputLimit(), ...this.inlineReference() },
        {
          ...(this.options.inlineAgentReference ? {} : { body: { agent_reference: { name: this.options.agentName, type: 'agent_reference' } } }),
          signal: controller.signal
        }
      ) as unknown as AsyncIterable<StreamEvent>
      for await (const event of events) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          if (firstTokenMs === undefined) {
            firstTokenMs = globalThis.performance.now() - startedAt
            clearTimeout(firstToken)
          }
          text += event.delta
          handlers.onDelta(event.delta)
        } else if (event.type === 'response.completed') {
          usage = event.response?.usage
        } else if (event.type === 'response.failed' || event.type === 'error') {
          throw new Error(`Foundry agent ${this.options.agentName} failed while streaming.`)
        }
      }
      if (!text.trim()) throw new Error(`Foundry agent ${this.options.agentName} returned no text output.`)
      outcome = 'success'
      return text.trim()
    } catch (error) {
      if (firstTokenTimedOut && firstTokenMs === undefined && !handlers.signal?.aborted) throw new FirstTokenTimeoutError()
      throw error
    } finally {
      clearTimeout(total)
      clearTimeout(firstToken)
      handlers.signal?.removeEventListener('abort', relayAbort)
      reportMetrics(this.options.performanceReporter, 'agent.foundry.stream', globalThis.performance.now() - startedAt, outcome, {
        attempt,
        ...(firstTokenMs === undefined ? {} : { firstTokenMs: Math.round(firstTokenMs) }),
        outputChars: text.length,
        ...(usage?.input_tokens === undefined ? {} : { inputTokens: usage.input_tokens }),
        ...(usage?.output_tokens === undefined ? {} : { outputTokens: usage.output_tokens }),
        ...(usage?.output_tokens_details?.reasoning_tokens === undefined ? {} : { reasoningTokens: usage.output_tokens_details.reasoning_tokens })
      })
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