import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity'
import type { TokenCredential } from '@azure/core-auth'
import { ZodError } from 'zod'
import {
  inferenceContractVersion, inferenceExecutionSchema, inferenceLabel, inferenceResponseVersion, resolveSampleInferenceMode,
  type InferenceExecution, type InferenceResult
} from '../common/contracts/inference.js'
import { loadFoundryEnvironmentFromEnvironment, type FoundryEnvironment } from '../common/configuration/foundry-environment.js'
import { createFoundryOpenAIClient, type FoundryOpenAIClient } from '../connectors/foundry/index.js'
import { guardedInferenceFetch, InferenceAdmissionError, SampleInferenceBudget, type InferenceAdmission } from '../connectors/foundry/sample-budget.js'
import { createFoundryMeetingExtractor } from '../agents/meeting-signal-extractor/src/foundry-extractor.js'
import { extractMeetingSignals } from '../agents/meeting-signal-extractor/src/index.js'
import type { MeetingExtractorFn } from '../connectors/local-store/index.js'
import { createFoundryTaskAgents } from './task-agents.js'
import { formatLiveAgentGuidance } from './instant-draft.js'
import { foundryStructuredModel, workingSessionModelName } from './working-session/foundry-model.js'
import { createSeNarrativeSynthesizer } from '../connectors/se-reporting/synthesis.js'
import type { AgentStreamHandlers, AgentTaskContext, TaskAgentRegistry } from './index.js'

interface FoundryContext { environment: FoundryEnvironment; client: FoundryOpenAIClient; agents: TaskAgentRegistry }
export interface SampleInferenceOptions {
  environment?: NodeJS.ProcessEnv
  hosted?: boolean
  credential?: TokenCredential
  prepareCredential?: () => Promise<void>
  loadEnvironment?: () => Promise<FoundryEnvironment>
  client?: FoundryOpenAIClient
  admission?: InferenceAdmission
  fetcher?: typeof fetch
  onFallback?: (reason: NonNullable<InferenceExecution['reason']>) => void
}

export class SampleInference {
  readonly mode
  private readonly environment
  private context: Promise<FoundryContext> | undefined
  private budget: SampleInferenceBudget | undefined
  constructor(private readonly options: SampleInferenceOptions = {}) {
    this.environment = options.environment ?? process.env
    this.mode = resolveSampleInferenceMode(this.environment)
  }

