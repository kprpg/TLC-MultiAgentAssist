import {
  accountSearchRequestSchema,
  createMilestoneActivityRequestSchema,
  type Account,
  type AccountCandidate,
  type AccountListOptions,
  type AccountSearchRequest,
  type AccountVisibility,
  type CreateMilestoneActivityRequest,
  type DealTeamJoinResult,
  type DealTeamLeaveResult,
  type DiscoverableOpportunity,
  type Milestone,
  type MilestoneActivity,
  type MilestoneTeamJoinResult,
  type MilestoneTeamLeaveResult,
  type MilestoneUpdate,
  type Opportunity,
  type OpportunityUpdate,
  type SeDomainId
} from '../../common/index.js'
import type { MsxConnector, OpportunityContext } from '../common/index.js'

export {
  LiveMsxConnector,
  MsxRequestError,
  msxWriteMetadataFromEnvironment,
  type MsxAccessTokenProvider,
  type MsxWriteMetadata
} from './live.js'
export { LiveMeetingCaptureConnector, type MeetingExtractorFn as LiveMeetingExtractorFn } from './live-meeting.js'

const accounts: Account[] = [
  { id: 'account-contoso', name: 'Contoso Energy', segment: 'Strategic', tpid: '1000001' },
  { id: 'account-fabrikam', name: 'Fabrikam Retail', segment: 'Enterprise', tpid: '1000002' },
  { id: 'account-northwind', name: 'Northwind Health', segment: 'Enterprise', tpid: '1000003' },
  { id: 'account-zava', name: 'Zava Inc.', segment: 'Strategic', tpid: '1000004' },
  { id: 'account-adventureworks', name: 'Adventure Works Cycles', segment: 'Enterprise', tpid: '1000005' }
]

const opportunities: Opportunity[] = [
  {
    id: 'opp-grid-modernization',
    accountId: 'account-contoso',
    name: 'Grid operations modernization',
    owner: 'Avery Johnson',
    recordedStage: 3,
    value: 4200000,
    currency: 'USD',
    closeDate: '2026-10-30'
  },
  {
    id: 'opp-ai-service',
    accountId: 'account-fabrikam',
    name: 'AI-assisted customer service',
    recordedStage: 2,
    value: 1750000,
    currency: 'USD',
    closeDate: '2026-12-18'
  },
  {
    id: 'opp-cloud-security-readiness',
    accountId: 'account-contoso',
    name: 'Cloud security readiness',
    recordedStage: 1,
    value: 900000,
    currency: 'USD',
    closeDate: '2027-02-26'
  },
  {
    id: 'opp-data-estate-consolidation',
    accountId: 'account-contoso',
    name: 'Data estate consolidation',
    recordedStage: 2,
    value: 2650000,
    currency: 'USD',
    closeDate: '2027-01-29'
  },
  {
    id: 'opp-ai-factory-rollout',
    accountId: 'account-contoso',
    name: 'AI factory rollout',
    recordedStage: 4,
    value: 6100000,
    currency: 'USD',
    closeDate: '2026-11-20'
  },
  {
    id: 'opp-store-modernization',
    accountId: 'account-fabrikam',
    name: 'Connected store modernization',
    recordedStage: 1,
    value: 1200000,
    currency: 'USD',
    closeDate: '2027-03-19'
  },
  {
    id: 'opp-unified-commerce',
    accountId: 'account-fabrikam',
    name: 'Unified commerce platform',
    recordedStage: 3,
    value: 3800000,
    currency: 'USD',
    closeDate: '2026-12-11'
  },
  {
    id: 'opp-copilot-expansion',
    accountId: 'account-fabrikam',
    name: 'Store associate Copilot expansion',
    recordedStage: 4,
    value: 2400000,
    currency: 'USD',
    closeDate: '2026-10-23'
  },
  {
    id: 'opp-resilient-cloud-foundation',
    accountId: 'account-contoso',
    name: 'Resilient cloud foundation - ready to advance',
    recordedStage: 1,
    value: 1450000,
    currency: 'USD',
    closeDate: '2027-03-12'
  },
  {
    id: 'opp-predictive-maintenance-scale',
    accountId: 'account-contoso',
    name: 'Predictive maintenance scale-out - ready to advance',
    recordedStage: 3,
    value: 4750000,
    currency: 'USD',
    closeDate: '2026-12-04'
  },
  {
    id: 'opp-customer-data-platform',
    accountId: 'account-fabrikam',
    name: 'Customer data platform - ready to advance',
    recordedStage: 2,
    value: 3200000,
    currency: 'USD',
    closeDate: '2027-01-15'
  },
  {
    id: 'opp-ai-store-operations',
    accountId: 'account-fabrikam',
    name: 'AI store operations deployment - ready to advance',
    recordedStage: 4,
    value: 5250000,
    currency: 'USD',
    closeDate: '2026-11-13'
  },
  {
    id: 'opp-zava-ai-platform',
    accountId: 'account-zava',
    name: 'Zava AI platform foundation',
    owner: 'Avery Johnson',
    recordedStage: 2,
    value: 2900000,
    currency: 'USD',
    closeDate: '2027-04-02'
  },
  {
    id: 'opp-zava-migration',
    accountId: 'account-zava',
    name: 'Zava datacenter exit',
    recordedStage: 1,
    value: 1600000,
    currency: 'USD',
    closeDate: '2027-05-28'
  },
  {
    id: 'opp-aw-commerce',
    accountId: 'account-adventureworks',
    name: 'Adventure Works commerce replatform',
    owner: 'Morgan Diaz',
    recordedStage: 3,
    value: 3100000,
    currency: 'USD',
    closeDate: '2027-01-08'
  }
]

