import type { Account, AccountCandidate, AccountListOptions, AccountSearchRequest, AccountVisibility, CreateMilestoneActivityRequest, DealTeamJoinResult, DealTeamLeaveResult, DiscoverableOpportunity, Milestone, MilestoneActivity, MilestoneTeamJoinResult, MilestoneTeamLeaveResult, MilestoneUpdate, Opportunity, OpportunityUpdate, SeDomainId, SourceHealth } from '../../common/index.js'

export * from './portfolio-preferences.js'
export * from './milestone-membership.js'
export * from './record-creation.js'
export * from './knowledge.js'

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

/** One piece of free-text evidence (comment, note, activity) attached to an opportunity or milestone. Content is untrusted. */
export interface EvidenceEntry {
  kind: 'forecast-comment' | 'note' | 'activity'
  text: string
  subject?: string
  author?: string
  /** ISO timestamp when the entry was written or last modified. */
  at?: string
  status?: string
  due?: string
}

export interface OpportunityEvidenceDetails {
  opportunityNumber?: string
  /** Customer need statement (the Dataverse `description` field, separate from forecast comments). */
  need?: string
  solutionArea?: string
  technicalCapability?: string
  conversation?: string
  createdOn?: string
  modifiedOn?: string
  dealTeam?: string[]
}

export interface MilestoneEvidence {
  milestoneId: string
  commentHistory: EvidenceEntry[]
  activities: EvidenceEntry[]
}

/**
 * Deep, read-only evidence for one opportunity that the standard portfolio reads do not carry:
 * comment history, notes, activities (including every milestone's tasks), and record details.
 * Each sub-read is independent; anything that could not be read is named in `gaps`.
 */
export interface OpportunityEvidence {
  details: OpportunityEvidenceDetails
  commentHistory: EvidenceEntry[]
  notes: EvidenceEntry[]
  activities: EvidenceEntry[]
  milestones: MilestoneEvidence[]
  gaps: string[]
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
  refresh?(): void
  withReadContext?<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>
  withFreshReadContext?<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>
  getConcurrencyTokens?(opportunityId: string): Promise<Record<string, string>>
  conditionalWriteOperations?(): Promise<ReadonlyArray<'updateOpportunity' | 'updateMilestone' | 'transitionOpportunityStage'>>
  withExpectedVersions?<T>(versions: Readonly<Record<string, string>>, operation: () => Promise<T>, verifyAccessToken?: (token: string) => void, onDispatch?: () => void): Promise<T>
  listAccounts(options?: AccountListOptions): Promise<Account[]>
  getPortfolioIndex?(options?: AccountListOptions): Promise<{ accounts: Account[]; opportunities: Opportunity[] }>
  getDiscoverySnapshot?(): Promise<{
    accounts: Account[]
    portfolioOpportunities: Opportunity[]
    opportunities: DiscoverableOpportunity[]
    milestoneTeamOpportunityIds: string[]
  }>
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
   * Optional deep read used to ground agent responses. Connectors without it are enriched by the
   * orchestrator from the standard opportunity, milestone, and milestone-activity reads.
   */
  getOpportunityEvidence?(opportunityId: string): Promise<OpportunityEvidence>
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