  private async foundry(): Promise<FoundryContext> {
    this.context ??= (async () => {
      const environment = await (this.options.loadEnvironment?.() ?? loadFoundryEnvironmentFromEnvironment(this.environment))
      const hosted = this.options.hosted ?? Boolean(this.environment['WEBSITE_SITE_NAME'])
      const credential = this.options.credential ?? (hosted
        ? this.environment['AZURE_CLIENT_ID']?.trim()
          ? new ManagedIdentityCredential(this.environment['AZURE_CLIENT_ID']!.trim()) : new ManagedIdentityCredential()
        : new AzureCliCredential({ tenantId: environment.authentication.foundryTenantId, processTimeoutInMs: 30_000 }))
      let admission = this.options.admission
      if (hosted && !admission) {
        const home = this.environment['HOME']?.trim()
        const slot = this.environment['WEBSITE_SLOT_NAME']?.trim() || 'production'
        if (!home || !/^[a-zA-Z0-9-]+$/.test(slot)) throw new InferenceAdmissionError('configuration', 'Sample AI needs writable, slot-specific usage storage.')
        const path = this.environment['TLC_AI_BUDGET_PATH']?.trim() || join(home, 'data', 'tlc-ai', slot, 'usage.sqlite')
        const packageRoot = resolve(home, 'site', 'wwwroot').toLowerCase()
        if (!isAbsolute(path) || resolve(path).toLowerCase().startsWith(`${packageRoot}${sep}`)) {
          throw new InferenceAdmissionError('configuration', 'Hosted AI usage must persist outside the deployment package.')
        }
        this.budget = new SampleInferenceBudget(path)
        admission = this.budget
      }
      const client = this.options.client ?? createFoundryOpenAIClient(environment.foundry.projectEndpoint, credential, {
        maxRetries: 0, timeout: environment.foundry.requestTimeoutMs,
        fetch: guardedInferenceFetch(environment.foundry.projectEndpoint, {
          ...(admission ? { admission } : {}), ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}),
          timeoutMs: environment.foundry.requestTimeoutMs
        })
      })
      return { environment, client, agents: createFoundryTaskAgents(environment, credential, client, undefined, {
        retryFirstToken: false, inlineAgentReference: true
      }) }
    })().catch((error: unknown) => {
      this.context = undefined
      throw error
    })
    return this.context
  }

  async run<T>(online: (context: FoundryContext) => Promise<T>, offline: () => T | Promise<T>, signal?: AbortSignal): Promise<InferenceResult<T>> {
    signal?.throwIfAborted()
    const base = { contractVersion: inferenceContractVersion, correlationId: randomUUID(), requested: this.mode }
    if (this.mode === 'sample') return { value: await offline(), execution: { ...base, provider: 'sample', state: 'complete' } }
    try {
      const context = await this.foundry()
      signal?.throwIfAborted()
      await this.options.prepareCredential?.()
      signal?.throwIfAborted()
      const value = await online(context)
      signal?.throwIfAborted()
      return { value, execution: { ...base, provider: 'foundry', state: 'complete' } }
    } catch (error) {
      signal?.throwIfAborted()
      const reason = inferenceFailureReason(error)
      if (this.options.onFallback) this.options.onFallback(reason)
      else console.warn(`[sample-ai] offline-fallback:${reason}`)
      return {
        value: await offline(),
        execution: inferenceExecutionSchema.parse({ ...base, provider: 'sample', state: 'fallback', reason })
      }
    }
  }

  taskAgents(offline: TaskAgentRegistry): TaskAgentRegistry {
    if (this.mode === 'sample') return offline
    return Object.fromEntries(Object.entries(offline).map(([capability, entry]) => {
      if (!entry) throw new Error('Missing offline agent implementation.')
      const infer = (context: AgentTaskContext, handlers?: AgentStreamHandlers) => this.run(async ({ agents }) => {
        const configured = agents[context.request.capability]
        if (!configured) throw new Error('The requested Foundry agent is not configured.')
        const content = handlers && configured.agent.stream
          ? await configured.agent.stream(context, handlers) : await configured.agent.invoke(context)
        if (!content?.trim()) throw new Error('The configured agent returned no content.')
        return content
      }, () => formatLiveAgentGuidance(context.request.capability, context), handlers?.signal)
      return [capability, { ...entry, version: 'active', infer, agent: {
        invoke: async (context: AgentTaskContext) => (await infer(context)).value,
        stream: async (context: AgentTaskContext, handlers: AgentStreamHandlers) => (await infer(context, handlers)).value
      } }]
    }))
  }

  meetingExtractor(): MeetingExtractorFn | undefined {
    if (this.mode === 'sample') return undefined
    return async (context, options) => {
      const result = await this.run(async ({ client, environment }) => createFoundryMeetingExtractor({
        openAIClient: client, model: this.modelName('TLC_MEETING_MODEL'), requestTimeoutMs: environment.foundry.requestTimeoutMs
      })(context, options), () => extractMeetingSignals(context, options))
      return { ...result.value, contractVersion: inferenceResponseVersion, inference: result.execution }
    }
  }

  modelName(setting: string): string {
    const name = this.environment[setting]?.trim() || workingSessionModelName(
      setting === 'TLC_WORKING_SESSION_MODEL' ? this.environment : {})
    if (!name || /^(off|none|false|0)$/i.test(name)) throw new InferenceAdmissionError('configuration', 'The requested Foundry deployment is disabled or unconfigured.')
    return name
  }

  structuredModel(context: FoundryContext) {
    return foundryStructuredModel(context.client, this.modelName('TLC_WORKING_SESSION_MODEL'), context.environment.foundry.requestTimeoutMs)
  }

  narrativeModel(context: FoundryContext) {
    return createSeNarrativeSynthesizer({
      client: context.client, model: this.modelName('TLC_SE_REPORTING_MODEL'), timeoutMs: context.environment.foundry.requestTimeoutMs
    })
  }

  close(): void { this.budget?.close() }
}

export function inferenceFailureReason(error: unknown): NonNullable<InferenceExecution['reason']> {
  if (error instanceof InferenceAdmissionError) return error.reason
  if (error instanceof Error && error.cause instanceof InferenceAdmissionError) return error.cause.reason
  if (error instanceof ZodError || error instanceof SyntaxError) return 'validation'
  if (error instanceof Error && /timeout|timedout|abort/i.test(error.name)) return 'timeout'
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
  if (status === 401 || status === 403) return 'authentication'
  if (status === 429) return 'quota'
  if (error instanceof Error && /configuration|environment|credential|authentication|login/i.test(error.name + error.message)) return 'configuration'
  return 'provider'
}

export function inferenceContent(content: string, execution: InferenceExecution): string {
  return execution.state === 'fallback' ? `${content}\n\n> ${inferenceLabel(execution)}` : content
}
