import { randomUUID } from 'node:crypto'
import {
  addMsxOpportunityLink,
  accountListOptionsSchema,
  accountSearchRequestSchema,
  accountVisibilitySchema,
  portfolioReadRequestSchema,
  portfolioIndexSchema,
  portfolioWorkspaceRequestSchema,
  portfolioWorkspaceSchema,
  portfolioReadVersion,
  discoverySnapshotRequestSchema,
  discoverySnapshotSchema,
  discoverySnapshotVersion,
  seDomainIds,
  type DiscoverySnapshot,
  type DiscoverySnapshotRequest,
  type SyncMutationOperation,
  type PortfolioReadRequest,
  type PortfolioIndex,
  type PortfolioWorkspaceRequest,
  type PortfolioWorkspace,
  agentTaskRequestSchema,
  agentTaskStreamVersion,
  type AgentTaskStreamEvent,
  contractVersion,
  mcemStageTransitionRequestSchema,
  mcemStageTransitionResultSchema,
  mcemRequestSchema,
  seDomainSchema,
  type Account,
  type AccountCandidate,
  type AccountListOptions,
  type AccountSearchRequest,
  type AccountVisibility,
  type AgentCapability,
  type AgentTaskRequest,
  type AgentTaskResponse,
  type DealTeamJoinResult,
  type DealTeamLeaveResult,
  type DiscoverableOpportunity,
  type McemRequest,
  type McemResponse,
  type McemStageTransitionRequest,
  type McemStageTransitionResult,
  type Milestone,
  type MilestoneActivity,
  type CreateMilestoneActivityRequest,
  createMilestoneActivityRequestSchema,
  type MilestoneTeamJoinResult,
  type MilestoneTeamLeaveResult,
  type MilestoneUpdate,
  type Opportunity,
  type OpportunityUpdate,
  type SeDomainId,
  measurePerformance,
  type PerformanceReporter,
  type RecordCreationCatalog,
  type RecordCreationCatalogRequest,
  type RecordCreationPreview,
  type RecordCreationPreviewRequest,
  type RecordCreationCommitRequest,
  type RecordCreationDraftResult,
  type RecordCreationResult
} from '../common/index.js'
import { evaluateMcemProgress } from '../agents/mcem-coach/index.js'
import { formatLiveAgentGuidance } from './instant-draft.js'
import { agentSourceHealth, buildAgentEvidencePack, collectOpportunityEvidence, type AgentEvidencePack } from './agent-evidence.js'
import type {
  McemGuidanceConnector,
  MsxConnector,
  OpportunityContext,
  StageGuidance
} from '../connectors/common/index.js'
import { RecordCreationService, RecordCreationError } from './record-creation/service.js'
import { KnowledgeSearchService, type KnowledgeSearch } from './knowledge-search.js'
import type { KnowledgeSearchRequest, KnowledgeSearchResponse } from '../common/contracts/knowledge.js'

export interface McemAgentContext {
  request: McemRequest
  opportunityContext: OpportunityContext
  guidance: StageGuidance
  localEvaluation: McemResponse
}

export interface AgentStreamHandlers {
  onDelta(text: string): void
  signal?: AbortSignal | undefined
}

export interface AgentInvoker<TContext> {
  invoke(context: TContext): Promise<string | void>
  /** Optional progressive variant; resolves to the full text after every delta was delivered. */
  stream?(context: TContext, handlers: AgentStreamHandlers): Promise<string>
}

export type McemAgent = AgentInvoker<McemAgentContext>

export interface AgentTaskContext {
  request: AgentTaskRequest
  opportunityContext: OpportunityContext
  guidance: StageGuidance
  /** MCEM gate the opportunity must pass to advance; absent at the final stage or when unavailable. */
  nextStageGuidance?: StageGuidance
  localEvaluation: McemResponse
  /** Bounded comment history, notes, activities, and milestone detail shared by every agent and host. */
  evidence?: AgentEvidencePack
}

export interface ConfiguredTaskAgent {
  version: string
  agent: AgentInvoker<AgentTaskContext>
}