const milestonesByOpportunity: Record<string, Milestone[]> = Object.fromEntries(opportunities.map((opportunity) => [
  opportunity.id,
  [{
    id: `${opportunity.id}-milestone`,
    opportunityId: opportunity.id,
    name: 'Customer outcome validation',
    status: 'In progress',
    targetDate: opportunity.closeDate,
    owner: 'Account team',
    commitment: 'Best case'
  }]
]))

const observationsByOpportunity: Record<string, OpportunityContext['observations']> = {
  'opp-grid-modernization': [
    { criterionId: 'customer-outcome', status: 'partial', detail: 'Reliability improvement is named but has no baseline or target.' },
    { criterionId: 'decision-team', status: 'missing', detail: 'Economic buyer and procurement path are not recorded.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'Architecture workshop completed with the customer platform team.' },
    { criterionId: 'business-case', status: 'missing', detail: 'No quantified value hypothesis is attached to the opportunity.' },
    { criterionId: 'next-step', status: 'partial', detail: 'A workshop is proposed without a confirmed customer date.' }
  ],
  'opp-ai-service': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'Target is a 15% reduction in average handling time.' },
    { criterionId: 'decision-team', status: 'partial', detail: 'Business sponsor is known; security stakeholder is not confirmed.' },
    { criterionId: 'technical-validation', status: 'missing', detail: 'No technical discovery artifact is recorded.' },
    { criterionId: 'business-case', status: 'partial', detail: 'Value hypothesis exists but has not been validated by finance.' },
    { criterionId: 'next-step', status: 'met', detail: 'Discovery workshop is confirmed for September 3.' }
  ],
  'opp-cloud-security-readiness': [
    { criterionId: 'budget', status: 'met', detail: 'The security program has approved discovery funding for the current fiscal year.' },
    { criterionId: 'customer-outcome', status: 'partial', detail: 'Reducing critical cloud findings is the stated outcome, but the baseline and target are not recorded.' },
    { criterionId: 'approval', status: 'missing', detail: 'The executive sponsor and security approval path have not been confirmed.' },
    { criterionId: 'timing', status: 'met', detail: 'The customer must select a remediation approach before its February audit window.' }
  ],
  'opp-data-estate-consolidation': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer targets a 25% reduction in data-platform operating cost.' },
    { criterionId: 'decision-team', status: 'partial', detail: 'The data and infrastructure leads are engaged; the economic buyer is not confirmed.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'Discovery documented the current estate, migration constraints, and candidate landing zones.' },
    { criterionId: 'business-case', status: 'partial', detail: 'A cost model exists but excludes migration and change-management costs.' },
    { criterionId: 'next-step', status: 'met', detail: 'A design review is scheduled with named customer and Microsoft owners.' }
  ],
  'opp-ai-factory-rollout': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'Three production use cases have agreed adoption and cycle-time targets.' },
    { criterionId: 'decision-team', status: 'met', detail: 'The executive sponsor, AI council, security approver, procurement lead, and delivery team are engaged.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'The pilot met its quality, safety, latency, and integration acceptance criteria.' },
    { criterionId: 'business-case', status: 'met', detail: 'Finance validated the investment case and phased funding envelope.' },
    { criterionId: 'next-step', status: 'partial', detail: 'The rollout plan is approved, but the first production deployment date has not been committed.' }
  ],
  'opp-store-modernization': [
    { criterionId: 'budget', status: 'partial', detail: 'Innovation funding is available for a pilot, but rollout funding has not been identified.' },
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer wants to reduce checkout abandonment by 10% and improve inventory accuracy.' },
    { criterionId: 'approval', status: 'met', detail: 'The retail operations sponsor and technology decision makers are identified.' },
    { criterionId: 'timing', status: 'missing', detail: 'No decision date, purchase window, or compelling event is recorded.' }
  ],
  'opp-unified-commerce': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The program has measurable revenue, conversion, and order-fulfillment outcomes.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Commerce, finance, security, procurement, and executive stakeholders are mapped.' },
    { criterionId: 'technical-validation', status: 'partial', detail: 'Core integration patterns are validated; peak-volume testing remains open.' },
    { criterionId: 'business-case', status: 'met', detail: 'The customer approved a quantified business case and funding range.' },
    { criterionId: 'next-step', status: 'partial', detail: 'A validation workshop is planned, but customer attendees are not final.' }
  ],
  'opp-copilot-expansion': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The expansion targets a 20% reduction in associate task time across 300 stores.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Retail operations, HR, security, finance, and deployment owners approved the expansion path.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'The production pilot met groundedness, adoption, and support acceptance criteria.' },
    { criterionId: 'business-case', status: 'partial', detail: 'Benefits are validated, but the support-cost assumption needs finance confirmation.' },
    { criterionId: 'next-step', status: 'met', detail: 'Wave-one deployment has named owners and a committed October start date.' }
  ],
  'opp-resilient-cloud-foundation': [
    { criterionId: 'budget', status: 'met', detail: 'The customer has confirmed funding for discovery, design, and initial implementation.' },
    { criterionId: 'customer-outcome', status: 'met', detail: 'Recovery-time, availability, and operational-efficiency targets have agreed baselines and owners.' },
    { criterionId: 'approval', status: 'met', detail: 'The executive sponsor, economic buyer, architecture authority, and procurement path are confirmed.' },
    { criterionId: 'timing', status: 'met', detail: 'The customer has committed to a November decision ahead of its data-center renewal event.' }
  ],
  'opp-predictive-maintenance-scale': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer approved targets for unplanned downtime, maintenance cost, and asset availability.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Operations, finance, security, procurement, and executive stakeholders are aligned.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'The pilot met model-quality, integration, security, and field-operations acceptance criteria.' },
    { criterionId: 'business-case', status: 'met', detail: 'Finance validated the scale-out business case using measured pilot outcomes.' },
    { criterionId: 'next-step', status: 'met', detail: 'A customer-approved deployment decision meeting has named attendees, owners, and a committed date.' }
  ],
  'opp-customer-data-platform': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer agreed measurable conversion, campaign-cycle, and data-quality outcomes.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Marketing, data, privacy, security, finance, and procurement decision makers are engaged.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'Discovery confirmed source systems, identity resolution, consent, and integration requirements.' },
    { criterionId: 'business-case', status: 'met', detail: 'The expected return and implementation budget are documented and customer validated.' },
    { criterionId: 'next-step', status: 'met', detail: 'The solution-design workshop is confirmed with customer and Microsoft owners.' }
  ],
  'opp-ai-store-operations': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer approved labor-efficiency, task-completion, and associate-adoption targets.' },
    { criterionId: 'decision-team', status: 'met', detail: 'Retail operations, HR, security, finance, legal, and deployment owners approved the path.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'The production pilot met quality, safety, accessibility, support, and integration criteria.' },
    { criterionId: 'business-case', status: 'met', detail: 'Finance approved the deployment business case and full rollout funding.' },
    { criterionId: 'next-step', status: 'met', detail: 'The first deployment wave has a customer-approved date, scope, and accountable owners.' }
  ],
  'opp-zava-ai-platform': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer agreed targets for model-deployment velocity and governed AI adoption.' },
    { criterionId: 'decision-team', status: 'partial', detail: 'The platform sponsor is engaged, but procurement and security owners are not yet confirmed.' },
    { criterionId: 'technical-validation', status: 'partial', detail: 'A reference architecture is drafted; a customer validation workshop is not yet booked.' },
    { criterionId: 'business-case', status: 'partial', detail: 'A value hypothesis exists without an approved quantified business case.' },
    { criterionId: 'next-step', status: 'met', detail: 'A foundation design review is scheduled with named owners.' }
  ],
  'opp-zava-migration': [
    { criterionId: 'customer-outcome', status: 'partial', detail: 'Datacenter exit is the stated goal, but cost and timeline baselines are not recorded.' },
    { criterionId: 'decision-team', status: 'missing', detail: 'The economic buyer and migration owner are not yet identified.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'An initial migration assessment of the on-premises estate is complete.' },
    { criterionId: 'business-case', status: 'missing', detail: 'No quantified migration business case is attached to the opportunity.' },
    { criterionId: 'next-step', status: 'partial', detail: 'A migration planning session is proposed without a confirmed customer date.' }
  ],
  'opp-aw-commerce': [
    { criterionId: 'customer-outcome', status: 'met', detail: 'The customer targets fewer peak-season outages and faster checkout performance.' },
    { criterionId: 'decision-team', status: 'met', detail: 'The economic buyer, engineering lead, and procurement path are engaged.' },
    { criterionId: 'technical-validation', status: 'met', detail: 'An approved proof of concept validated the AKS microservices approach.' },
    { criterionId: 'business-case', status: 'partial', detail: 'A draft business case exists; final finance approval is pending.' },
    { criterionId: 'next-step', status: 'met', detail: 'A replatform design and delivery plan has a customer-approved date and owners.' }
  ]
}

