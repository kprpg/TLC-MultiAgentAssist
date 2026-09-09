import { randomUUID } from 'node:crypto'
import {
  addMsxOpportunityLink,
  agentTaskRequestSchema,
  contractVersion,
  mcemStageTransitionRequestSchema,
  mcemStageTransitionResultSchema,
  mcemRequestSchema,
  type Account,
  type AgentCapability,
  type AgentTaskRequest,
  type AgentTaskResponse,
  type McemRequest,
  type McemResponse,
  type McemStageTransitionRequest,
  type McemStageTransitionResult,
  type Milestone,
  type MilestoneUpdate,
  type Opportunity,
  type OpportunityUpdate,
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

  listAccounts(): Promise<Account[]> {
    return this.msx.listAccounts()
  }

  listOpportunities(accountId: string): Promise<Opportunity[]> {
    return this.msx.listOpportunities(accountId)
  }

  listMilestones(opportunityId: string): Promise<Milestone[]> {
    return this.msx.listMilestones(opportunityId)
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
    const guidance = await this.mcem.getStageGuidance(context.opportunity.recordedStage)
    const localEvaluation = evaluateMcemProgress(context, guidance)
    return localEvaluation
  }

  async runAgentTask(input: AgentTaskRequest): Promise<AgentTaskResponse> {
    const request = agentTaskRequestSchema.parse(input)
    const configuredAgent = this.taskAgents[request.capability]
    if (!configuredAgent) {
      throw new Error(`The ${request.capability} agent is not configured.`)
    }

    const opportunityContext = await measurePerformance('agent.context.msx', this.performanceReporter, () =>
      this.msx.getOpportunityContext(request.opportunityId))
    if (opportunityContext.account.id !== request.accountId) {
      throw new Error('The selected opportunity does not belong to the selected account.')
    }
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