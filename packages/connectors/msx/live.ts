import {
  accountSearchRequestSchema,
  createMilestoneActivityRequestSchema,
  customerCommitmentSchema,
  getSeDomainDefinition,
  measurePerformance,
  milestoneStatusSchema,
  milestoneUpdateSchema,
  opportunityUpdateSchema,
  type Account,
  type AccountCandidate,
  type AccountListOptions,
  type AccountSearchRequest,
  type AccountVisibility,
  type CreateMilestoneActivityRequest,
  type CustomerCommitment,
  type DealTeamJoinResult,
  type DealTeamLeaveResult,
  type DiscoverableOpportunity,
  type Milestone,
  type MilestoneActivity,
  type MilestoneActivityPriority,
  type MilestoneStatus,
  type MilestoneTeamJoinResult,
  type MilestoneTeamLeaveResult,
  type MilestoneUpdate,
  type Opportunity,
  type OpportunityUpdate,
  type PerformanceReporter,
  type SeDomainId
} from '../../common/index.js'
import {
  MemoryPortfolioPreferenceStore,
  type PortfolioPreferenceStore,
  type PortfolioPreferences,
  type CriterionObservation,
  type MsxConnector,
  type OpportunityContext
} from '../common/index.js'

const defaultBaseUrl = 'https://microsoftsales.crm.dynamics.com/api/data/v9.2/'
const formattedValueSuffix = '@OData.Community.Display.V1.FormattedValue'
const guidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
/** Upper bound on discovered opportunities returned per domain query. */
const discoveryRowLimit = 200

export interface MsxAccessTokenProvider {
  getAccessToken(): Promise<string>
}

interface ODataPage<T> {
  value: T[]
  '@odata.nextLink'?: string
}

interface WhoAmIResponse {
  UserId: string
}

interface DealTeamRow {
  _msp_parentopportunityid_value?: string
}

interface AccountRow {
  accountid: string
  name: string
  [key: string]: unknown
}

interface OpportunityRow {
  opportunityid: string
  statecode?: number
  _parentaccountid_value?: string
  _ownerid_value?: string
  name: string
  msp_activesalesstage?: number
  estimatedvalue?: number
  msp_consumptionconsumedrecurring?: number
  msp_estcompletiondate?: string
  estimatedclosedate?: string
  description?: string | null
  msp_solutionarea?: number
  msp_technicalcapability?: number
  [key: string]: unknown
}

interface DealTeamMemberRow {
  msp_dealteamid?: string
}

interface RelationshipMetadataRow {
  ReferencingAttribute?: string
  ReferencingEntityNavigationPropertyName?: string
}

interface TaskRow {
  activityid: string
  subject?: string
  statecode?: number
  prioritycode?: number
  scheduledend?: string
  actualdurationminutes?: number
  description?: string
  createdon?: string
  [key: string]: unknown
}

interface MilestoneRow {
  msp_engagementmilestoneid: string
  msp_name?: string
  _ownerid_value?: string
  msp_milestonedate?: string
  msp_milestonestatus?: number
  msp_commitmentrecommendation?: number
  msp_monthlyuse?: number
  msp_forecastcomments?: string | null
  [key: string]: unknown
}

const milestoneStatusCodes: Partial<Record<MilestoneStatus, number>> = {
  'On Track': 861980000,
  'At Risk': 861980001,
  Blocked: 861980002,
  Completed: 861980003,
  Cancelled: 861980004
}

const customerCommitmentCodes: Record<CustomerCommitment, number> = {
  Uncommitted: 861980000,
  Committed: 861980003
}

export interface MsxDealTeamWriteMetadata {
  /** Entity set for deal-team membership rows. */
  entitySet: string
  /** Logical (singular) entity name, used to read relationship metadata. */
  logicalName: string
  /** Single-valued navigation property binding the member to a systemuser. Discovered from metadata when omitted. */
  userNavigationProperty?: string
  /** Single-valued navigation property binding the row to the opportunity. Discovered from metadata when omitted. */
  opportunityNavigationProperty?: string
  /** Logical name of the deal-team -> user lookup value field, for existence checks. */
  userLookupField: string
  /** Logical name of the deal-team -> opportunity lookup value field, for existence checks. */
  opportunityLookupField: string
}

export const defaultDealTeamWriteMetadata: MsxDealTeamWriteMetadata = {
  entitySet: 'msp_dealteams',
  logicalName: 'msp_dealteam',
  userLookupField: '_msp_dealteamuserid_value',
  opportunityLookupField: '_msp_parentopportunityid_value'
}

/**
 * Live milestone-team membership is the standard Dataverse **Access Team** behind the "Milestone
 * Team" subgrid on the milestone form. Membership is managed with the `AddUserToRecordTeam` /
 * `RemoveUserFromRecordTeam` actions against the auto-created access team whose **team template** is
 * discovered at runtime by name (default "Milestone Team"), so no per-field configuration is needed.
 */
export interface MsxMilestoneTeamAccessMetadata {
  /** Access-team template name shown on the milestone form (default "Milestone Team"). */
  templateName: string
  /** Optional explicit team template id; when set, name-based discovery is skipped. */
  templateId?: string
}

export const DEFAULT_MILESTONE_TEAM_TEMPLATE_NAME = 'Milestone Team'

/** Applies the default template name to a partial milestone-team access-team config. */
export function resolveMilestoneTeamAccessMetadata(
  partial: Partial<MsxMilestoneTeamAccessMetadata> | undefined
): MsxMilestoneTeamAccessMetadata {
  return {
    templateName: partial?.templateName?.trim() || DEFAULT_MILESTONE_TEAM_TEMPLATE_NAME,
    ...(partial?.templateId ? { templateId: partial.templateId } : {})
  }
}

export const MILESTONE_TEAM_NOT_CONFIGURED_MESSAGE =
  'The Milestone Team is not set up in this MSX environment, so your change was not saved. ' +
  'Ask your administrator to enable the Milestone Team access team on the milestone form.'

/** Derives a lookup attribute logical name (e.g. `msp_dealteamuserid`) from its `_x_value` field. */
function lookupAttributeName(valueField: string): string {
  return valueField.replace(/^_/, '').replace(/_value$/, '')
}

export interface MsxWriteMetadata {
  riskDetailsField?: string
  accountTpidField?: string
  milestoneStatusCodes?: Partial<Record<MilestoneStatus, number>>
  stageCodes?: Partial<Record<1 | 2 | 3 | 4 | 5, number>>
  dealTeam?: Partial<MsxDealTeamWriteMetadata>
  milestoneTeam?: Partial<MsxMilestoneTeamAccessMetadata>
  /** Logical name of the task "Task Category" option-set field, if configured for this environment. */
  taskCategoryField?: string
  /** Map of Task Category label -> option-set code, used to write the category on a created task. */
  taskCategoryCodes?: Record<string, number>
}

/** Dataverse task `prioritycode`: Low 0 / Normal 1 / High 2. */
const taskPriorityCodes: Record<MilestoneActivityPriority, number> = { Low: 0, Normal: 1, High: 2 }
const taskPriorityByCode: Record<number, MilestoneActivityPriority> = { 0: 'Low', 1: 'Normal', 2: 'High' }
/** Dataverse task `statecode`: Open 0 / Completed 1 / Canceled 2. */
const taskStatusByState: Record<number, string> = { 0: 'Open', 1: 'Completed', 2: 'Canceled' }