const discoverableOpportunities: DiscoverableOpportunity[] = [
  {
    id: 'opp-discover-hybrid-networking',
    accountId: 'account-contoso',
    accountName: 'Contoso Energy',
    name: 'Hybrid networking modernization',
    recordedStage: 2,
    value: 1850000,
    currency: 'USD',
    closeDate: '2027-02-12',
    domain: 'infra',
    solutionArea: 'Cloud and AI Platforms',
    technicalCapability: 'Advanced Networking',
    onDealTeam: false
  },
  {
    id: 'opp-discover-vmware-migration',
    accountId: 'account-fabrikam',
    accountName: 'Fabrikam Retail',
    name: 'Datacenter exit to Azure VMware Solution',
    recordedStage: 1,
    value: 2950000,
    currency: 'USD',
    closeDate: '2027-04-02',
    domain: 'infra',
    solutionArea: 'Cloud and AI Platforms',
    technicalCapability: 'Azure VMware Solutions',
    onDealTeam: false
  },
  {
    id: 'opp-discover-synapse-analytics',
    accountId: 'account-contoso',
    accountName: 'Contoso Energy',
    name: 'Enterprise analytics on Synapse and Power BI',
    recordedStage: 2,
    value: 2100000,
    currency: 'USD',
    closeDate: '2027-01-22',
    domain: 'data',
    solutionArea: 'Cloud and AI Platforms',
    technicalCapability: 'New Analytics with Synapse & PowerBI',
    onDealTeam: false
  },
  {
    id: 'opp-discover-sql-managed-instance',
    accountId: 'account-fabrikam',
    accountName: 'Fabrikam Retail',
    name: 'SQL Server migration to Azure SQL MI',
    recordedStage: 3,
    value: 1650000,
    currency: 'USD',
    closeDate: '2026-12-19',
    domain: 'data',
    solutionArea: 'Cloud and AI Platforms',
    technicalCapability: 'SQL Server Migration to Azure SQL MI',
    onDealTeam: false
  },
  {
    id: 'opp-discover-azure-ai-ml',
    accountId: 'account-contoso',
    accountName: 'Contoso Energy',
    name: 'Azure AI and ML platform adoption',
    recordedStage: 2,
    value: 3400000,
    currency: 'USD',
    closeDate: '2027-02-05',
    domain: 'ai-apps',
    solutionArea: 'Cloud and AI Platforms',
    technicalCapability: 'Azure AI and ML',
    onDealTeam: false
  },
  {
    id: 'opp-discover-cloud-native-apps',
    accountId: 'account-fabrikam',
    accountName: 'Fabrikam Retail',
    name: 'Cloud-native apps on AKS and Cosmos DB',
    recordedStage: 1,
    value: 2750000,
    currency: 'USD',
    closeDate: '2027-03-27',
    domain: 'ai-apps',
    solutionArea: 'Cloud and AI Platforms',
    technicalCapability: 'Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB',
    onDealTeam: false
  },
  {
    id: 'opp-discover-zero-trust',
    accountId: 'account-contoso',
    accountName: 'Contoso Energy',
    name: 'Zero Trust security modernization',
    recordedStage: 2,
    value: 2200000,
    currency: 'USD',
    closeDate: '2027-02-18',
    domain: 'security',
    solutionArea: 'Security',
    technicalCapability: 'Threat Protection',
    onDealTeam: false
  },
  {
    id: 'opp-discover-teams-calling',
    accountId: 'account-fabrikam',
    accountName: 'Fabrikam Retail',
    name: 'Teams Phone and calling rollout',
    recordedStage: 1,
    value: 980000,
    currency: 'USD',
    closeDate: '2027-03-05',
    domain: 'modern-work',
    technicalCapability: 'Calling',
    onDealTeam: false
  },
  {
    id: 'opp-discover-d365-customer-service',
    accountId: 'account-fabrikam',
    accountName: 'Fabrikam Retail',
    name: 'Dynamics 365 Customer Service transformation',
    recordedStage: 2,
    value: 1750000,
    currency: 'USD',
    closeDate: '2027-01-28',
    domain: 'biz-apps',
    solutionArea: 'AI Business Solutions',
    technicalCapability: 'Customer Service',
    onDealTeam: false
  },
  {
    id: 'opp-discover-surface-deployment',
    accountId: 'account-contoso',
    accountName: 'Contoso Energy',
    name: 'Surface device deployment and management',
    recordedStage: 1,
    value: 640000,
    currency: 'USD',
    closeDate: '2027-04-15',
    domain: 'devices',
    solutionArea: 'Windows and Devices',
    technicalCapability: 'Surface & Partner Devices',
    onDealTeam: false
  },
  {
    id: 'opp-discover-cloud-advisory',
    accountId: 'account-contoso',
    accountName: 'Contoso Energy',
    name: 'Cloud advisory and adoption services',
    recordedStage: 2,
    value: 850000,
    currency: 'USD',
    closeDate: '2027-02-22',
    domain: 'services',
    solutionArea: 'Microsoft Services',
    technicalCapability: 'Advisory Services',
    onDealTeam: false
  },
  {
    id: 'opp-discover-northwind-data',
    accountId: 'account-northwind',
    accountName: 'Northwind Health',
    name: 'Clinical data platform modernization',
    recordedStage: 1,
    value: 2100000,
    currency: 'USD',
    closeDate: '2027-05-20',
    domain: 'data',
    solutionArea: 'Cloud and AI Platforms',
    technicalCapability: 'Analytics',
    onDealTeam: false
  }
]

