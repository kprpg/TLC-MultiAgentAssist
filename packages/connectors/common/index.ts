import type { Account, DealTeamJoinResult, DiscoverableOpportunity, Milestone, MilestoneUpdate, Opportunity, OpportunityUpdate, SeDomainId, SourceHealth } from '../../common/index.js'

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
  updateOpportunityStage(opportunityId: string, targetStage: number, auditNote: string): Promise<Opportunity>
  getOpportunityContext(opportunityId: string): Promise<OpportunityContext>
  /**
   * Discovers non-closed, non-completed MSX opportunities matching a Solution
   * Engineer domain, flagging any the signed-in user is already on the deal
   * team for.
   */
  discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]>
  /** Adds the signed-in user to an opportunity's deal team. */
  joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult>
}

export interface McemGuidanceConnector {
  getStageGuidance(stage: number): Promise<StageGuidance>
}