const navigationPropertyPattern = /^[A-Za-z][A-Za-z0-9_]*$/

export function msxWriteMetadataFromEnvironment(environment: NodeJS.ProcessEnv): MsxWriteMetadata {
  const riskDetailsField = environment['TLC_MSX_RISK_DETAILS_FIELD']?.trim()
  const accountTpidField = environment['TLC_MSX_ACCOUNT_TPID_FIELD']?.trim()
  if (accountTpidField && !navigationPropertyPattern.test(accountTpidField)) {
    throw new Error('TLC_MSX_ACCOUNT_TPID_FIELD must be a valid Dataverse identifier.')
  }
  const configuredCodes: Partial<Record<MilestoneStatus, number>> = {}
  const stageCodes: Partial<Record<1 | 2 | 3 | 4 | 5, number>> = {}
  for (const [status, variable] of [
    ['Lost to Competitor', 'TLC_MSX_STATUS_LOST_TO_COMPETITOR'],
    ['Hygiene/Duplicate', 'TLC_MSX_STATUS_HYGIENE_DUPLICATE']
  ] as const) {
    const rawValue = environment[variable]?.trim()
    if (!rawValue) continue
    const code = Number(rawValue)
    if (!Number.isSafeInteger(code)) throw new Error(`${variable} must be an integer MSX option code.`)
    configuredCodes[status] = code
  }
  for (const stage of [1, 2, 3, 4, 5] as const) {
    const variable = `TLC_MSX_STAGE_${stage}`
    const rawValue = environment[variable]?.trim()
    if (!rawValue) continue
    const code = Number(rawValue)
    if (!Number.isSafeInteger(code)) throw new Error(`${variable} must be an integer MSX option code.`)
    stageCodes[stage] = code
  }
  const dealTeam: Partial<MsxDealTeamWriteMetadata> = {}
  for (const [key, variable] of [
    ['entitySet', 'TLC_MSX_DEALTEAM_ENTITY_SET'],
    ['logicalName', 'TLC_MSX_DEALTEAM_LOGICAL_NAME'],
    ['userNavigationProperty', 'TLC_MSX_DEALTEAM_USER_NAV_PROPERTY'],
    ['opportunityNavigationProperty', 'TLC_MSX_DEALTEAM_OPPORTUNITY_NAV_PROPERTY'],
    ['userLookupField', 'TLC_MSX_DEALTEAM_USER_LOOKUP_FIELD'],
    ['opportunityLookupField', 'TLC_MSX_DEALTEAM_OPPORTUNITY_LOOKUP_FIELD']
  ] as const) {
    const rawValue = environment[variable]?.trim()
    if (!rawValue) continue
    if (!navigationPropertyPattern.test(rawValue)) throw new Error(`${variable} must be a valid Dataverse identifier.`)
    dealTeam[key] = rawValue
  }
  const milestoneTeam: Partial<MsxMilestoneTeamAccessMetadata> = {}
  const milestoneTeamTemplateName = environment['TLC_MSX_MILESTONE_TEAM_TEMPLATE_NAME']?.trim()
  if (milestoneTeamTemplateName) milestoneTeam.templateName = milestoneTeamTemplateName
  const milestoneTeamTemplateId = environment['TLC_MSX_MILESTONE_TEAM_TEMPLATE_ID']?.trim()
  if (milestoneTeamTemplateId) {
    if (!guidPattern.test(milestoneTeamTemplateId)) throw new Error('TLC_MSX_MILESTONE_TEAM_TEMPLATE_ID must be a valid GUID.')
    milestoneTeam.templateId = milestoneTeamTemplateId
  }
  const taskCategoryField = environment['TLC_MSX_TASK_CATEGORY_FIELD']?.trim()
  if (taskCategoryField && !navigationPropertyPattern.test(taskCategoryField)) {
    throw new Error('TLC_MSX_TASK_CATEGORY_FIELD must be a valid Dataverse identifier.')
  }
  let taskCategoryCodes: Record<string, number> | undefined
  const rawTaskCategoryCodes = environment['TLC_MSX_TASK_CATEGORY_CODES']?.trim()
  if (rawTaskCategoryCodes) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawTaskCategoryCodes)
    } catch {
      throw new Error('TLC_MSX_TASK_CATEGORY_CODES must be a JSON object mapping category labels to integer codes.')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('TLC_MSX_TASK_CATEGORY_CODES must be a JSON object mapping category labels to integer codes.')
    }
    const codes: Record<string, number> = {}
    for (const [label, code] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Number.isSafeInteger(code)) throw new Error(`TLC_MSX_TASK_CATEGORY_CODES["${label}"] must be an integer option code.`)
      codes[label] = code as number
    }
    taskCategoryCodes = codes
  }
  return {
    ...(riskDetailsField ? { riskDetailsField } : {}),
    ...(accountTpidField ? { accountTpidField } : {}),
    ...(Object.keys(configuredCodes).length > 0 ? { milestoneStatusCodes: configuredCodes } : {}),
    ...(Object.keys(stageCodes).length > 0 ? { stageCodes } : {}),
    ...(Object.keys(dealTeam).length > 0 ? { dealTeam } : {}),
    ...(Object.keys(milestoneTeam).length > 0 ? { milestoneTeam } : {}),
    ...(taskCategoryField ? { taskCategoryField } : {}),
    ...(taskCategoryCodes ? { taskCategoryCodes } : {})
  }
}

export class MsxRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'MsxRequestError'
  }
}

export class LiveMsxConnector implements MsxConnector {
  private readonly baseUrl: URL
  private portfolioPromise: Promise<{ accounts: Account[]; opportunities: Opportunity[] }> | undefined
  private readonly observationPromises = new Map<string, Promise<CriterionObservation[]>>()
  private readonly milestonePromises = new Map<string, Promise<MilestoneRow[]>>()
  private currentUserIdPromise: Promise<string> | undefined
  private dealTeamBindingsPromise: Promise<{ userNavigationProperty: string; opportunityNavigationProperty: string }> | undefined
  private milestoneTeamTemplateIdPromise: Promise<string> | undefined

  constructor(
    private readonly tokenProvider: MsxAccessTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
    baseUrl = defaultBaseUrl,
    private readonly performanceReporter?: PerformanceReporter,
    private readonly writeMetadata: MsxWriteMetadata = {},
    private readonly preferenceStore: PortfolioPreferenceStore = new MemoryPortfolioPreferenceStore()
  ) {
    this.baseUrl = new URL(baseUrl)
    if (writeMetadata.riskDetailsField && !/^[A-Za-z][A-Za-z0-9_]*$/.test(writeMetadata.riskDetailsField)) {
      throw new Error('The MSX risk details logical field name is invalid.')
    }
  }

  async listAccounts(options: AccountListOptions = {}): Promise<Account[]> {
    const portfolio = await this.getPortfolio()
    return structuredClone(portfolio.accounts.filter((account) => options.includeHidden || account.visibility !== 'hidden'))
  }