// Each discoverable opportunity gets a milestone so a user can expand it in Discovery and join a
// milestone team for an opportunity they have never been on the Deal Team for.
const discoverableMilestonesByOpportunity: Record<string, Milestone[]> = Object.fromEntries(
  discoverableOpportunities.map((opportunity) => [opportunity.id, [{
    id: `${opportunity.id}-milestone`,
    opportunityId: opportunity.id,
    name: 'Customer outcome validation',
    status: 'On Track',
    targetDate: opportunity.closeDate,
    owner: 'Account team',
    commitment: 'Best case'
  }]])
)

export class FixtureMsxConnector implements MsxConnector {
  private readonly opportunities = structuredClone(opportunities)
  private readonly milestonesByOpportunity = structuredClone(milestonesByOpportunity)
  private readonly discoverableMilestonesByOpportunity = structuredClone(discoverableMilestonesByOpportunity)
  private readonly discoverable = structuredClone(discoverableOpportunities)
  private readonly dealTeamOpportunityIds = new Set(this.opportunities.map((opportunity) => opportunity.id))
  // A representative subset of milestones the signed-in user is on, so both the "+" (join)
  // and "-" (leave) states are visible in sample mode. Independent of Deal Team membership.
  private readonly milestoneTeamIds = new Set(
    this.opportunities
      .filter((_opportunity, index) => index % 2 === 0)
      .flatMap((opportunity) => (this.milestonesByOpportunity[opportunity.id] ?? []).map((milestone) => milestone.id))
  )
  private readonly manualAccountIds = new Set<string>()
  private readonly hiddenAccountIds = new Set<string>()
  // In-memory milestone activities (Tasks) keyed by milestone id. Seeded so the list is non-empty.
  private readonly activitiesByMilestone: Record<string, MilestoneActivity[]> = {
    'opp-grid-modernization-milestone': [{
      id: 'act-grid-ms-1', milestoneId: 'opp-grid-modernization-milestone', opportunityId: 'opp-grid-modernization',
      subject: 'Architecture design session', activityType: 'task', status: 'Open', priority: 'Normal',
      taskCategory: 'Architecture Design Session', due: '2026-10-20', owner: 'Account team', createdBy: 'Account team'
    }]
  }
  private activitySequence = 0

