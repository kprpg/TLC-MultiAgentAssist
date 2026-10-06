import { randomUUID } from 'node:crypto'
import {
  addMsxOpportunityLink,
  accountListOptionsSchema,
  accountSearchRequestSchema,
  accountVisibilitySchema,
  agentTaskRequestSchema,
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
  type PerformanceReporter
} from '../common/index.js'
import { evaluateMcemProgress } from '../agents/mcem-coach/index.js'
import type {
  McemGuidanceConnector,
  MsxConnector,
  OpportunityContext,
  StageGuidance
} from '../connectors/common/index.js'

export interface McemAgentContext {
  request: McemRequest
  opportunityContext: OpportunityContext
  guidance: StageGuidance
  localEvaluation: McemResponse
}

export interface AgentInvoker<TContext> {
  invoke(context: TContext): Promise<string | void>
}

export type McemAgent = AgentInvoker<McemAgentContext>

export interface AgentTaskContext {
  request: AgentTaskRequest
  opportunityContext: OpportunityContext
  guidance: StageGuidance
  localEvaluation: McemResponse
}

export interface ConfiguredTaskAgent {
  version: string
  agent: AgentInvoker<AgentTaskContext>
}

export type TaskAgentRegistry = Partial<Record<AgentCapability, ConfiguredTaskAgent>>

export class ThinSliceOrchestrator {
  constructor(
    private readonly msx: MsxConnector,
    private readonly mcem: McemGuidanceConnector,
    private readonly taskAgents: TaskAgentRegistry = {},
    private readonly performanceReporter?: PerformanceReporter
  ) { }

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
    return this.msx.addAccount(accountId)
  }

  async setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account> {
    if (typeof accountId !== 'string' || accountId.trim().length === 0) {
      throw new Error('An account id is required.')
    }
    return this.msx.setAccountVisibility(accountId, accountVisibilitySchema.parse(visibility))
  }

  listOpportunities(accountId: string): Promise<Opportunity[]> {
    return this.msx.listOpportunities(accountId)
  }

  async discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]> {
    return this.msx.discoverOpportunities(seDomainSchema.parse(domain))
  }

  async joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to join a deal team.')
    }
    return this.msx.joinDealTeam(opportunityId)
  }

  async leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to leave a deal team.')
    }
    return this.msx.leaveDealTeam(opportunityId)
  }

  async joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to join a milestone team.')
    }
    if (typeof milestoneId !== 'string' || milestoneId.trim().length === 0) {
      throw new Error('A milestone id is required to join a milestone team.')
    }
    return this.msx.joinMilestoneTeam(opportunityId, milestoneId)
  }

  async leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult> {
    if (typeof opportunityId !== 'string' || opportunityId.trim().length === 0) {
      throw new Error('An opportunity id is required to leave a milestone team.')
    }
    if (typeof milestoneId !== 'string' || milestoneId.trim().length === 0) {
      throw new Error('A milestone id is required to leave a milestone team.')
    }
    return this.msx.leaveMilestoneTeam(opportunityId, milestoneId)
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
    return this.msx.createMilestoneActivity(opportunityId, milestoneId, createMilestoneActivityRequestSchema.parse(request))
  }

  updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone> {
    return this.msx.updateMilestone(opportunityId, milestoneId, update)
  }

  updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity> {
    return this.msx.updateOpportunity(opportunityId, update)
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
    return mcemStageTransitionResultSchema.parse({ opportunity, previousStage, targetStage: request.targetStage, disposition, auditNote })
  }

  async runMcemCoach(input: McemRequest): Promise<McemResponse> {
    const request = mcemRequestSchema.parse(input)
    const context = await this.msx.getOpportunityContext(request.opportunityId)
    if (context.account.id !== request.accountId) {
      throw new Error('The selected opportunity does not belong to the selected account.')
    }
    const milestones = await this.msx.listMilestones(request.opportunityId)
    const guidance = await this.mcem.getStageGuidance(context.opportunity.recordedStage)
    const localEvaluation = evaluateMcemProgress({ ...context, milestones }, guidance)
    return localEvaluation
  }

  async runAgentTask(input: AgentTaskRequest): Promise<AgentTaskResponse> {
    const request = agentTaskRequestSchema.parse(input)
    const configuredAgent = this.taskAgents[request.capability]
    if (!configuredAgent) {
      throw new Error(`The ${request.capability} agent is not configured.`)
    }

    const baseContext = await measurePerformance('agent.context.msx', this.performanceReporter, () =>
      this.msx.getOpportunityContext(request.opportunityId))
    if (baseContext.account.id !== request.accountId) {
      throw new Error('The selected opportunity does not belong to the selected account.')
    }
    const milestones = await this.msx.listMilestones(request.opportunityId)
    const opportunityContext = { ...baseContext, milestones }
    const guidance = await measurePerformance('agent.context.mcem', this.performanceReporter, () =>
      this.mcem.getStageGuidance(opportunityContext.opportunity.recordedStage))
    const localEvaluation = evaluateMcemProgress(opportunityContext, guidance)
    const content = await measurePerformance(`agent.invoke.${request.capability}`, this.performanceReporter, () => configuredAgent.agent.invoke({
      request,
      opportunityContext,
      guidance,
      localEvaluation
    }))
    if (!content?.trim()) {
      throw new Error(`The ${request.capability} agent returned no content.`)
    }

    const sourceHealth = [opportunityContext.sourceHealth, guidance.sourceHealth]
    const isPartial = sourceHealth.some((source) => ['partial', 'stale', 'unavailable'].includes(source.state))
    const responseContent = addMsxOpportunityLink(content.trim(), opportunityContext.opportunity.id)
    return {
      contractVersion,
      correlationId: randomUUID(),
      capability: request.capability,
      agentVersion: configuredAgent.version,
      generatedAt: new Date().toISOString(),
      mode: opportunityContext.sourceHealth.state === 'sample' ? 'sample' : 'live',
      state: isPartial ? 'partial' : 'complete',
      content: responseContent,
      sourceHealth
    }
  }
}

export { addMsxOpportunityLink }
export * from './policies/mcp-tool-authorization.js'
export * from './progress/index.js'
export * from './routing/mcp-tool-broker.js'
export * from './workflows/index.js'