  async searchAccounts(input: AccountSearchRequest): Promise<AccountCandidate[]> {
    const request = accountSearchRequestSchema.parse(input)
    const escapedQuery = escapeODataStringLiteral(request.query)
    const tpidField = this.writeMetadata.accountTpidField
    if (request.matchBy === 'tpid' && !tpidField) {
      throw new Error('TPID search requires TLC_MSX_ACCOUNT_TPID_FIELD to contain the verified account TPID logical field.')
    }
    const rows = await measurePerformance('msx.search-accounts', this.performanceReporter, () => this.requestAll<AccountRow>('accounts', {
      '$select': ['accountid', 'name', tpidField].filter(isPresent).join(','),
      '$filter': request.matchBy === 'name'
        ? `statecode eq 0 and contains(name,'${escapedQuery}')`
        : `statecode eq 0 and ${tpidField} eq '${escapedQuery}'`,
      '$orderby': 'name asc',
      '$top': '25'
    }))
    const portfolio = await this.getPortfolio()
    const existingById = new Map(portfolio.accounts.map((account) => [account.id, account]))
    return rows.map((row) => {
      const existing = existingById.get(row.accountid)
      return {
        ...(existing ?? this.mapAccount(row)),
        state: existing?.visibility === 'hidden' ? 'hidden' : existing ? 'visible' : 'not-added'
      }
    })
  }

  async addAccount(accountId: string): Promise<Account> {
    this.assertAccountId(accountId)
    const rows = await this.requestByIds<AccountRow>(
      'accounts',
      'accountid',
      [accountId],
      ['accountid', 'name', this.writeMetadata.accountTpidField].filter(isPresent).join(',')
    )
    if (rows.length !== 1) throw new Error('The selected account is unavailable or inactive in MSX.')
    await this.preferenceStore.addAccount(await this.getCurrentUserId(), accountId)
    this.portfolioPromise = undefined
    const account = (await this.getPortfolio()).accounts.find((candidate) => candidate.id === accountId)
    if (!account) throw new Error('The account preference was saved but the account could not be reloaded.')
    return structuredClone(account)
  }

  async setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account> {
    this.assertAccountId(accountId)
    const rows = await this.requestByIds<AccountRow>(
      'accounts',
      'accountid',
      [accountId],
      ['accountid', 'name', this.writeMetadata.accountTpidField].filter(isPresent).join(',')
    )
    const row = rows[0]
    if (!row) throw new Error('The selected account is unavailable or inactive in MSX.')
    const userId = await this.getCurrentUserId()
    const preferences = await this.preferenceStore.setVisibility(userId, accountId, visibility)
    this.portfolioPromise = undefined
    const account = (await this.getPortfolio()).accounts.find((candidate) => candidate.id === accountId)
    return structuredClone(account ?? this.mapAccount(row, preferences, new Set()))
  }

  async listOpportunities(accountId: string): Promise<Opportunity[]> {
    const portfolio = await this.getPortfolio()
    return structuredClone(
      portfolio.opportunities.filter((opportunity) => opportunity.accountId === accountId)
    )
  }

  async listMilestones(opportunityId: string): Promise<Milestone[]> {
    const portfolio = await this.getPortfolio()
    if (!portfolio.opportunities.some((opportunity) => opportunity.id === opportunityId)) {
      throw new Error('The opportunity is not in the signed-in user’s active MSX portfolio.')
    }
    return this.mapMilestoneRows(opportunityId, await this.milestoneTeamMilestoneIds())
  }

  async listDiscoverableMilestones(opportunityId: string): Promise<Milestone[]> {
    if (!guidPattern.test(opportunityId)) {
      throw new Error('The opportunity id must be a valid MSX GUID.')
    }
    // No portfolio gate: discovery surfaces opportunities in the user's assigned accounts, and the
    // delegated token already scopes what is readable. This lets a user inspect and join a milestone
    // team for an opportunity they are not (yet) on the Deal Team for.
    return this.mapMilestoneRows(opportunityId, await this.milestoneTeamMilestoneIds())
  }

  private async mapMilestoneRows(opportunityId: string, memberMilestoneIds: ReadonlySet<string>): Promise<Milestone[]> {
    return (await this.getMilestoneRows(opportunityId)).map((row) => ({
      id: row.msp_engagementmilestoneid,
      opportunityId,
      name: row.msp_name?.trim() || 'Unnamed milestone',
      status: formattedValue(row, 'msp_milestonestatus') ?? 'Status not recorded',
      ...(row.msp_milestonedate ? { targetDate: row.msp_milestonedate.slice(0, 10) } : {}),
      ...(typeof row.msp_monthlyuse === 'number' ? { estimatedMonthlyUsage: row.msp_monthlyuse } : {}),
      ...(formattedValue(row, '_ownerid_value') ? { owner: formattedValue(row, '_ownerid_value') } : {}),
      ...(formattedValue(row, 'msp_commitmentrecommendation') ? { commitment: formattedValue(row, 'msp_commitmentrecommendation') } : {}),
      ...(this.writeMetadata.riskDetailsField && typeof row[this.writeMetadata.riskDetailsField] === 'string'
        ? { riskDetails: row[this.writeMetadata.riskDetailsField] as string }
        : {}),
      ...(typeof row.msp_forecastcomments === 'string' ? { comments: row.msp_forecastcomments } : {}),
      onMilestoneTeam: memberMilestoneIds.has(row.msp_engagementmilestoneid)
    }))
  }

  /**
   * Milestone ids whose access team (the "Milestone Team" subgrid) currently includes the signed-in
   * user, read from the Dataverse `teams`/`teammembership` tables. Empty when the Milestone Team
   * access-team template is not set up in this environment.
   */
  private async milestoneTeamMemberships(): Promise<Array<{ milestoneId: string }>> {
    const templateId = await this.resolveMilestoneTeamTemplateId().catch(() => undefined)
    if (!templateId) return []
    const userId = await this.getCurrentUserId()
    const teams = await this.requestAll<{ _regardingobjectid_value?: string }>('teams', {
      '$select': '_regardingobjectid_value',
      '$filter': `teamtype eq 1 and _teamtemplateid_value eq ${templateId} and teammembership_association/any(member:member/systemuserid eq ${userId})`
    })
    return unique(teams.map((team) => team._regardingobjectid_value).filter(isPresent)).map((milestoneId) => ({ milestoneId }))
  }

  /** The signed-in user's milestone-team milestone ids, read from MSX. */
  private async milestoneTeamMilestoneIds(): Promise<Set<string>> {
    return new Set((await this.milestoneTeamMemberships()).map((membership) => membership.milestoneId))
  }

  /**
   * Parent opportunity ids of the signed-in user's milestone-team memberships (for the portfolio
   * union), resolved from the member milestone rows.
   */
  private async milestoneTeamOpportunityIds(): Promise<string[]> {
    const memberships = await this.milestoneTeamMemberships()
    if (memberships.length === 0) return []
    const milestoneRows = await this.requestByIds<{ msp_engagementmilestoneid: string; _msp_opportunityid_value?: string }>(
      'msp_engagementmilestones',
      'msp_engagementmilestoneid',
      unique(memberships.map((membership) => membership.milestoneId)),
      'msp_engagementmilestoneid,_msp_opportunityid_value'
    )
    return unique(milestoneRows.map((row) => row._msp_opportunityid_value).filter(isPresent))
  }