  /** Opportunity ids in the portfolio: Deal Team membership OR milestone-team membership. */
  private portfolioOpportunityIds(): Set<string> {
    const ids = new Set(this.dealTeamOpportunityIds)
    for (const [opportunityId, milestones] of Object.entries(this.milestonesByOpportunity)) {
      if (milestones.some((milestone) => this.milestoneTeamIds.has(milestone.id))) ids.add(opportunityId)
    }
    return ids
  }

  /**
   * Promotes a discoverable opportunity into the portfolio pool (without Deal Team membership) so
   * that milestone-team membership can place it in the portfolio union. Idempotent.
   */
  private promoteDiscoverableOpportunity(opportunityId: string): void {
    if (this.opportunities.some((candidate) => candidate.id === opportunityId)) return
    const seed = this.discoverable.find((candidate) => candidate.id === opportunityId)
    if (!seed) return
    const { domain, accountName, solutionArea, technicalCapability, onDealTeam, ...opportunity } = seed
    void domain; void accountName; void solutionArea; void technicalCapability; void onDealTeam
    this.opportunities.push(structuredClone(opportunity))
    this.milestonesByOpportunity[opportunityId] = structuredClone(this.discoverableMilestonesByOpportunity[opportunityId] ?? [])
  }

  async listAccounts(options: AccountListOptions = {}): Promise<Account[]> {
    const portfolioIds = this.portfolioOpportunityIds()
    const portfolioAccountIds = new Set(
      this.opportunities
        .filter((opportunity) => portfolioIds.has(opportunity.id))
        .map((opportunity) => opportunity.accountId)
    )
    return accounts
      .filter((account) => portfolioAccountIds.has(account.id) || this.manualAccountIds.has(account.id) || this.hiddenAccountIds.has(account.id))
      .map((account) => this.mapAccount(account, portfolioAccountIds))
      .filter((account) => options.includeHidden || account.visibility !== 'hidden')
      .map((account) => structuredClone(account))
  }

