import type { Account, Milestone, MilestoneUpdate, Opportunity, OpportunityUpdate, SourceHealth } from '../../common/index.js'

export interface CriterionObservation {
  criterionId: string
  status: 'met' | 'partial' | 'missing'
  detail: string
}

export interface OpportunityContext {
  account: Account
  opportunity: Opportunity
  observations: CriterionObservation[]
  retrievedAt: string
  sourceHealth: SourceHealth
}

export interface StageCriterion {
  id: string
  label: string
  ownerRole: string
  actionWhenMissing: string
  rationale: string
}

export interface StageGuidance {
  stage: number
  title: string
  version: string
  effectiveDate: string
  sourceUrl?: string
  criteria: StageCriterion[]
  sourceHealth: SourceHealth
}

export interface MsxConnector {
  listAccounts(): Promise<Account[]>
  listOpportunities(accountId: string): Promise<Opportunity[]>
  listMilestones(opportunityId: string): Promise<Milestone[]>
  updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone>
  updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity>
  getOpportunityContext(opportunityId: string): Promise<OpportunityContext>
}

export interface McemGuidanceConnector {
  getStageGuidance(stage: number): Promise<StageGuidance>
}