export type TaskAgentRegistry = Partial<Record<AgentCapability, ConfiguredTaskAgent>>

export class ThinSliceOrchestrator {
  private readonly mutationListeners = new Set<(operation: SyncMutationOperation, result: unknown, input: Record<string, unknown>) => void>()
  constructor(
    private readonly msx: MsxConnector,
    private readonly mcem: McemGuidanceConnector,
    private readonly taskAgents: TaskAgentRegistry = {},
    private readonly performanceReporter?: PerformanceReporter,
    private readonly recordCreation?: RecordCreationService,
    private readonly knowledge: KnowledgeSearch = new KnowledgeSearchService()
  ) { }

  searchKnowledge(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse> {
    return this.knowledge.searchKnowledge(request)
  }

  withReadContext<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    return this.msx.withReadContext ? this.msx.withReadContext(operation, signal) : operation()
  }

  subscribeMutations(listener: (operation: SyncMutationOperation, result: unknown, input: Record<string, unknown>) => void): () => void {
    this.mutationListeners.add(listener)
    return () => this.mutationListeners.delete(listener)
  }

  conditionalWriteOperations(): Promise<ReadonlyArray<'updateOpportunity' | 'updateMilestone' | 'transitionOpportunityStage'>> {
    return this.msx.conditionalWriteOperations ? this.msx.conditionalWriteOperations() : Promise.resolve([])
  }

  notifyMutation(operation: SyncMutationOperation, result: unknown, input: Record<string, unknown>): void {
    for (const listener of this.mutationListeners) {
      try { listener(operation, result, input) } catch {
        console.warn('[cache-sync] source-acknowledged-view-update-failed')
      }
    }
  }

  private async acknowledged<T>(operation: SyncMutationOperation, input: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
    const result = await work()
    this.notifyMutation(operation, result, input)
    return result
  }