  async searchAccounts(input: AccountSearchRequest): Promise<AccountCandidate[]> {
    const request = accountSearchRequestSchema.parse(input)
    const query = request.query.toLocaleLowerCase()
    const visibleAccounts = await this.listAccounts({ includeHidden: true })
    const visibleById = new Map(visibleAccounts.map((account) => [account.id, account]))
    return accounts
      .filter((account) => request.matchBy === 'name'
        ? account.name.toLocaleLowerCase().includes(query)
        : account.tpid === request.query)
      .map((account) => {
        const existing = visibleById.get(account.id)
        return {
          ...(existing ?? account),
          state: existing?.visibility === 'hidden' ? 'hidden' as const : existing ? 'visible' as const : 'not-added' as const
        }
      })
  }

  async addAccount(accountId: string): Promise<Account> {
    const account = accounts.find((candidate) => candidate.id === accountId)
    if (!account) throw new Error(`Unknown sample account: ${accountId}`)
    this.manualAccountIds.add(accountId)
    const added = (await this.listAccounts({ includeHidden: true })).find((candidate) => candidate.id === accountId)
    if (!added) throw new Error('The sample account could not be added.')
    return added
  }

  async setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account> {
    const account = accounts.find((candidate) => candidate.id === accountId)
    if (!account) throw new Error(`Unknown sample account: ${accountId}`)
    if (visibility === 'hidden') this.hiddenAccountIds.add(accountId)
    else this.hiddenAccountIds.delete(accountId)
    const portfolioAccountIds = new Set(
      this.opportunities
        .filter((opportunity) => this.portfolioOpportunityIds().has(opportunity.id))
        .map((opportunity) => opportunity.accountId)
    )
    return structuredClone(this.mapAccount(account, portfolioAccountIds))
  }

