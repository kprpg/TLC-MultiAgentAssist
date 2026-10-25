import { z } from 'zod'
import * as c from '../../../../packages/common/contracts/index.js'
import { seDomainSchema } from '../../../../packages/common/configuration/se-domains.js'
import { SessionPortfolio, waitForSessionRead } from '../../../shared/session-portfolio.js'
import { MutationSyncClient } from '../../../shared/mutation-sync.js'
import { createAgentStreamAccumulator, readNdjson, type AgentStreamProgress } from '../../../shared/agent-stream.js'
import type { TeamsApiBasePath, TeamsDataMode } from '../../../../packages/common/contracts/teams-data-mode.js'
import {
  actionApprovalSchema, actionPreviewSchema, actionReceiptSchema, collaborationVersion, teamsSessionSchema,
  type ActionPreview, type ActionReceipt
} from '../../../../packages/common/contracts/collaboration.js'
import {
  workingSessionPrepareRequestSchema, workingSessionResultSchema, workingSessionTopicRequestSchema, workingSessionTopicResponseSchema,
  type WorkingSessionPrepareRequest, type WorkingSessionResult, type WorkingSessionTopicRequest, type WorkingSessionTopicResponse
} from '../../../../packages/common/contracts/working-session.js'
import type { WorkingSessionClient } from '../../../shared/working-session/types.js'

