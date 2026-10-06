import type { Account, AccountCandidate, AccountListOptions, AccountSearchRequest, AccountVisibility, CreateMilestoneActivityRequest, DealTeamJoinResult, DealTeamLeaveResult, DiscoverableOpportunity, Milestone, MilestoneActivity, MilestoneTeamJoinResult, MilestoneTeamLeaveResult, MilestoneUpdate, Opportunity, OpportunityUpdate, SeDomainId, SourceHealth } from '../../common/index.js'

export * from './portfolio-preferences.js'
export * from './milestone-membership.js'

export interface CriterionObservation {
  criterionId: string
  status: 'met' | 'partial' | 'missing'
  detail: string
}

export interface OpportunityContext {
  account: Account
  opportunity: Opportunity
  observations: CriterionObservation[]
  /** The opportunity's milestones, used to ground stage recommendations. */
  milestones?: Milestone[]
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
  listAccounts(options?: AccountListOptions): Promise<Account[]>
  searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]>
  addAccount(accountId: string): Promise<Account>
  setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account>
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
  /** Removes only the signed-in user's active membership for an opportunity. */
  leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult>
  /**
   * Adds the signed-in user to a milestone's team. Independent of opportunity Deal
   * Team membership: a user can be on a milestone team without being on the opportunity
   * Deal Team, and vice versa.
   */
  joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult>
  /** Removes only the signed-in user from a milestone's team. */
  leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult>
  /**
   * Lists the milestones of a discoverable opportunity (one in the user's visible account
   * scope) without requiring Deal Team / portfolio membership, so a user can join a
   * milestone team for an opportunity they have never been on. Each milestone carries the
   * user's current `onMilestoneTeam` state.
   */
  listDiscoverableMilestones(opportunityId: string): Promise<Milestone[]>
  /** Lists the Activities (Tasks) associated with a milestone via `regardingobjectid`. */
  listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]>
  /** Creates a Task regarding a milestone; the owner defaults to the signed-in user. */
  createMilestoneActivity(opportunityId: string, milestoneId: string, request: CreateMilestoneActivityRequest): Promise<MilestoneActivity>
}

export interface McemGuidanceConnector {
  getStageGuidance(stage: number): Promise<StageGuidance>
}