  async listOpportunities(accountId: string): Promise<Opportunity[]> {
    if (this.hiddenAccountIds.has(accountId)) return []
    const portfolioIds = this.portfolioOpportunityIds()
    return structuredClone(this.opportunities.filter((opportunity) =>
      opportunity.accountId === accountId && portfolioIds.has(opportunity.id)))
  }

  async listMilestones(opportunityId: string): Promise<Milestone[]> {
    this.assertOpportunityAccess(opportunityId)
    return structuredClone(this.milestonesByOpportunity[opportunityId] ?? [])
      .map((milestone) => ({ ...milestone, onMilestoneTeam: this.milestoneTeamIds.has(milestone.id) }))
  }

  async updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone> {
    this.assertOpportunityAccess(opportunityId)
    const milestone = this.milestonesByOpportunity[opportunityId]?.find((candidate) => candidate.id === milestoneId)
    if (!milestone) throw new Error(`Unknown sample milestone: ${milestoneId}`)
    if (update.status !== undefined) milestone.status = update.status
    if (update.targetDate !== undefined) milestone.targetDate = update.targetDate
    if (update.customerCommitment !== undefined) milestone.commitment = update.customerCommitment
    if (update.riskDetails !== undefined) milestone.riskDetails = update.riskDetails
    if (update.comments !== undefined) milestone.comments = update.comments
    return structuredClone(milestone)
  }

  async updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity> {
    this.assertOpportunityAccess(opportunityId)
    const opportunity = this.opportunities.find((candidate) => candidate.id === opportunityId)
    if (!opportunity) throw new Error(`Unknown sample opportunity: ${opportunityId}`)
    opportunity.comments = update.comments
    return structuredClone(opportunity)
  }

  async updateOpportunityStage(opportunityId: string, targetStage: number, auditNote: string): Promise<Opportunity> {
    this.assertOpportunityAccess(opportunityId)
    const opportunity = this.opportunities.find((candidate) => candidate.id === opportunityId)
    if (!opportunity) throw new Error(`Unknown sample opportunity: ${opportunityId}`)
    opportunity.recordedStage = targetStage
    opportunity.comments = [opportunity.comments, auditNote].filter(Boolean).join('\n\n')
    return structuredClone(opportunity)
  }

  async getOpportunityContext(opportunityId: string): Promise<OpportunityContext> {
    this.assertOpportunityAccess(opportunityId)
    const opportunity = this.opportunities.find((candidate) => candidate.id === opportunityId)
    if (!opportunity) {
      throw new Error(`Unknown sample opportunity: ${opportunityId}`)
    }

    const account = accounts.find((candidate) => candidate.id === opportunity.accountId)
    if (!account) {
      throw new Error(`Missing account for sample opportunity: ${opportunityId}`)
    }

    const now = new Date().toISOString()
    return {
      account: structuredClone(account),
      opportunity: structuredClone(opportunity),
      observations: structuredClone(observationsByOpportunity[opportunityId] ?? []),
      retrievedAt: now,
      sourceHealth: {
        source: 'msx',
        state: 'sample',
        detail: 'Sanitized fixture data; no live MSX call was made.',
        checkedAt: now
      }
    }
  }