export class TeamsRequestError extends Error {
  constructor(readonly code: string, readonly correlationId?: string, readonly claims?: string, readonly status?: number, readonly retryAfterMs?: number) {
    super(`${code.replaceAll('_', ' ')}${correlationId ? ` (reference ${correlationId})` : ''}`)
    this.name = 'TeamsRequestError'
  }
}
export class TeamsApiClient implements WorkingSessionClient {
  private readonly disposed = new AbortController()
  private readonly portfolio = new SessionPortfolio({
    getPortfolioIndex: () => this.request('operations/getPortfolioIndex', c.portfolioIndexSchema, { contractVersion: c.portfolioReadVersion, includeHidden: true }),
    getDiscoverySnapshot: () => this.request('operations/getDiscoverySnapshot', c.discoverySnapshotSchema, { contractVersion: c.discoverySnapshotVersion }),
    listMilestones: (opportunityId) => this.request('operations/listMilestones', z.array(c.milestoneSchema), { opportunityId }),
    listDiscoverableMilestones: (opportunityId) => this.request('operations/listDiscoverableMilestones', z.array(c.milestoneSchema), { opportunityId })
  })
  readonly cacheSession = this.portfolio
  readonly mutationSession = new MutationSyncClient(
    (input) => this.request('mutation-sync', c.mutationSyncResponseSchema, input),
    {
      onConfirmed: (operation, result, input) => { this.portfolio.applyMutation(operation, result); this.portfolio.finishDraft(operation, input) },
      onRecovered: () => { this.portfolio.refresh(); this.portfolio.cache.changed() },
      onAccessDenied: () => this.portfolio.clear()
    }
  )
  private readonly syncReviews = new Map<string, c.MutationReview>()
  private readonly interests = new Map<string, { keys: readonly string[]; active: boolean }>()
  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly onAuthenticationRequired?: (claims?: string) => void,
    private readonly isCurrentToken?: (token: string) => boolean,
    private readonly apiBasePath: TeamsApiBasePath = '/api/teams',
    private readonly expectedMode?: TeamsDataMode
  ) {}
  private assertCurrentToken(token: string): void {
    if (this.disposed.signal.aborted) throw new TeamsRequestError('data_mode_changed')
    if (this.isCurrentToken && !this.isCurrentToken(token)) throw new TeamsRequestError('local_connection_changed')
  }
  async request<T>(path: string, schema: z.ZodType<T>, input?: unknown, signal?: AbortSignal): Promise<T> {
    const { response, token } = await this.fetchResponse(path, input, signal)
    const value: unknown = await response.json()
    this.assertCurrentToken(token)
    return schema.parse(value)
  }
  private async fetchResponse(path: string, input?: unknown, signal?: AbortSignal): Promise<{ response: Response; token: string }> {
    const token = await this.getToken()
    this.assertCurrentToken(token)
    const response = await fetch(`${this.apiBasePath}/${path}`, {
      method: input === undefined ? 'GET' : 'POST', credentials: 'omit',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(input === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: AbortSignal.any([this.disposed.signal, ...(signal ? [signal] : [])])
    })
    this.assertCurrentToken(token)
    if (!response.ok) {
      const error = z.object({ error: z.string(), correlationId: z.string().optional(), claims: z.string().max(8192).optional() }).parse(await response.json())
      this.assertCurrentToken(token)
      if (response.status === 401) this.onAuthenticationRequired?.(error.claims)
      if (response.status === 401 || response.status === 403) this.portfolio.clear()
      const retry = response.headers.get('retry-after')
      const retryAfterMs = retry === null ? undefined : /^\d+(?:\.\d+)?$/.test(retry)
        ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())
      throw new TeamsRequestError(error.error, error.correlationId, error.claims, response.status,
        retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? retryAfterMs : undefined)
    }
    return { response, token }
  }
  /** Progressive guidance run: reports the instant draft and streamed text, resolves with the authoritative response. */
  async runAgentTaskStream(input: unknown, onProgress?: (progress: AgentStreamProgress) => void, signal?: AbortSignal): Promise<c.AgentTaskResponse> {
    const { response, token } = await this.fetchResponse('agent-stream', input, signal)
    if (!response.body) throw new TeamsRequestError('stream_unavailable')
    const accumulator = createAgentStreamAccumulator(onProgress)
    const combined = AbortSignal.any([this.disposed.signal, ...(signal ? [signal] : [])])
    await readNdjson(response.body, (value) => {
      this.assertCurrentToken(token)
      accumulator.push(c.agentTaskStreamEventSchema.parse(value))
    }, combined)
    return accumulator.result()
  }
  async download(path: string, input: unknown, name: string): Promise<void> {
    const { response, token } = await this.fetchResponse(path, input)
    const blob = await response.blob()
    this.assertCurrentToken(token)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = name; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  deriveWorkingSessionTopic(input: WorkingSessionTopicRequest): Promise<WorkingSessionTopicResponse> {
    return this.request('working-session/topic', workingSessionTopicResponseSchema, workingSessionTopicRequestSchema.parse(input))
  }
  prepareWorkingSession(input: WorkingSessionPrepareRequest): Promise<WorkingSessionResult> {
    return this.request('working-session/prepare', workingSessionResultSchema, workingSessionPrepareRequestSchema.parse(input))
  }
  downloadWorkingSession(downloadId: string, fileName: string): Promise<void> {
    return this.download(`working-session/download/${encodeURIComponent(downloadId)}`, undefined, fileName)
  }
  async session() {
    const session = await this.request('session', teamsSessionSchema)
    if (this.expectedMode && session.mode !== this.expectedMode) throw new TeamsRequestError('data_mode_session_mismatch')
    return session
  }
  operation<T>(name: string, input: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    let readToken: string | undefined
    const cached = async (): Promise<unknown> => {
      readToken = await this.getToken()
      this.assertCurrentToken(readToken)
      signal?.throwIfAborted()
      switch (name) {
        case 'getPortfolioIndex': return this.portfolio.getPortfolioIndex(c.portfolioReadRequestSchema.parse(input).includeHidden)
        case 'getPortfolioWorkspace': return this.portfolio.getPortfolioWorkspace(c.portfolioWorkspaceRequestSchema.parse(input))
        case 'getDiscoverySnapshot':
          c.discoverySnapshotRequestSchema.parse(input)
          return this.portfolio.getDiscoverySnapshot()
        case 'listAccounts': return this.portfolio.listAccounts(c.accountListOptionsSchema.parse(input).includeHidden)
        case 'listOpportunities': return this.portfolio.listOpportunities(z.object({ accountId: z.string().min(1) }).parse(input).accountId)
        case 'discoverOpportunities': return this.portfolio.discoverOpportunities(z.object({ domain: seDomainSchema }).parse(input).domain)
        case 'listMilestones':
        case 'listDiscoverableMilestones':
          return this.portfolio.listMilestones(z.object({ opportunityId: z.string().min(1) }).parse(input).opportunityId, name === 'listDiscoverableMilestones')
        case 'listMilestoneActivities': {
          const request = z.object({ opportunityId: z.string().min(1), milestoneId: z.string().min(1) }).parse(input)
          return this.portfolio.readDataset(`activities:${request.opportunityId}:${request.milestoneId}`,
            () => this.request(`operations/${name}`, schema, input))
        }
        case 'getRecordCreationCatalog': {
          const request = c.recordCreationCatalogRequestSchema.parse(input)
          return this.portfolio.readDataset(`catalog:${request.accountId}`, () => this.request(`operations/${name}`, schema, input), { reference: true })
        }
        case 'searchAccounts': {
          const request = c.accountSearchRequestSchema.parse(input)
          return this.portfolio.readDataset(`search:${request.matchBy}:${request.query}`, () => this.request(`operations/${name}`, schema, input))
        }
        default: throw new Error('The operation is not a cached portfolio read.')
      }
    }
    if (['getPortfolioIndex', 'getPortfolioWorkspace', 'getDiscoverySnapshot', 'listAccounts', 'listOpportunities', 'discoverOpportunities', 'listMilestones', 'listDiscoverableMilestones', 'listMilestoneActivities', 'getRecordCreationCatalog', 'searchAccounts'].includes(name)) {
      return waitForSessionRead(cached(), signal).then((value) => {
        if (readToken === undefined) throw new TeamsRequestError('local_connection_changed')
        this.assertCurrentToken(readToken)
        const project = (data: unknown): unknown => {
          if (Array.isArray(data)) return data.map((item) => {
            if (name === 'listOpportunities') return this.mutationSession.projectOpportunity(c.opportunitySchema.parse(item))
            if (name === 'discoverOpportunities') return this.mutationSession.projectDiscovery(c.discoverableOpportunitySchema.parse(item))
            if (name === 'listMilestones' || name === 'listDiscoverableMilestones') return this.mutationSession.projectMilestone(c.milestoneSchema.parse(item))
            return item
          })
          if (name === 'getPortfolioWorkspace') {
            const workspace = c.portfolioWorkspaceSchema.parse(data)
            return { ...workspace, opportunities: workspace.opportunities.map((item) => this.mutationSession.projectOpportunity(item)),
              milestones: workspace.milestones.map((item) => this.mutationSession.projectMilestone(item)) }
          }
          if (name === 'getDiscoverySnapshot') {
            const snapshot = c.discoverySnapshotSchema.parse(data)
            return { ...snapshot, opportunities: snapshot.opportunities.map((item) => this.mutationSession.projectDiscovery(item)) }
          }
          return data
        }
        return schema.parse(project(value))
      })
    }
    return this.request(`operations/${encodeURIComponent(name)}`, schema, input, signal)
  }
  async preview(operation: string, input: unknown): Promise<ActionPreview> {
    const parsed = c.syncMutationOperationSchema.safeParse(operation)
    if (parsed.success) {
      const review = await this.mutationSession.prepareReviewed(parsed.data, z.record(z.string(), z.unknown()).parse(input))
      if (review) {
        this.syncReviews.set(review.id, review)
        const { recordKeys, ...wire } = review
        void recordKeys
        return actionPreviewSchema.parse({ ...wire, state: 'awaiting-approval' })
      }
    }
    return this.request('actions/preview', actionPreviewSchema, { operation, input })
  }
  async commitBackground(preview: ActionPreview, reason: string): Promise<{ admitted: boolean; completion: Promise<ActionReceipt> }> {
    const review = this.syncReviews.get(preview.id)
    if (!review) return { admitted: false, completion: this.commit(preview, reason) }
    const admitted = await this.mutationSession.submitReviewed(review, reason)
    return {
      admitted: true,
      completion: admitted.completion.then((receipt) => {
        if (receipt.state === 'conflict') throw new Error('Source values changed. Keep your draft and prepare a new review.')
        return actionReceiptSchema.parse({
          contractVersion: collaborationVersion, id: receipt.id, operation: receipt.operation, occurredAt: receipt.updatedAt,
          state: receipt.state === 'confirmed' ? 'confirmed' : receipt.state === 'failed-before-send' ? 'failed-before-send' : 'effect-unknown',
          ...(receipt.result === undefined ? {} : { result: receipt.result })
        })
      })
    }
  }
  async commit(preview: ActionPreview, reason: string): Promise<ActionReceipt> {
    if (this.syncReviews.has(preview.id)) return (await this.commitBackground(preview, reason)).completion
    const approval = actionApprovalSchema.parse({ contractVersion: collaborationVersion, id: preview.id, digest: preview.digest, reason })
    const receipt = await this.request('actions/commit', actionReceiptSchema, approval)
    if (receipt.state === 'confirmed') this.portfolio.applyMutation(preview.operation, receipt.result)
    return receipt
  }
  setActiveReads(keys: readonly string[], active: boolean, consumer = 'main'): void {
    if (!active && !keys.length) this.interests.delete(consumer)
    else this.interests.set(consumer, { keys, active })
    const visible = [...this.interests.values()].filter((item) => item.active)
    this.portfolio.setActiveKeys([...new Set(visible.flatMap((item) => item.keys))])
    this.portfolio.setActive(visible.length > 0)
  }
  refreshSources(): void { this.portfolio.refresh() }
  dispose(): void { this.disposed.abort(); this.portfolio.dispose(); this.mutationSession.dispose(); this.syncReviews.clear() }
}
export type ReviewAction = (operation: string, input: Record<string, unknown>) => Promise<ActionReceipt>
export type ReviewPreview = (preview: ActionPreview) => Promise<ActionReceipt>