  async updateMilestone(opportunityId: string, milestoneId: string, input: MilestoneUpdate): Promise<Milestone> {
    const update = milestoneUpdateSchema.parse(input)
    const statusCode = update.status
      ? { ...milestoneStatusCodes, ...this.writeMetadata.milestoneStatusCodes }[milestoneStatusSchema.parse(update.status)]
      : undefined
    if (update.status && statusCode === undefined) {
      throw new Error(`The MSX option code for milestone status "${update.status}" is not configured.`)
    }
    if (update.riskDetails !== undefined && !this.writeMetadata.riskDetailsField) {
      throw new Error('The MSX logical field name for Risk/Blocker Details is not configured.')
    }
    await this.assertOpportunityAccess(opportunityId)
    const milestones = await this.getMilestoneRows(opportunityId)
    if (!milestones.some((milestone) => milestone.msp_engagementmilestoneid === milestoneId)) {
      throw new Error('The milestone is not in the selected opportunity.')
    }
    await this.patch(`msp_engagementmilestones(${milestoneId})`, {
      ...(statusCode !== undefined ? { msp_milestonestatus: statusCode } : {}),
      ...(update.riskDetails !== undefined ? { [this.writeMetadata.riskDetailsField!]: update.riskDetails } : {}),
      ...(update.targetDate ? { msp_milestonedate: update.targetDate } : {}),
      ...(update.customerCommitment ? { msp_commitmentrecommendation: customerCommitmentCodes[customerCommitmentSchema.parse(update.customerCommitment)] } : {}),
      ...(update.comments !== undefined ? { msp_forecastcomments: update.comments } : {})
    })
    this.milestonePromises.delete(opportunityId)
    this.observationPromises.delete(opportunityId)
    const updated = (await this.listMilestones(opportunityId)).find((milestone) => milestone.id === milestoneId)
    if (!updated) throw new Error('MSX updated the milestone but it could not be reloaded.')
    return updated
  }

  async updateOpportunity(opportunityId: string, input: OpportunityUpdate): Promise<Opportunity> {
    const update = opportunityUpdateSchema.parse(input)
    await this.assertOpportunityAccess(opportunityId)
    await this.patch(`opportunities(${opportunityId})`, { description: update.comments })
    this.portfolioPromise = undefined
    const opportunity = (await this.getPortfolio()).opportunities.find((candidate) => candidate.id === opportunityId)
    if (!opportunity) throw new Error('MSX updated the opportunity but it could not be reloaded.')
    return structuredClone(opportunity)
  }

  async updateOpportunityStage(opportunityId: string, targetStage: number, auditNote: string): Promise<Opportunity> {
    if (!Number.isInteger(targetStage) || targetStage < 1 || targetStage > 5) {
      throw new Error('The target MCEM stage must be between 1 and 5.')
    }
    const stageCode = this.writeMetadata.stageCodes?.[targetStage as 1 | 2 | 3 | 4 | 5]
    if (stageCode === undefined) {
      throw new Error(`Live MSX stage ${targetStage} writes require TLC_MSX_STAGE_${targetStage} to contain the tenant option code.`)
    }
    await this.assertOpportunityAccess(opportunityId)
    const current = (await this.getPortfolio()).opportunities.find((candidate) => candidate.id === opportunityId)
    if (!current) throw new Error('The opportunity is not in the signed-in user’s active MSX portfolio.')
    const description = [current.comments, auditNote].filter(Boolean).join('\n\n')
    await this.patch(`opportunities(${opportunityId})`, {
      msp_activesalesstage: stageCode,
      description
    })
    this.portfolioPromise = undefined
    this.observationPromises.delete(opportunityId)
    const opportunity = (await this.getPortfolio()).opportunities.find((candidate) => candidate.id === opportunityId)
    if (!opportunity) throw new Error('MSX updated the stage but the opportunity could not be reloaded.')
    return structuredClone(opportunity)
  }

  async getOpportunityContext(opportunityId: string): Promise<OpportunityContext> {
    const portfolio = await this.getPortfolio()
    const opportunity = portfolio.opportunities.find((candidate) => candidate.id === opportunityId)
    if (!opportunity) throw new Error('The opportunity is not in the signed-in user’s active MSX portfolio.')
    const account = portfolio.accounts.find((candidate) => candidate.id === opportunity.accountId)
    if (!account) throw new Error('MSX returned an opportunity without an accessible parent account.')

    const retrievedAt = new Date().toISOString()
    const observations = await this.getOpportunityObservations(opportunity)
    return {
      account: structuredClone(account),
      opportunity: structuredClone(opportunity),
      observations: structuredClone(observations),
      retrievedAt,
      sourceHealth: {
        source: 'msx',
        state: 'live',
        detail: 'Live MSX opportunity and engagement-milestone evidence scoped to the signed-in user’s active deal-team portfolio.',
        checkedAt: retrievedAt
      }
    }
  }