  async discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]> {
    const visibleAccountIds = new Set((await this.listAccounts()).map((account) => account.id))
    return this.discoverable
      .filter((opportunity) => opportunity.domain === domain && visibleAccountIds.has(opportunity.accountId))
      .map((opportunity) => structuredClone({
        ...opportunity,
        onDealTeam: this.dealTeamOpportunityIds.has(opportunity.id)
      }))
  }

  async joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult> {
    const seed = this.discoverable.find((candidate) => candidate.id === opportunityId)
    if (!seed) throw new Error(`Unknown sample opportunity: ${opportunityId}`)
    const alreadyMember = this.dealTeamOpportunityIds.has(opportunityId)
    if (!alreadyMember) {
      this.dealTeamOpportunityIds.add(opportunityId)
      const { domain, accountName, solutionArea, technicalCapability, onDealTeam, ...opportunity } = seed
      void domain
      void accountName
      void solutionArea
      void technicalCapability
      void onDealTeam
      if (!this.opportunities.some((candidate) => candidate.id === opportunityId)) {
        this.opportunities.push(structuredClone(opportunity))
      }
    }
    return { opportunityId, onDealTeam: true, alreadyMember }
  }

  async leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult> {
    const alreadyAbsent = !this.dealTeamOpportunityIds.has(opportunityId)
    this.dealTeamOpportunityIds.delete(opportunityId)
    return { opportunityId, onDealTeam: false, alreadyAbsent }
  }

  async joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult> {
    const milestone = (this.milestonesByOpportunity[opportunityId] ?? this.discoverableMilestonesByOpportunity[opportunityId])
      ?.find((candidate) => candidate.id === milestoneId)
    if (!milestone) throw new Error(`Unknown sample milestone: ${milestoneId}`)
    // Joining a milestone for a not-yet-portfolio opportunity brings it into the portfolio union.
    this.promoteDiscoverableOpportunity(opportunityId)
    const alreadyMember = this.milestoneTeamIds.has(milestoneId)
    this.milestoneTeamIds.add(milestoneId)
    return { opportunityId, milestoneId, onMilestoneTeam: true, alreadyMember }
  }

  async leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult> {
    const milestone = (this.milestonesByOpportunity[opportunityId] ?? this.discoverableMilestonesByOpportunity[opportunityId])
      ?.find((candidate) => candidate.id === milestoneId)
    if (!milestone) throw new Error(`Unknown sample milestone: ${milestoneId}`)
    const alreadyAbsent = !this.milestoneTeamIds.has(milestoneId)
    this.milestoneTeamIds.delete(milestoneId)
    return { opportunityId, milestoneId, onMilestoneTeam: false, alreadyAbsent }
  }

  async listDiscoverableMilestones(opportunityId: string): Promise<Milestone[]> {
    const milestones = this.milestonesByOpportunity[opportunityId] ?? this.discoverableMilestonesByOpportunity[opportunityId]
    if (!milestones) throw new Error(`Unknown sample opportunity: ${opportunityId}`)
    return structuredClone(milestones).map((milestone) => ({ ...milestone, onMilestoneTeam: this.milestoneTeamIds.has(milestone.id) }))
  }

  private assertSampleMilestone(opportunityId: string, milestoneId: string): void {
    const milestone = (this.milestonesByOpportunity[opportunityId] ?? this.discoverableMilestonesByOpportunity[opportunityId])
      ?.find((candidate) => candidate.id === milestoneId)
    if (!milestone) throw new Error(`Unknown sample milestone: ${milestoneId}`)
  }

  async listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]> {
    this.assertSampleMilestone(opportunityId, milestoneId)
    return structuredClone(this.activitiesByMilestone[milestoneId] ?? [])
  }

  async createMilestoneActivity(opportunityId: string, milestoneId: string, input: CreateMilestoneActivityRequest): Promise<MilestoneActivity> {
    this.assertSampleMilestone(opportunityId, milestoneId)
    const request = createMilestoneActivityRequestSchema.parse(input)
    const activity: MilestoneActivity = {
      id: `act-sample-${++this.activitySequence}`,
      milestoneId,
      opportunityId,
      subject: request.subject,
      activityType: 'task',
      status: 'Open',
      priority: request.priority,
      owner: 'Account team',
      createdBy: 'Account team',
      createdOn: new Date().toISOString(),
      ...(request.taskCategory ? { taskCategory: request.taskCategory } : {}),
      ...(request.due ? { due: request.due } : {}),
      ...(request.durationMinutes !== undefined ? { durationMinutes: request.durationMinutes } : {}),
      ...(request.description ? { description: request.description } : {})
    }
    this.activitiesByMilestone[milestoneId] = [activity, ...(this.activitiesByMilestone[milestoneId] ?? [])]
    return structuredClone(activity)
  }

  private assertOpportunityAccess(opportunityId: string): void {
    const opportunity = this.opportunities.find((candidate) => candidate.id === opportunityId)
    if (!opportunity || !this.portfolioOpportunityIds().has(opportunityId) || this.hiddenAccountIds.has(opportunity.accountId)) {
      throw new Error('The opportunity is not in the active sample portfolio.')
    }
  }

  private mapAccount(account: Account, dealTeamAccountIds: ReadonlySet<string>): Account {
    const manual = this.manualAccountIds.has(account.id)
    const dealTeam = dealTeamAccountIds.has(account.id)
    return {
      ...account,
      provenance: manual && dealTeam ? 'both' : manual ? 'manual' : 'deal-team',
      visibility: this.hiddenAccountIds.has(account.id) ? 'hidden' : 'visible'
    }
  }
}