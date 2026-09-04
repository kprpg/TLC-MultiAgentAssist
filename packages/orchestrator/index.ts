import { randomUUID } from 'node:crypto'
import {
  agentTaskRequestSchema,
  contractVersion,
  mcemRequestSchema,
  type Account,
  type AgentCapability,
  type AgentTaskRequest,
  type AgentTaskResponse,
  type McemRequest,
  type McemResponse,
  type Opportunity,
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
  ) {}

  listAccounts(): Promise<Account[]> {
    return this.msx.listAccounts()
  }

  listOpportunities(accountId: string): Promise<Opportunity[]> {
    return this.msx.listOpportunities(accountId)
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

export function addMsxOpportunityLink(content: string, opportunityId: string): string {
  if (/microsoftsales\.crm\.dynamics\.com\/main\.aspx[^\s)]*\bopportunity\b/i.test(content)) return content

  const opportunityUrl = new URL('https://microsoftsales.crm.dynamics.com/main.aspx')
  opportunityUrl.searchParams.set('pagetype', 'entityrecord')
  opportunityUrl.searchParams.set('etn', 'opportunity')
  opportunityUrl.searchParams.set('id', opportunityId)
  const link = `**MSX Opportunity:** [Open opportunity in MSX](${opportunityUrl.toString()})`
  const lines = content.split('\n')
  const accountLine = lines.findIndex((line) => /^\s*\*\*Account:\*\*/i.test(line))
  const headingLine = lines.findIndex((line) => /^\s*#{1,6}\s+/.test(line))
  const insertionIndex = accountLine >= 0
    ? accountLine + 1
    : headingLine >= 0 ? headingLine + 1 : 0
  lines.splice(insertionIndex, 0, link)
  return lines.join('\n')
}