  async discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]> {
    const definition = getSeDomainDefinition(domain)
    // Technical capability is the discriminator between Infra/Data/AI-Apps. Solution area
    // ("Cloud and AI Platforms") is shared across all three, so it is not used as an AND gate —
    // requiring both would eliminate the many opportunities that leave technical capability unset.
    // Conversation is OR'd in as a secondary signal to catch opportunities where technical
    // capability has not been populated.
    const capabilityClause = definition.technicalCapabilityCodes.map((code) => `msp_technicalcapability eq ${code}`).join(' or ')
    const conversationClause = definition.conversationCodes.map((code) => `msp_conversation eq ${code}`).join(' or ')
    const domainMatch = [capabilityClause, conversationClause].filter(Boolean).join(' or ')
    const domainClauses: string[] = domainMatch ? [`(${domainMatch})`] : []

    // Scope discovery to the signed-in user's assigned customers: reuse the deal-team-derived
    // portfolio, whose accounts are exactly the accounts MSX surfaces for this user. Opportunities
    // in those accounts that the user is not yet on the deal team for are the discovery targets.
    const portfolio = await this.getPortfolio()
    const accountNameById = new Map(
      portfolio.accounts
        .filter((account) => account.visibility !== 'hidden')
        .map((account) => [account.id, account.name])
    )
    const assignedAccountIds = [...accountNameById.keys()]
    if (assignedAccountIds.length === 0) return []
    const dealTeamOpportunityIds = new Set(portfolio.opportunities.map((opportunity) => opportunity.id))

    const rows = await measurePerformance('msx.discover-opportunities', this.performanceReporter, () =>
      this.requestOpportunitiesForAccounts(assignedAccountIds, domainClauses))

    return rows
      .filter((row) => row._parentaccountid_value && accountNameById.has(row._parentaccountid_value))
      .map((row) => {
        const accountName = accountNameById.get(row._parentaccountid_value!) ?? formattedValue(row, '_parentaccountid_value')
        const solutionArea = formattedValue(row, 'msp_solutionarea')
        const technicalCapability = formattedValue(row, 'msp_technicalcapability')
        return {
          ...this.mapOpportunity(row),
          domain,
          ...(accountName ? { accountName } : {}),
          ...(solutionArea ? { solutionArea } : {}),
          ...(technicalCapability ? { technicalCapability } : {}),
          onDealTeam: dealTeamOpportunityIds.has(row.opportunityid)
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Fetches open opportunities within the given assigned accounts, filtered by the domain clauses. */
  private async requestOpportunitiesForAccounts(accountIds: string[], domainClauses: string[]): Promise<OpportunityRow[]> {
    const select = 'opportunityid,_parentaccountid_value,_ownerid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate,description,msp_solutionarea,msp_technicalcapability,msp_conversation'
    const rows: OpportunityRow[] = []
    for (let offset = 0; offset < accountIds.length; offset += 40) {
      const chunk = accountIds.slice(offset, offset + 40)
      const accountFilter = chunk.map((id) => `_parentaccountid_value eq ${id}`).join(' or ')
      const filterClauses = ['statecode eq 0', `(${accountFilter})`, ...domainClauses]
      rows.push(...await this.requestAll<OpportunityRow>('opportunities', {
        '$select': select,
        '$filter': filterClauses.join(' and '),
        '$orderby': 'name asc',
        '$top': String(discoveryRowLimit)
      }))
    }
    return rows
  }

  async joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult> {
    if (!guidPattern.test(opportunityId)) {
      throw new Error('The opportunity id must be a valid MSX GUID.')
    }
    const dealTeam = { ...defaultDealTeamWriteMetadata, ...this.writeMetadata.dealTeam }
    const userId = await this.getCurrentUserId()

    const existing = await this.requestAll<DealTeamMemberRow>(dealTeam.entitySet, {
      '$select': 'msp_dealteamid',
      '$filter': `statecode eq 0 and ${dealTeam.userLookupField} eq ${userId} and ${dealTeam.opportunityLookupField} eq ${opportunityId}`,
      '$top': '1'
    })
    if (existing.length > 0) {
      this.portfolioPromise = undefined
      return { opportunityId, onDealTeam: true, alreadyMember: true }
    }

    const bindings = await this.resolveDealTeamBindings(dealTeam)
    await this.post(dealTeam.entitySet, {
      [`${bindings.userNavigationProperty}@odata.bind`]: `/systemusers(${userId})`,
      [`${bindings.opportunityNavigationProperty}@odata.bind`]: `/opportunities(${opportunityId})`
    })
    this.portfolioPromise = undefined
    return { opportunityId, onDealTeam: true, alreadyMember: false }
  }

  async leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult> {
    if (!guidPattern.test(opportunityId)) {
      throw new Error('The opportunity id must be a valid MSX GUID.')
    }
    const dealTeam = { ...defaultDealTeamWriteMetadata, ...this.writeMetadata.dealTeam }
    const userId = await this.getCurrentUserId()
    const existing = await this.requestAll<DealTeamMemberRow>(dealTeam.entitySet, {
      '$select': 'msp_dealteamid',
      '$filter': `statecode eq 0 and ${dealTeam.userLookupField} eq ${userId} and ${dealTeam.opportunityLookupField} eq ${opportunityId}`,
      '$top': '2'
    })
    if (existing.length === 0) {
      this.portfolioPromise = undefined
      return { opportunityId, onDealTeam: false, alreadyAbsent: true }
    }
    if (existing.length > 1) {
      throw new Error('MSX returned duplicate active Deal Team memberships for this user and opportunity. Resolve the duplicate rows before retrying.')
    }
    const membershipId = existing[0]?.msp_dealteamid
    if (!membershipId || !guidPattern.test(membershipId)) {
      throw new Error('MSX returned a Deal Team membership without a valid row id.')
    }
    await this.delete(`${dealTeam.entitySet}(${membershipId})`)
    this.portfolioPromise = undefined
    this.observationPromises.delete(opportunityId)
    this.milestonePromises.delete(opportunityId)
    return { opportunityId, onDealTeam: false, alreadyAbsent: false }
  }

  async joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult> {
    if (!guidPattern.test(opportunityId)) {
      throw new Error('The opportunity id must be a valid MSX GUID.')
    }
    if (!guidPattern.test(milestoneId)) {
      throw new Error('The milestone id must be a valid MSX GUID.')
    }
    const milestones = await this.getMilestoneRows(opportunityId)
    if (!milestones.some((milestone) => milestone.msp_engagementmilestoneid === milestoneId)) {
      throw new Error('The milestone is not in the selected opportunity.')
    }
    const userId = await this.getCurrentUserId()
    const templateId = await this.resolveMilestoneTeamTemplateId()
    if (await this.isMilestoneTeamMember(milestoneId)) {
      this.invalidateMilestoneTeamCaches(opportunityId)
      return { opportunityId, milestoneId, onMilestoneTeam: true, alreadyMember: true }
    }
    await this.post(`systemusers(${userId})/Microsoft.Dynamics.CRM.AddUserToRecordTeam`, this.recordTeamActionBody(milestoneId, templateId))
    this.invalidateMilestoneTeamCaches(opportunityId)
    return { opportunityId, milestoneId, onMilestoneTeam: true, alreadyMember: false }
  }

  async leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult> {
    if (!guidPattern.test(opportunityId)) {
      throw new Error('The opportunity id must be a valid MSX GUID.')
    }
    if (!guidPattern.test(milestoneId)) {
      throw new Error('The milestone id must be a valid MSX GUID.')
    }
    const userId = await this.getCurrentUserId()
    const templateId = await this.resolveMilestoneTeamTemplateId()
    if (!(await this.isMilestoneTeamMember(milestoneId))) {
      this.invalidateMilestoneTeamCaches(opportunityId)
      return { opportunityId, milestoneId, onMilestoneTeam: false, alreadyAbsent: true }
    }
    await this.post(`systemusers(${userId})/Microsoft.Dynamics.CRM.RemoveUserFromRecordTeam`, this.recordTeamActionBody(milestoneId, templateId))
    this.invalidateMilestoneTeamCaches(opportunityId)
    return { opportunityId, milestoneId, onMilestoneTeam: false, alreadyAbsent: false }
  }

  async listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]> {
    if (!guidPattern.test(milestoneId)) {
      throw new Error('The milestone id must be a valid MSX GUID.')
    }
    const categoryField = this.writeMetadata.taskCategoryField
    const rows = await this.requestAll<TaskRow>('tasks', {
      '$select': ['activityid', 'subject', 'statecode', 'prioritycode', 'scheduledend', 'actualdurationminutes', 'description', '_ownerid_value', 'createdon', '_createdby_value', categoryField].filter(isPresent).join(','),
      '$filter': `_regardingobjectid_value eq ${milestoneId}`,
      '$orderby': 'createdon desc'
    })
    return rows.map((row) => this.toMilestoneActivity(row, opportunityId, milestoneId))
  }

  async createMilestoneActivity(opportunityId: string, milestoneId: string, input: CreateMilestoneActivityRequest): Promise<MilestoneActivity> {
    if (!guidPattern.test(opportunityId)) {
      throw new Error('The opportunity id must be a valid MSX GUID.')
    }
    if (!guidPattern.test(milestoneId)) {
      throw new Error('The milestone id must be a valid MSX GUID.')
    }
    const request = createMilestoneActivityRequestSchema.parse(input)
    const milestones = await this.getMilestoneRows(opportunityId)
    if (!milestones.some((milestone) => milestone.msp_engagementmilestoneid === milestoneId)) {
      throw new Error('The milestone is not in the selected opportunity.')
    }
    const userId = await this.getCurrentUserId()
    const categoryField = this.writeMetadata.taskCategoryField
    const categoryCode = request.taskCategory ? this.writeMetadata.taskCategoryCodes?.[request.taskCategory] : undefined
    const body: Record<string, unknown> = {
      subject: request.subject,
      prioritycode: taskPriorityCodes[request.priority],
      'regardingobjectid_msp_engagementmilestone@odata.bind': `/msp_engagementmilestones(${milestoneId})`,
      'ownerid@odata.bind': `/systemusers(${userId})`,
      ...(request.description !== undefined ? { description: request.description } : {}),
      ...(request.due ? { scheduledend: request.due } : {}),
      ...(request.durationMinutes !== undefined ? { actualdurationminutes: request.durationMinutes } : {}),
      ...(categoryField && categoryCode !== undefined ? { [categoryField]: categoryCode } : {})
    }
    const created = await this.postReturningEntity<TaskRow>('tasks', body)
    return this.toMilestoneActivity(created, opportunityId, milestoneId)
  }

  private toMilestoneActivity(row: TaskRow, opportunityId: string, milestoneId: string): MilestoneActivity {
    const categoryField = this.writeMetadata.taskCategoryField
    const priority = typeof row.prioritycode === 'number' ? taskPriorityByCode[row.prioritycode] : undefined
    const category = categoryField ? formattedValue(row, categoryField) : undefined
    return {
      id: row.activityid,
      milestoneId,
      opportunityId,
      subject: row.subject?.trim() || 'Untitled task',
      activityType: 'task',
      status: typeof row.statecode === 'number' ? (taskStatusByState[row.statecode] ?? 'Open') : 'Open',
      ...(priority ? { priority } : {}),
      ...(category ? { taskCategory: category } : {}),
      ...(row.scheduledend ? { due: row.scheduledend.slice(0, 10) } : {}),
      ...(typeof row.actualdurationminutes === 'number' ? { durationMinutes: row.actualdurationminutes } : {}),
      ...(typeof row.description === 'string' && row.description.length > 0 ? { description: row.description } : {}),
      ...(formattedValue(row, '_ownerid_value') ? { owner: formattedValue(row, '_ownerid_value') } : {}),
      ...(formattedValue(row, '_createdby_value') ? { createdBy: formattedValue(row, '_createdby_value') } : {}),
      ...(row.createdon ? { createdOn: row.createdon } : {})
    }
  }

  private resolveMilestoneTeamTemplateId(): Promise<string> {
    const configured = resolveMilestoneTeamAccessMetadata(this.writeMetadata.milestoneTeam)
    if (configured.templateId && guidPattern.test(configured.templateId)) {
      return Promise.resolve(configured.templateId)
    }
    this.milestoneTeamTemplateIdPromise ??= this.discoverMilestoneTeamTemplateId(configured.templateName).catch((error: unknown) => {
      this.milestoneTeamTemplateIdPromise = undefined
      throw error
    })
    return this.milestoneTeamTemplateIdPromise
  }

  /** Finds the "Milestone Team" access-team template id by name (cached for the connector's lifetime). */
  private async discoverMilestoneTeamTemplateId(templateName: string): Promise<string> {
    const rows = await this.requestAll<{ teamtemplateid?: string }>('teamtemplates', {
      '$select': 'teamtemplateid,teamtemplatename',
      '$filter': `teamtemplatename eq '${escapeODataStringLiteral(templateName)}'`,
      '$top': '2'
    })
    if (rows.length > 1) {
      throw new Error(`MSX has multiple access-team templates named "${templateName}". Set TLC_MSX_MILESTONE_TEAM_TEMPLATE_ID to the correct team template id.`)
    }
    const templateId = rows[0]?.teamtemplateid
    if (typeof templateId !== 'string' || !guidPattern.test(templateId)) {
      throw new Error(MILESTONE_TEAM_NOT_CONFIGURED_MESSAGE)
    }
    return templateId
  }

  /**
   * True when the milestone's access team currently includes the signed-in user. Uses the same
   * membership read as `onMilestoneTeam` (the all-teams query that only `$select`s
   * `_regardingobjectid_value`) rather than a per-record `_regardingobjectid_value` **filter**, which
   * Dataverse does not reliably support on the polymorphic `team.regardingobjectid` lookup. This also
   * keeps the join/leave decision consistent with what the UI shows.
   */
  private async isMilestoneTeamMember(milestoneId: string): Promise<boolean> {
    return (await this.milestoneTeamMilestoneIds()).has(milestoneId)
  }

  /** Body for the AddUserToRecordTeam / RemoveUserFromRecordTeam bound actions. */
  private recordTeamActionBody(milestoneId: string, templateId: string): Record<string, unknown> {
    return {
      Record: { '@odata.type': 'Microsoft.Dynamics.CRM.msp_engagementmilestone', msp_engagementmilestoneid: milestoneId },
      TeamTemplate: { '@odata.type': 'Microsoft.Dynamics.CRM.teamtemplate', teamtemplateid: templateId }
    }
  }

  private invalidateMilestoneTeamCaches(opportunityId: string): void {
    this.portfolioPromise = undefined
    this.observationPromises.delete(opportunityId)
    this.milestonePromises.delete(opportunityId)
  }

  private resolveDealTeamBindings(dealTeam: MsxDealTeamWriteMetadata): Promise<{ userNavigationProperty: string; opportunityNavigationProperty: string }> {
    if (dealTeam.userNavigationProperty && dealTeam.opportunityNavigationProperty) {
      return Promise.resolve({
        userNavigationProperty: dealTeam.userNavigationProperty,
        opportunityNavigationProperty: dealTeam.opportunityNavigationProperty
      })
    }
    this.dealTeamBindingsPromise ??= this.discoverDealTeamBindings(dealTeam).catch((error: unknown) => {
      this.dealTeamBindingsPromise = undefined
      throw error
    })
    return this.dealTeamBindingsPromise
  }

  private async discoverDealTeamBindings(dealTeam: MsxDealTeamWriteMetadata): Promise<{ userNavigationProperty: string; opportunityNavigationProperty: string }> {
    const userAttribute = lookupAttributeName(dealTeam.userLookupField)
    const opportunityAttribute = lookupAttributeName(dealTeam.opportunityLookupField)
    const fallback = {
      userNavigationProperty: dealTeam.userNavigationProperty ?? userAttribute,
      opportunityNavigationProperty: dealTeam.opportunityNavigationProperty ?? opportunityAttribute
    }
    try {
      const relationships = await this.requestAll<RelationshipMetadataRow>(
        `EntityDefinitions(LogicalName='${dealTeam.logicalName}')/ManyToOneRelationships`,
        { '$select': 'ReferencingAttribute,ReferencingEntityNavigationPropertyName' }
      )
      const userNav = relationships.find((row) => row.ReferencingAttribute === userAttribute)?.ReferencingEntityNavigationPropertyName
      const opportunityNav = relationships.find((row) => row.ReferencingAttribute === opportunityAttribute)?.ReferencingEntityNavigationPropertyName
      return {
        userNavigationProperty: dealTeam.userNavigationProperty ?? userNav ?? fallback.userNavigationProperty,
        opportunityNavigationProperty: dealTeam.opportunityNavigationProperty ?? opportunityNav ?? fallback.opportunityNavigationProperty
      }
    } catch {
      return fallback
    }
  }

  refresh(): void {
    this.portfolioPromise = undefined
    this.observationPromises.clear()
    this.milestonePromises.clear()
    this.currentUserIdPromise = undefined
  }

  /** Returns the signed-in user's Dataverse systemuser id (WhoAmI UserId), cached for reuse. */
  getCurrentUserId(): Promise<string> {
    this.currentUserIdPromise ??= this.requestJson<WhoAmIResponse>('WhoAmI')
      .then((identity) => identity.UserId)
      .catch((error) => {
        this.currentUserIdPromise = undefined
        throw error
      })
    return this.currentUserIdPromise
  }

  private async assertOpportunityAccess(opportunityId: string): Promise<void> {
    if (!(await this.getPortfolio()).opportunities.some((opportunity) => opportunity.id === opportunityId)) {
      throw new Error('The opportunity is not in the signed-in user’s active MSX portfolio.')
    }
  }

  private getOpportunityObservations(opportunity: Opportunity): Promise<CriterionObservation[]> {
    let observations = this.observationPromises.get(opportunity.id)
    if (!observations) {
      observations = measurePerformance('msx.opportunity-evidence', this.performanceReporter, async () => {
        const milestones = await this.getMilestoneRows(opportunity.id)
        return mapOpportunityObservations(opportunity, milestones)
      }).catch((error: unknown) => {
        this.observationPromises.delete(opportunity.id)
        throw error
      })
      this.observationPromises.set(opportunity.id, observations)
    }
    return observations
  }

  private getMilestoneRows(opportunityId: string): Promise<MilestoneRow[]> {
    let milestones = this.milestonePromises.get(opportunityId)
    if (!milestones) {
      milestones = this.requestAll<MilestoneRow>('msp_engagementmilestones', {
        '$select': ['msp_engagementmilestoneid', 'msp_name', '_ownerid_value', 'msp_milestonedate', 'msp_milestonestatus', 'msp_commitmentrecommendation', 'msp_monthlyuse', 'msp_forecastcomments', this.writeMetadata.riskDetailsField].filter(Boolean).join(','),
        '$filter': `statecode eq 0 and _msp_opportunityid_value eq ${opportunityId}`,
        '$orderby': 'msp_milestonedate asc'
      }).catch((error: unknown) => {
        this.milestonePromises.delete(opportunityId)
        throw error
      })
      this.milestonePromises.set(opportunityId, milestones)
    }
    return milestones
  }

  private getPortfolio(): Promise<{ accounts: Account[]; opportunities: Opportunity[] }> {
    this.portfolioPromise ??= this.loadPortfolio().catch((error: unknown) => {
      this.portfolioPromise = undefined
      throw error
    })
    return this.portfolioPromise
  }

  private async loadPortfolio(): Promise<{ accounts: Account[]; opportunities: Opportunity[] }> {
    const userId = await measurePerformance('msx.identity', this.performanceReporter, () => this.getCurrentUserId())
    const preferences = await this.preferenceStore.read(userId)
    const dealTeamRows = await measurePerformance('msx.deal-team', this.performanceReporter, () => this.requestAll<DealTeamRow>('msp_dealteams', {
      '$select': '_msp_parentopportunityid_value',
      '$filter': `statecode eq 0 and _msp_dealteamuserid_value eq ${userId}`
    }))
    const milestoneOpportunityIds = await this.milestoneTeamOpportunityIds()
    const opportunityIds = unique([
      ...dealTeamRows.map((row) => row._msp_parentopportunityid_value).filter(isPresent),
      ...milestoneOpportunityIds
    ])
    const opportunityRows = await measurePerformance('msx.opportunities', this.performanceReporter, () => this.requestByIds<OpportunityRow>(
      'opportunities',
      'opportunityid',
      opportunityIds,
      'opportunityid,statecode,_parentaccountid_value,_ownerid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate,description'
    ))
    const activeOpportunities = opportunityRows.filter((row) => row._parentaccountid_value && (row.statecode === undefined || row.statecode === 0))
    const dealTeamAccountIds = unique(
      activeOpportunities.map((row) => row._parentaccountid_value).filter(isPresent)
    )
    const accountIds = unique([
      ...dealTeamAccountIds,
      ...preferences.manualAccountIds,
      ...preferences.hiddenAccountIds
    ])
    const accountRows = await measurePerformance('msx.accounts', this.performanceReporter, () => this.requestByIds<AccountRow>(
      'accounts',
      'accountid',
      accountIds,
      ['accountid', 'name', this.writeMetadata.accountTpidField].filter(isPresent).join(',')
    ))
    const accounts = accountRows
      .map((row) => this.mapAccount(row, preferences, new Set(dealTeamAccountIds)))
      .sort((left, right) => left.name.localeCompare(right.name))
    const visibleAccountIds = new Set(accounts.filter((account) => account.visibility !== 'hidden').map((account) => account.id))
    const opportunities = activeOpportunities
      .filter((row) => row._parentaccountid_value && visibleAccountIds.has(row._parentaccountid_value))
      .map((row) => this.mapOpportunity(row))
      .sort((left, right) => left.name.localeCompare(right.name))

    return { accounts, opportunities }
  }

  private mapAccount(
    row: AccountRow,
    preferences: PortfolioPreferences = { manualAccountIds: [], hiddenAccountIds: [], revision: 0 },
    dealTeamAccountIds: ReadonlySet<string> = new Set()
  ): Account {
    const manual = preferences.manualAccountIds.includes(row.accountid)
    const dealTeam = dealTeamAccountIds.has(row.accountid)
    const tpidField = this.writeMetadata.accountTpidField
    const tpid = tpidField && typeof row[tpidField] === 'string' ? row[tpidField].trim() : undefined
    return {
      id: row.accountid,
      name: row.name,
      segment: 'Live MSX',
      ...(tpid ? { tpid } : {}),
      ...(manual || dealTeam
        ? { provenance: manual && dealTeam ? 'both' as const : manual ? 'manual' as const : 'deal-team' as const }
        : {}),
      visibility: preferences.hiddenAccountIds.includes(row.accountid) ? 'hidden' : 'visible'
    }
  }

  private assertAccountId(accountId: string): void {
    if (!guidPattern.test(accountId)) throw new Error('The account id must be a valid MSX GUID.')
  }

  private mapOpportunity(row: OpportunityRow): Opportunity {
    const formattedStage = row[`msp_activesalesstage${formattedValueSuffix}`]
    const parsedStage = typeof formattedStage === 'string' ? Number.parseInt(formattedStage.match(/[1-5]/)?.[0] ?? '', 10) : Number.NaN
    const numericStage = row.msp_activesalesstage
    const recordedStage = Number.isInteger(parsedStage)
      ? parsedStage
      : numericStage && numericStage >= 1 && numericStage <= 5 ? numericStage : 1
    const closeDate = row.msp_estcompletiondate ?? row.estimatedclosedate

    return {
      id: row.opportunityid,
      accountId: row._parentaccountid_value!,
      name: row.name,
      ...(formattedValue(row, '_ownerid_value') ? { owner: formattedValue(row, '_ownerid_value') } : {}),
      recordedStage,
      value: row.estimatedvalue || row.msp_consumptionconsumedrecurring || 0,
      currency: 'USD',
      closeDate: closeDate?.slice(0, 10) ?? '1970-01-01',
      ...(typeof row.description === 'string' ? { comments: row.description } : {})
    }
  }

  private async requestByIds<T>(
    entitySet: string,
    idField: string,
    ids: string[],
    select: string
  ): Promise<T[]> {
    const rows: T[] = []
    for (let offset = 0; offset < ids.length; offset += 40) {
      const chunk = ids.slice(offset, offset + 40)
      const idFilter = chunk.map((id) => `${idField} eq ${id}`).join(' or ')
      rows.push(...await this.requestAll<T>(entitySet, {
        '$select': select,
        '$filter': `statecode eq 0 and (${idFilter})`
      }))
    }
    return rows
  }

  private async requestAll<T>(entitySet: string, parameters: Record<string, string>): Promise<T[]> {
    const firstUrl = new URL(entitySet, this.baseUrl)
    for (const [name, value] of Object.entries(parameters)) firstUrl.searchParams.set(name, value)

    const rows: T[] = []
    let nextUrl: URL | undefined = firstUrl
    while (nextUrl) {
      this.assertTrustedUrl(nextUrl)
      const page: ODataPage<T> = await this.requestJson<ODataPage<T>>(nextUrl)
      rows.push(...page.value)
      nextUrl = page['@odata.nextLink'] ? new URL(page['@odata.nextLink']) : undefined
    }
    return rows
  }

  private async requestJson<T>(pathOrUrl: string | URL): Promise<T> {
    const url = pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, this.baseUrl)
    this.assertTrustedUrl(url)
    const accessToken = await this.tokenProvider.getAccessToken()
    const response = await this.fetchImplementation(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=500'
      }
    })
    if (!response.ok) {
      throw new MsxRequestError(`MSX request failed with status ${response.status}.`, response.status)
    }
    return await response.json() as T
  }

  private async patch(path: string, body: Record<string, unknown>): Promise<void> {
    const url = new URL(path, this.baseUrl)
    this.assertTrustedUrl(url)
    const accessToken = await this.tokenProvider.getAccessToken()
    const response = await this.fetchImplementation(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'If-Match': '*'
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      throw new MsxRequestError(`MSX update failed with status ${response.status}.`, response.status)
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<void> {
    const url = new URL(path, this.baseUrl)
    this.assertTrustedUrl(url)
    const accessToken = await this.tokenProvider.getAccessToken()
    const response = await this.fetchImplementation(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      throw new MsxRequestError(`MSX create failed with status ${response.status}.`, response.status)
    }
  }

  /** POSTs and returns the created row (via `Prefer: return=representation`). */
  private async postReturningEntity<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = new URL(path, this.baseUrl)
    this.assertTrustedUrl(url)
    const accessToken = await this.tokenProvider.getAccessToken()
    const response = await this.fetchImplementation(url, {
      method: 'POST',
      headers: {
        Authorization: ['Bearer', accessToken].join(' '),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      throw new MsxRequestError(`MSX create failed with status ${response.status}.`, response.status)
    }
    return await response.json() as T
  }

  private async delete(path: string): Promise<void> {
    const url = new URL(path, this.baseUrl)
    this.assertTrustedUrl(url)
    const accessToken = await this.tokenProvider.getAccessToken()
    const response = await this.fetchImplementation(url, {
      method: 'DELETE',
      headers: {
        Authorization: ['Bearer', accessToken].join(' '),
        Accept: 'application/json',
        'If-Match': '*'
      }
    })
    if (!response.ok) {
      throw new MsxRequestError(`MSX delete failed with status ${response.status}.`, response.status)
    }
  }

  private assertTrustedUrl(url: URL): void {
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith(this.baseUrl.pathname)) {
      throw new MsxRequestError('MSX returned an untrusted continuation URL.')
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function isPresent(value: string | undefined): value is string {
  return Boolean(value)
}

function formattedValue(row: Record<string, unknown>, field: string): string | undefined {
  const value = row[`${field}${formattedValueSuffix}`]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function escapeODataStringLiteral(value: string): string {
  return value.replaceAll("'", "''")
}

function mapOpportunityObservations(opportunity: Opportunity, milestones: MilestoneRow[]): CriterionObservation[] {
  const observations: CriterionObservation[] = []
  const value = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: opportunity.currency,
    maximumFractionDigits: 0
  }).format(opportunity.value)
  const datedMilestone = milestones.find((milestone) => milestone.msp_milestonedate)

  if (opportunity.recordedStage === 1) {
    if (opportunity.value > 0) {
      observations.push({
        criterionId: 'budget',
        status: 'partial',
        detail: `MSX records ${value} of opportunity value, but this does not confirm available customer funding.`
      })
    }
    if (datedMilestone) {
      observations.push({
        criterionId: 'timing',
        status: 'partial',
        detail: `MSX milestone “${datedMilestone.msp_name ?? 'Unnamed milestone'}” is dated ${datedMilestone.msp_milestonedate!.slice(0, 10)}, but the complete decision and implementation timeline is not recorded.`
      })
    }
    if (milestones.some((milestone) => milestone.msp_commitmentrecommendation === 861980003)) {
      observations.push({
        criterionId: 'approval',
        status: 'partial',
        detail: 'MSX contains a committed milestone recommendation, but that internal signal does not establish the customer approval path.'
      })
    }
    return observations
  }

  if (opportunity.value > 0 || milestones.some((milestone) => (milestone.msp_monthlyuse ?? 0) !== 0)) {
    observations.push({
      criterionId: 'business-case',
      status: 'partial',
      detail: `MSX records a financial signal (${value} opportunity value), but expected return, customer priority, and budget validation remain incomplete.`
    })
  }

  if (milestones.length > 0) {
    observations.push({
      criterionId: 'customer-outcome',
      status: 'partial',
      detail: `MSX contains ${milestones.length} engagement milestone${milestones.length === 1 ? '' : 's'}; confirm that each is tied to a measurable customer outcome and review rhythm.`
    })
  }

  const completedValidation = milestones.find((milestone) =>
    milestone.msp_milestonestatus === 861980003 &&
    /architecture|demo|pilot|poc|technical|validation|workshop/i.test(milestone.msp_name ?? ''))
  if (completedValidation) {
    observations.push({
      criterionId: 'technical-validation',
      status: 'met',
      detail: `Completed MSX milestone “${completedValidation.msp_name ?? 'Technical validation'}” provides recorded validation evidence.`
    })
  }

  const activeMilestone = milestones.find((milestone) =>
    ![861980003, 861980004, 861980007].includes(milestone.msp_milestonestatus ?? -1))
  if (activeMilestone) {
    const hasDate = Boolean(activeMilestone.msp_milestonedate)
    const hasOwner = Boolean(activeMilestone._ownerid_value)
    observations.push({
      criterionId: 'next-step',
      status: hasDate && hasOwner ? 'met' : 'partial',
      detail: hasDate && hasOwner
        ? `MSX milestone “${activeMilestone.msp_name ?? 'Unnamed milestone'}” has a named owner and date ${activeMilestone.msp_milestonedate!.slice(0, 10)}.`
        : `MSX milestone “${activeMilestone.msp_name ?? 'Unnamed milestone'}” is active but is missing ${hasDate ? 'a named owner' : hasOwner ? 'a date' : 'a date and named owner'}.`
    })
  }

  return observations
}