  withFreshReadContext<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.msx.withFreshReadContext ? this.msx.withFreshReadContext(operation, signal) : this.withReadContext(operation, signal)
  }

  withReviewedVersions<T>(versions: Readonly<Record<string, string>>, operation: () => Promise<T>, verifyAccessToken?: (token: string) => void, onDispatch?: () => void): Promise<T> {
    return this.msx.withExpectedVersions ? this.msx.withExpectedVersions(versions,
      () => this.withFreshReadContext(operation), verifyAccessToken, onDispatch) : operation()
  }

  getPortfolioIndex(input: PortfolioReadRequest): Promise<PortfolioIndex> {
    const request = portfolioReadRequestSchema.parse(input)
    return this.withFreshReadContext(async () => {
      const options = { ...(request.includeHidden === undefined ? {} : { includeHidden: request.includeHidden }) }
      if (this.msx.getPortfolioIndex) {
        return portfolioIndexSchema.parse({ contractVersion: portfolioReadVersion, ...await this.msx.getPortfolioIndex(options) })
      }
      const accounts = await this.listAccounts(options)
      const groups = await Promise.all(accounts.filter((account) => account.visibility !== 'hidden').map((account) => this.listOpportunities(account.id)))
      return portfolioIndexSchema.parse({ contractVersion: portfolioReadVersion, accounts, opportunities: groups.flat() })
    })
  }

  getPortfolioWorkspace(input: PortfolioWorkspaceRequest): Promise<PortfolioWorkspace> {
    const request = portfolioWorkspaceRequestSchema.parse(input)
    return this.withFreshReadContext(async () => {
      const accounts = await this.listAccounts({ ...(request.includeHidden === undefined ? {} : { includeHidden: request.includeHidden }) })
      const account = request.accountId ? accounts.find((item) => item.id === request.accountId && item.visibility !== 'hidden')
        : accounts.find((item) => item.visibility !== 'hidden')
      if (request.accountId && !account) throw new Error('The selected account is not in the current visible portfolio.')
      const opportunities = account ? await this.listOpportunities(account.id) : []
      const opportunity = request.opportunityId ? opportunities.find((item) => item.id === request.opportunityId) : opportunities[0]
      if (request.opportunityId && !opportunity) throw new Error('The selected opportunity is not in the selected account portfolio.')
      const milestones = opportunity ? await this.msx.listMilestones(opportunity.id) : []
      return portfolioWorkspaceSchema.parse({
        contractVersion: portfolioReadVersion, accounts, opportunities, milestones,
        ...(account ? { selectedAccountId: account.id } : {}),
        ...(opportunity ? { selectedOpportunityId: opportunity.id } : {})
      })
    })
  }

  getDiscoverySnapshot(input: DiscoverySnapshotRequest): Promise<DiscoverySnapshot> {
    discoverySnapshotRequestSchema.parse(input)
    return this.withFreshReadContext(async () => {
      if (this.msx.getDiscoverySnapshot) {
        return discoverySnapshotSchema.parse({
          ...await this.msx.getDiscoverySnapshot(),
          contractVersion: discoverySnapshotVersion,
          generatedAt: new Date().toISOString()
        })
      }
      const accounts = await this.listAccounts({ includeHidden: true })
      const visible = new Set(accounts.filter((account) => account.visibility !== 'hidden').map((account) => account.id))
      const [groups, portfolios] = await Promise.all([
        Promise.all(seDomainIds.map((domain) => this.msx.discoverOpportunities(domain))),
        Promise.all([...visible].map((accountId) => this.msx.listOpportunities(accountId)))
      ])
      const portfolioOpportunities = portfolios.flat()
      const memberships = await Promise.all(portfolioOpportunities.map(async (opportunity) =>
        (await this.msx.listMilestones(opportunity.id)).some((milestone) => milestone.onMilestoneTeam) ? [opportunity.id] : []))
      return discoverySnapshotSchema.parse({
        contractVersion: discoverySnapshotVersion, generatedAt: new Date().toISOString(), accounts, portfolioOpportunities,
        opportunities: groups.flat().filter((opportunity) => visible.has(opportunity.accountId)),
        milestoneTeamOpportunityIds: memberships.flat()
      })
    })
  }

  getRecordCreationCatalog(request: RecordCreationCatalogRequest): Promise<RecordCreationCatalog> {
    return this.withReadContext(() => this.requireRecordCreation().getCatalog(request))
  }

  previewRecordCreation(request: RecordCreationPreviewRequest): Promise<RecordCreationPreview> {
    return this.requireRecordCreation().preview(request)
  }

  commitRecordCreation(request: RecordCreationCommitRequest): Promise<RecordCreationResult> {
    return this.acknowledged('commitRecordCreation', request, () => this.withFreshReadContext(() => this.requireRecordCreation().commit(request)))
  }

  exportRecordCreationDraft(request: RecordCreationCommitRequest): Promise<RecordCreationDraftResult> {
    return this.requireRecordCreation().exportDraft(request)
  }

  private requireRecordCreation(): RecordCreationService {
    if (!this.recordCreation) throw new RecordCreationError('target-disabled', 'Record creation is unavailable in this mode.')
    return this.recordCreation
  }

  listAccounts(options?: AccountListOptions): Promise<Account[]> {
    return this.msx.listAccounts(accountListOptionsSchema.parse(options ?? {}))
  }

  searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]> {
    return this.msx.searchAccounts(accountSearchRequestSchema.parse(request))
  }

  async addAccount(accountId: string): Promise<Account> {
    if (typeof accountId !== 'string' || accountId.trim().length === 0) {
      throw new Error('An account id is required.')
    }
    return this.acknowledged('addAccount', { accountId }, () => this.msx.addAccount(accountId))
  }

  async setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account> {
    if (typeof accountId !== 'string' || accountId.trim().length === 0) {
      throw new Error('An account id is required.')
    }
    return this.acknowledged('setAccountVisibility', { accountId, visibility }, () => this.msx.setAccountVisibility(accountId, accountVisibilitySchema.parse(visibility)))
  }

  listOpportunities(accountId: string): Promise<Opportunity[]> {
    return this.msx.listOpportunities(accountId)
  }

  async getOpportunitySnapshot(opportunityId: string): Promise<{ account: Account; opportunity: Opportunity; milestones: Milestone[]; revisionTokens?: Record<string, string> }> {
    if (!opportunityId.trim()) throw new Error('An opportunity id is required.')
    return this.withReadContext(async () => {
      const context = await this.msx.getOpportunityContext(opportunityId)
      const milestones = await this.msx.listMilestones(opportunityId)
      const revisionTokens = await this.msx.getConcurrencyTokens?.(opportunityId)
      return { account: context.account, opportunity: context.opportunity, milestones, ...(revisionTokens ? { revisionTokens } : {}) }
    })
  }

  async discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]> {
    return this.msx.discoverOpportunities(seDomainSchema.parse(domain))
  }

  async joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to join a deal team.')
    }
    return this.acknowledged('joinDealTeam', { opportunityId }, () => this.msx.joinDealTeam(opportunityId))
  }

  async leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to leave a deal team.')
    }
    return this.acknowledged('leaveDealTeam', { opportunityId }, () => this.msx.leaveDealTeam(opportunityId))
  }

  async joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to join a milestone team.')
    }
    if (typeof milestoneId !== 'string' || milestoneId.trim().length === 0) {
      throw new Error('A milestone id is required to join a milestone team.')
    }
    return this.acknowledged('joinMilestoneTeam', { opportunityId, milestoneId }, () => this.msx.joinMilestoneTeam(opportunityId, milestoneId))
  }

  async leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to leave a milestone team.')
    }
    if (typeof milestoneId !== 'string' || milestoneId.trim().length === 0) {
      throw new Error('A milestone id is required to leave a milestone team.')
    }
    return this.acknowledged('leaveMilestoneTeam', { opportunityId, milestoneId }, () => this.msx.leaveMilestoneTeam(opportunityId, milestoneId))
  }

  listMilestones(opportunityId: string): Promise<Milestone[]> {
    return this.msx.listMilestones(opportunityId)
  }

  listDiscoverableMilestones(opportunityId: string): Promise<Milestone[]> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to list discoverable milestones.')
    }
    return this.msx.listDiscoverableMilestones(opportunityId)
  }

  listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to list milestone activities.')
    }
    if (typeof milestoneId !== 'string' || milestoneId.trim().length === 0) {
      throw new Error('A milestone id is required to list milestone activities.')
    }
    return this.msx.listMilestoneActivities(opportunityId, milestoneId)
  }

  createMilestoneActivity(opportunityId: string, milestoneId: string, request: CreateMilestoneActivityRequest): Promise<MilestoneActivity> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to create a milestone activity.')
    }
    if (typeof milestoneId !== 'string' || milestoneId.trim().length === 0) {
      throw new Error('A milestone id is required to create a milestone activity.')
    }
    return this.acknowledged('createMilestoneActivity', { opportunityId, milestoneId, request }, () => this.msx.createMilestoneActivity(opportunityId, milestoneId, createMilestoneActivityRequestSchema.parse(request)))
  }

  updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone> {
    return this.acknowledged('updateMilestone', { opportunityId, milestoneId, update }, () => this.msx.updateMilestone(opportunityId, milestoneId, update))
  }

  updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity> {
    return this.acknowledged('updateOpportunity', { opportunityId, update }, () => this.msx.updateOpportunity(opportunityId, update))
  }

  async transitionOpportunityStage(input: McemStageTransitionRequest): Promise<McemStageTransitionResult> {
    const request = mcemStageTransitionRequestSchema.parse(input)
    const context = await this.msx.getOpportunityContext(request.opportunityId)
    if (context.account.id !== request.accountId) {
      throw new Error('The selected opportunity does not belong to the selected account.')
    }
    const previousStage = context.opportunity.recordedStage
    if (Math.abs(request.targetStage - previousStage) !== 1) {
      throw new Error('MCEM stage changes must move to an adjacent stage.')
    }

    const guidance = await this.mcem.getStageGuidance(previousStage)
    const evaluation = evaluateMcemProgress(context, guidance)
    const unmetCriteria = evaluation.criteria.filter((criterion) => criterion.status !== 'met')
    const advancing = request.targetStage > previousStage
    const requiresReason = !advancing || unmetCriteria.length > 0
    if (requiresReason && !request.reason) {
      throw new Error(advancing
        ? 'An exception reason is required because the current-stage exit criteria are incomplete.'
        : 'A recycle reason is required when moving an opportunity to a previous stage.')
    }

    const disposition = advancing ? unmetCriteria.length === 0 ? 'advanced' : 'override' : 'recycled'
    const timestamp = new Date().toISOString()
    const detail = unmetCriteria.length > 0
      ? ` Unmet criteria: ${unmetCriteria.map((criterion) => `${criterion.label} (${criterion.status})`).join('; ')}.`
      : ''
    const auditNote = `[MCEM stage transition ${timestamp}] Stage ${previousStage} -> Stage ${request.targetStage}; disposition: ${disposition}.${detail}${request.reason ? ` Reason: ${request.reason}` : ''}`
    const opportunity = await this.msx.updateOpportunityStage(request.opportunityId, request.targetStage, auditNote)
    const result = mcemStageTransitionResultSchema.parse({ opportunity, previousStage, targetStage: request.targetStage, disposition, auditNote })
    this.notifyMutation('transitionOpportunityStage', result, request)
    return result
  }

  async runMcemCoach(input: McemRequest): Promise<McemResponse> {
    const request = mcemRequestSchema.parse(input)
    return this.withFreshReadContext(async () => {
      const context = await this.msx.getOpportunityContext(request.opportunityId)
      if (context.account.id !== request.accountId) {
        throw new Error('The selected opportunity does not belong to the selected account.')
      }
      const [milestones, guidance] = await Promise.all([
        this.msx.listMilestones(request.opportunityId),
        this.mcem.getStageGuidance(context.opportunity.recordedStage)
      ])
      const localEvaluation = evaluateMcemProgress({ ...context, milestones }, guidance)
      return localEvaluation
    })
  }

  private async prepareAgentTask(request: AgentTaskRequest): Promise<{ configuredAgent: ConfiguredTaskAgent; context: AgentTaskContext }> {
    const configuredAgent = this.taskAgents[request.capability]
    if (!configuredAgent) {
      throw new Error(`The ${request.capability} agent is not configured.`)
    }

    const baseContext = await measurePerformance('agent.context.msx', this.performanceReporter, () =>
      this.msx.getOpportunityContext(request.opportunityId))
    if (baseContext.account.id !== request.accountId) {
      throw new Error('The selected opportunity does not belong to the selected account.')
    }
    const recordedStage = baseContext.opportunity.recordedStage
    const milestoneRead = measurePerformance('agent.context.milestones', this.performanceReporter, () =>
      this.msx.listMilestones(request.opportunityId))
    const [milestones, guidance, nextStageGuidance, evidenceRead] = await Promise.all([
      milestoneRead,
      measurePerformance('agent.context.mcem', this.performanceReporter, () =>
        this.mcem.getStageGuidance(recordedStage)),
      recordedStage < 5
        ? this.mcem.getStageGuidance(recordedStage + 1).catch(() => undefined)
        : Promise.resolve(undefined),
      measurePerformance('agent.context.evidence', this.performanceReporter, () =>
        collectOpportunityEvidence(this.msx, baseContext, milestoneRead))
    ])
    const opportunityContext = { ...baseContext, milestones }
    const localEvaluation = evaluateMcemProgress(opportunityContext, guidance)
    const evidence = buildAgentEvidencePack({ context: opportunityContext, milestones, evidence: evidenceRead })
    return {
      configuredAgent,
      context: { request, opportunityContext, guidance, ...(nextStageGuidance ? { nextStageGuidance } : {}), localEvaluation, evidence }
    }
  }

  private buildAgentResponse(
    request: AgentTaskRequest,
    configuredAgent: ConfiguredTaskAgent,
    context: AgentTaskContext,
    content: string,
    fallback?: string
  ): AgentTaskResponse {
    const { opportunityContext } = context
    const sourceHealth = agentSourceHealth(context)
    const isPartial = fallback !== undefined || sourceHealth.some((source) => ['partial', 'stale', 'unavailable'].includes(source.state))
    const responseContent = addMsxOpportunityLink(content.trim(), opportunityContext.opportunity.id)
    return {
      contractVersion,
      correlationId: randomUUID(),
      capability: request.capability,
      agentVersion: fallback === undefined ? configuredAgent.version : `${configuredAgent.version}+${fallback}`,
      generatedAt: new Date().toISOString(),
      mode: opportunityContext.sourceHealth.state === 'sample' ? 'sample' : 'live',
      state: isPartial ? 'partial' : 'complete',
      content: responseContent,
      sourceHealth
    }
  }

  async runAgentTask(input: AgentTaskRequest): Promise<AgentTaskResponse> {
    const request = agentTaskRequestSchema.parse(input)
    return measurePerformance(`agent.task.${request.capability}`, this.performanceReporter, () => this.withFreshReadContext(async () => {
      const { configuredAgent, context } = await this.prepareAgentTask(request)
      const content = await measurePerformance(`agent.invoke.${request.capability}`, this.performanceReporter, () => configuredAgent.agent.invoke(context))
      if (!content?.trim()) {
        throw new Error(`The ${request.capability} agent returned no content.`)
      }
      return this.buildAgentResponse(request, configuredAgent, context, content)
    }))
  }

  /**
   * Progressive variant of `runAgentTask`. Emits an instant deterministic draft as soon as evidence is
   * loaded, then model text as it streams, then the authoritative response. A model failure falls back to
   * the labelled deterministic draft; cancellation and context failures emit a terminal `error` event.
   * Never throws: every outcome is delivered through `onEvent`.
   */
  async runAgentTaskStream(input: AgentTaskRequest, onEvent: (event: AgentTaskStreamEvent) => void, signal?: AbortSignal): Promise<void> {
    const request = agentTaskRequestSchema.parse(input)
    const emit = (event: AgentTaskStreamEvent) => {
      try { onEvent(event) } catch { /* a closed consumer must not break the run */ }
    }
    const fail = (error: unknown) => {
      const cancelled = signal?.aborted === true
      emit({
        type: 'error',
        code: cancelled ? 'cancelled' : 'failed',
        message: cancelled ? 'The request was cancelled.' : errorMessage(error)
      })
    }
    try {
      await measurePerformance(`agent.task.${request.capability}`, this.performanceReporter, () => this.withFreshReadContext(async () => {
        const { configuredAgent, context } = await this.prepareAgentTask(request)
        signal?.throwIfAborted()
        const instantDraft = formatLiveAgentGuidance(request.capability, context)
        emit({
          type: 'context', streamVersion: agentTaskStreamVersion, capability: request.capability, instantDraft,
          sourceHealth: agentSourceHealth(context)
        })
        let content: string
        let fallback: string | undefined
        try {
          content = await measurePerformance(`agent.invoke.${request.capability}`, this.performanceReporter, async () => {
            const streamed = configuredAgent.agent.stream
              ? await configuredAgent.agent.stream(context, { signal, onDelta: (text) => emit({ type: 'delta', text }) })
              : await configuredAgent.agent.invoke(context)
            if (!streamed?.trim()) throw new Error(`The ${request.capability} agent returned no content.`)
            return streamed
          })
        } catch (error) {
          if (signal?.aborted) throw error
          content = `${instantDraft}\n\n> AI enhancement is unavailable (${errorMessage(error)}). This is the evidence-based draft from the local MCEM evaluation.`
          fallback = 'local-fallback'
        }
        emit({ type: 'complete', response: this.buildAgentResponse(request, configuredAgent, context, content, fallback) })
      }, signal))
    } catch (error) {
      fail(error)
    }
  }
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return (text.trim() || 'The agent request failed.').slice(0, 400)
}

export { addMsxOpportunityLink }
export * from './agent-evidence.js'
export * from './policies/mcp-tool-authorization.js'
export * from './prewarm.js'
export * from './progress/index.js'
export * from './routing/mcp-tool-broker.js'
export * from './workflows/index.js'