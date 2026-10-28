import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { accountSearchLimit, assertAccountNameIndex, fuzzyAccountName, indexedAccountIds, parseAccountSearchPage } from './account-search.js'
import { commentHistoryEntries, isoTimestamp, newestFirst, parseCommentHistoryRows, plainText } from './evidence.js'
import {
  accountSearchRequestSchema,
  createMilestoneActivityRequestSchema,
  contractVersion,
  customerCommitmentSchema,
  getSeDomainDefinition,
  seDomainIds,
  measurePerformance,
  milestoneStatusSchema,
  milestoneUpdateSchema,
  opportunityUpdateSchema,
  recordCreationCatalogSchema,
  recordCreationMaxMutations,
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
  type ChoiceRef,
  type RecordCreationCatalog,
  type PerformanceReporter,
  type SeDomainId
} from '../../common/index.js'
import {
  MemoryPortfolioPreferenceStore,
  type PortfolioPreferenceStore,
  type PortfolioPreferences,
  type CriterionObservation,
  type EvidenceEntry,
  type MsxConnector,
  type OpportunityContext,
  type OpportunityEvidence
} from '../common/index.js'

const defaultBaseUrl = 'https://microsoftsales.crm.dynamics.com/api/data/v9.2/'
/** Dataverse column holding MSX's forecast-comment history as a JSON array of `{ userId, modifiedOn, comment }`. */
const commentHistoryField = 'msp_forecastcommentsjsonfield'
/** Newest rows read per evidence source; the orchestrator trims further to its prompt budget. */
const evidenceRowLimit = 25
const formattedValueSuffix = '@OData.Community.Display.V1.FormattedValue'
const guidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

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

interface MsxPortfolio {
  accounts: Account[]
  opportunities: Opportunity[]
  dealTeamOpportunityIds: ReadonlySet<string>
  milestoneTeamOpportunityIds: string[]
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
  msp_forecastcomments?: string | null
  msp_solutionarea?: number
  msp_technicalcapability?: number
  msp_opportunitytype?: string
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
    readonly status?: number,
    readonly retryAfterMs?: number,
    readonly effect?: 'not-dispatched' | 'unknown'
  ) {
    super(message)
    this.name = 'MsxRequestError'
  }
}

export class LiveMsxConnector implements MsxConnector {
  private readonly readContext = new AsyncLocalStorage<{
    portfolio?: Promise<MsxPortfolio>
    identity?: Promise<string>
    template?: Promise<string>
    memberships?: Promise<Array<{ milestoneId: string }>>
    milestones: Map<string, Promise<MilestoneRow[]>>
    observations: Map<string, Promise<CriterionObservation[]>>
    versions: Map<string, string>
    fresh?: boolean
    signal?: AbortSignal
  }>()
  private readonly entityVersions = new Map<string, string>()
  private readonly expectedVersions = new AsyncLocalStorage<{
    versions: Record<string, string>
    verifyAccessToken?: (token: string) => void
    onDispatch?: () => void
  }>()
  private readonly baseUrl: URL
  private portfolioPromise: Promise<MsxPortfolio> | undefined
  private readonly observationPromises = new Map<string, Promise<CriterionObservation[]>>()
  private readonly milestonePromises = new Map<string, Promise<MilestoneRow[]>>()
  private currentUserIdPromise: Promise<string> | undefined
  private dealTeamBindingsPromise: Promise<{ userNavigationProperty: string; opportunityNavigationProperty: string }> | undefined
  private milestoneTeamTemplateIdPromise: Promise<string> | undefined
  private accountTpidField: string | undefined
  private accountTpidMetadataPromise: Promise<string> | undefined
  private accountNameIndexPromise: Promise<void> | undefined

  constructor(
    private readonly tokenProvider: MsxAccessTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
    baseUrl = defaultBaseUrl,
    private readonly performanceReporter?: PerformanceReporter,
    private readonly writeMetadata: MsxWriteMetadata = {},
    private readonly preferenceStore: PortfolioPreferenceStore = new MemoryPortfolioPreferenceStore(),
    private readonly cacheOptions: { cachePortfolio?: boolean; requireConditionalWrites?: boolean } = {}
  ) {
    this.baseUrl = new URL(baseUrl)
    if (writeMetadata.riskDetailsField && !/^[A-Za-z][A-Za-z0-9_]*$/.test(writeMetadata.riskDetailsField)) {
      throw new Error('The MSX risk details logical field name is invalid.')
    }
    if (writeMetadata.accountTpidField && !navigationPropertyPattern.test(writeMetadata.accountTpidField)) {
      throw new Error('TLC_MSX_ACCOUNT_TPID_FIELD must be a valid Dataverse identifier.')
    }
    this.accountTpidField = writeMetadata.accountTpidField
  }

  async listAccounts(options: AccountListOptions = {}): Promise<Account[]> {
    const portfolio = await this.getPortfolio()
    return structuredClone(portfolio.accounts.filter((account) => options.includeHidden || account.visibility !== 'hidden'))
  }

  async getPortfolioIndex(options: AccountListOptions = {}): Promise<{ accounts: Account[]; opportunities: Opportunity[] }> {
    const portfolio = await this.getPortfolio()
    const accounts = portfolio.accounts.filter((account) => options.includeHidden || account.visibility !== 'hidden')
    const groups = new Map<string, Opportunity[]>(accounts.filter((account) => account.visibility !== 'hidden').map((account) => [account.id, []]))
    for (const opportunity of portfolio.opportunities) groups.get(opportunity.accountId)?.push(opportunity)
    return structuredClone({ accounts, opportunities: accounts.flatMap((account) => groups.get(account.id) ?? []) })
  }

  async conditionalWriteOperations(): Promise<ReadonlyArray<'updateOpportunity' | 'updateMilestone' | 'transitionOpportunityStage'>> {
    const [opportunity, milestone] = await Promise.all([
      this.requestJson<{ IsOptimisticConcurrencyEnabled?: boolean }>("EntityDefinitions(LogicalName='opportunity')?$select=IsOptimisticConcurrencyEnabled"),
      this.requestJson<{ IsOptimisticConcurrencyEnabled?: boolean }>("EntityDefinitions(LogicalName='msp_engagementmilestone')?$select=IsOptimisticConcurrencyEnabled")
    ])
    return [
      ...(opportunity.IsOptimisticConcurrencyEnabled === true ? ['updateOpportunity' as const] : []),
      ...(opportunity.IsOptimisticConcurrencyEnabled === true && this.writeMetadata.stageCodes
        ? ['transitionOpportunityStage' as const] : []),
      ...(milestone.IsOptimisticConcurrencyEnabled === true ? ['updateMilestone' as const] : [])
    ]
  }

  async getCatalog(accountId: string): Promise<RecordCreationCatalog> {
    const account = (await this.listAccounts()).find((item) => item.id === accountId)
    if (!account) throw new Error('The selected Account is unavailable or hidden in MSX.')
    const userId = await this.getCurrentUserId()
    const [user, priceRows, currencyRows, workloadRows, opportunities, intent, category, status, commitment, customerBudgetApproved, solutionArea, technicalCapability] = await Promise.all([
      this.requestJson<{ fullname: string }>(`systemusers(${userId})?$select=fullname`),
      this.requestAll<{ pricelevelid: string; name: string }>('pricelevels', { '$select': 'pricelevelid,name', '$orderby': 'name asc' }),
      this.requestAll<{ transactioncurrencyid: string; currencyname: string; isocurrencycode: string }>(
        'transactioncurrencies', { '$select': 'transactioncurrencyid,currencyname,isocurrencycode', '$orderby': 'currencyname asc' }
      ),
      this.requestAll<{ msp_workloadid: string; msp_name: string }>('msp_workloads', {
        '$select': 'msp_workloadid,msp_name', '$orderby': 'msp_name asc'
      }),
      this.listOpportunities(accountId),
      this.getCreationChoiceValues('opportunity', 'msp_opportunitytype', 'MultiSelectPicklistAttributeMetadata'),
      this.getCreationChoiceValues('msp_engagementmilestone', 'msp_milestonecategory', 'PicklistAttributeMetadata'),
      this.getCreationChoiceValues('msp_engagementmilestone', 'msp_milestonestatus', 'PicklistAttributeMetadata'),
      this.getCreationChoiceValues('msp_engagementmilestone', 'msp_commitmentrecommendation', 'PicklistAttributeMetadata'),
      this.getCreationChoiceValues('msp_engagementmilestone', 'msp_customerbudgetapproved', 'PicklistAttributeMetadata'),
      this.getCreationChoiceValues('opportunity', 'msp_solutionarea', 'PicklistAttributeMetadata'),
      this.getCreationChoiceValues('opportunity', 'msp_technicalcapability', 'PicklistAttributeMetadata')
    ])
    if (!user.fullname?.trim()) throw new Error('The current MSX user name is unavailable.')
    const data = {
      account: { id: account.id, label: account.name },
      opportunities: opportunities.map((item) => ({ id: item.id, label: item.name })),
      priceLists: priceRows.map((row) => ({ id: row.pricelevelid, label: row.name })),
      currencies: currencyRows.map((row) => ({ id: row.transactioncurrencyid, label: row.currencyname, isoCode: row.isocurrencycode })),
      workloads: workloadRows.map((row) => ({ id: row.msp_workloadid, label: row.msp_name })),
      owners: [{ id: userId, label: user.fullname }],
      defaults: { owner: { id: userId, label: user.fullname } },
      choices: { intent, category, status, commitment, customerBudgetApproved, solutionArea, technicalCapability }
    }
    return recordCreationCatalogSchema.parse({
      contractVersion,
      target: 'draft',
      revision: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
      ...data,
      maxMutations: recordCreationMaxMutations
    })
  }

  private async getCreationChoiceValues(
    entity: 'opportunity' | 'msp_engagementmilestone',
    field: string,
    metadataType: 'PicklistAttributeMetadata' | 'MultiSelectPicklistAttributeMetadata'
  ): Promise<ChoiceRef[]> {
    const path = `EntityDefinitions(LogicalName='${entity}')/Attributes(LogicalName='${field}')/Microsoft.Dynamics.CRM.${metadataType}`
    const url = new URL(path, this.baseUrl)
    url.searchParams.set('$expand', 'OptionSet')
    const metadata = await this.requestJson<{
      OptionSet?: {
        Options?: Array<{
          Value?: number
          Label?: {
            LocalizedLabels?: Array<{ LanguageCode?: number; Label?: string }>
            UserLocalizedLabel?: { Label?: string }
          }
        }>
      }
    }>(url)
    if (!metadata.OptionSet?.Options) throw new Error(`MSX choice metadata is unavailable for ${field}.`)
    return metadata.OptionSet.Options.map((option) => {
      const label = option.Label?.LocalizedLabels?.find((item) => item.LanguageCode === 1033)?.Label
        ?? option.Label?.UserLocalizedLabel?.Label
      if (typeof option.Value !== 'number' || !label?.trim()) {
        throw new Error(`MSX choice metadata is incomplete for ${field}.`)
      }
      return { value: option.Value, label: label.trim() }
    }).sort((left, right) => left.value - right.value)
  }

  async searchAccounts(input: AccountSearchRequest): Promise<AccountCandidate[]> {
    const request = accountSearchRequestSchema.parse(input)
    const escapedQuery = escapeODataStringLiteral(request.query)
    const tpidField = request.matchBy === 'tpid' ? await this.resolveAccountTpidField() : this.accountTpidField
    const select = ['accountid', 'name', tpidField].filter(isPresent).join(',')
    const rows = await measurePerformance('msx.search-accounts', this.performanceReporter, () =>
      request.matchBy === 'name'
        ? this.searchAccountNames(request.query, select)
        : this.requestAccountCandidates(`statecode eq 0 and ${tpidField} eq '${escapedQuery}'`, select))
    if (rows.length === 0) return []
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

  private async requestAccountCandidates(filter: string, select: string): Promise<AccountRow[]> {
    const url = new URL('accounts', this.baseUrl)
    for (const [name, value] of Object.entries({
      '$select': select, '$filter': filter, '$orderby': 'name asc', '$top': String(accountSearchLimit)
    })) url.searchParams.set(name, value)
    const rows: AccountRow[] = []
    let next: URL | undefined = url
    while (next && rows.length < accountSearchLimit) {
      const page = parseAccountSearchPage(await this.requestJson<unknown>(next))
      rows.push(...page.value.slice(0, accountSearchLimit - rows.length))
      next = page['@odata.nextLink'] ? new URL(page['@odata.nextLink']) : undefined
    }
    return rows
  }

  private async searchAccountNames(query: string, select: string): Promise<AccountRow[]> {
    const escaped = escapeODataStringLiteral(query)
    const exact = await this.requestAccountCandidates(`statecode eq 0 and name eq '${escaped}'`, select)
    if (exact.length > 0) return exact
    const partial = await this.requestAccountCandidates(`statecode eq 0 and contains(name,'${escaped}')`, select)
    if (partial.length > 0) return partial

    this.accountNameIndexPromise ??= this.requestJson<unknown>('searchstatus()')
      .then(assertAccountNameIndex)
      .catch((error: unknown) => {
        this.accountNameIndexPromise = undefined
        throw error
      })
    await this.accountNameIndexPromise
    const response = await this.postReturningEntity<unknown>('searchquery', {
      search: fuzzyAccountName(query),
      entities: JSON.stringify([{ name: 'account', selectcolumns: ['name'], searchcolumns: ['name'], filter: 'statecode eq 0' }]),
      top: accountSearchLimit,
      options: JSON.stringify({ querytype: 'lucene', searchmode: 'all', besteffortsearchenabled: 'false' })
    }, 'search')
    const ids = indexedAccountIds(response)
    if (ids.length === 0) return []
    const page = parseAccountSearchPage({ value: await this.requestByIds<AccountRow>(
      'accounts', 'accountid', ids, `${select},statecode`
    ) })
    return page.value
      .filter((row) => row.statecode === 0 && ids.includes(row.accountid.toLowerCase()))
      .sort((left, right) => ids.indexOf(left.accountid.toLowerCase()) - ids.indexOf(right.accountid.toLowerCase()))
  }

  private resolveAccountTpidField(): Promise<string> {
    this.accountTpidMetadataPromise ??= this.verifyAccountTpidField().catch((error: unknown) => {
      this.accountTpidMetadataPromise = undefined
      throw error
    })
    return this.accountTpidMetadataPromise
  }

  private async verifyAccountTpidField(): Promise<string> {
    const field = this.writeMetadata.accountTpidField ?? 'msp_mstopparentid'
    const url = new URL(`EntityDefinitions(LogicalName='account')/Attributes(LogicalName='${field}')`, this.baseUrl)
    url.searchParams.set('$select', 'LogicalName,AttributeType,IsValidForRead')
    let metadata: { LogicalName?: unknown; AttributeType?: unknown; IsValidForRead?: unknown }
    try {
      metadata = await this.requestJson(url)
    } catch (error) {
      if (error instanceof MsxRequestError && error.status === 404) {
        throw new Error('TPID lookup is unavailable. Set TLC_MSX_ACCOUNT_TPID_FIELD to the verified readable String field for this MSX environment.', { cause: error })
      }
      throw error
    }
    if (metadata.LogicalName !== field || metadata.AttributeType !== 'String' || metadata.IsValidForRead !== true) {
      throw new Error('The TPID field must be a verified readable String attribute. Check TLC_MSX_ACCOUNT_TPID_FIELD.')
    }
    this.accountTpidField = field
    return field
  }

  async addAccount(accountId: string): Promise<Account> {
    this.assertAccountId(accountId)
    const rows = await this.requestByIds<AccountRow>(
      'accounts',
      'accountid',
      [accountId],
      ['accountid', 'name', this.accountTpidField].filter(isPresent).join(',')
    )
    const row = rows[0]
    if (rows.length !== 1 || !row) throw new Error('The selected account is unavailable or inactive in MSX.')
    const preferences = await this.preferenceStore.addAccount(await this.getCurrentUserId(), accountId)
    const updated = this.getPortfolio().then((portfolio) => {
      const teamAccountIds = new Set(portfolio.accounts
        .filter((account) => account.provenance === 'deal-team' || account.provenance === 'both')
        .map((account) => account.id))
      const account = this.mapAccount(row, preferences, teamAccountIds)
      return {
        ...portfolio,
        accounts: [...portfolio.accounts.filter((item) => item.id !== accountId), account]
          .sort((left, right) => left.name.localeCompare(right.name))
      }
    }).catch((error: unknown) => {
      this.portfolioPromise = undefined
      throw error
    })
    this.portfolioPromise = updated
    const account = (await updated).accounts.find((candidate) => candidate.id === accountId)
    if (!account) throw new Error('The account preference was saved but the account could not be reloaded.')
    return structuredClone(account)
  }

  async setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account> {
    this.assertAccountId(accountId)
    const rows = await this.requestByIds<AccountRow>(
      'accounts',
      'accountid',
      [accountId],
      ['accountid', 'name', this.accountTpidField].filter(isPresent).join(',')
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
    const context = this.readContext.getStore()
    if (!context) return this.readMilestoneTeamMemberships()
    context.memberships ??= this.readMilestoneTeamMemberships().catch((error: unknown) => {
      delete context.memberships
      throw error
    })
    return context.memberships
  }

  private async readMilestoneTeamMemberships(userId?: string): Promise<Array<{ milestoneId: string }>> {
    const templateId = await this.resolveMilestoneTeamTemplateId().catch(() => undefined)
    if (!templateId) return []
    userId ??= await this.getCurrentUserId()
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
    await this.patch(`opportunities(${opportunityId})`, { msp_forecastcomments: update.comments })
    const opportunity = await this.reloadUpdatedOpportunity(opportunityId)
    if ((opportunity.comments ?? '') !== update.comments) {
      throw new MsxRequestError('MSX did not confirm the saved opportunity comments. Refresh the opportunity in MSX before retrying.', undefined, undefined, 'unknown')
    }
    return opportunity
  }

  async updateOpportunityStage(opportunityId: string, targetStage: number, auditNote: string): Promise<Opportunity> {
    if (!Number.isInteger(targetStage) || targetStage < 1 || targetStage > 5) {
      throw new Error('The target MCEM stage must be between 1 and 5.')
    }
    const stageCode = this.writeMetadata.stageCodes?.[targetStage as 1 | 2 | 3 | 4 | 5]
    if (stageCode === undefined) {
      throw new MsxRequestError(`Live MSX stage ${targetStage} writes require TLC_MSX_STAGE_${targetStage} to contain the tenant option code.`, undefined, undefined, 'not-dispatched')
    }
    await this.assertOpportunityAccess(opportunityId)
    const current = (await this.getPortfolio()).opportunities.find((candidate) => candidate.id === opportunityId)
    if (!current) throw new Error('The opportunity is not in the signed-in user’s active MSX portfolio.')
    const comments = [current.comments, auditNote].filter(Boolean).join('\n\n')
    await this.patch(`opportunities(${opportunityId})`, {
      msp_activesalesstage: stageCode,
      msp_forecastcomments: comments
    })
    return this.reloadUpdatedOpportunity(opportunityId)
  }

  private async reloadUpdatedOpportunity(opportunityId: string): Promise<Opportunity> {
    this.portfolioPromise = undefined
    this.observationPromises.delete(opportunityId)
    const context = this.readContext.getStore()
    if (context) {
      delete context.portfolio
      context.observations.delete(opportunityId)
    }
    const opportunity = (await this.getPortfolio()).opportunities.find((candidate) => candidate.id === opportunityId)
    if (!opportunity) throw new MsxRequestError('MSX accepted the opportunity update but it could not be reloaded. Check the record in MSX before retrying.', undefined, undefined, 'unknown')
    return structuredClone(opportunity)
  }

  async getOpportunityContext(opportunityId: string): Promise<OpportunityContext> {
    // Milestone rows do not depend on the portfolio read, so start them together; they are discarded
    // (and their failure swallowed) when the access gate below rejects the opportunity.
    if (guidPattern.test(opportunityId)) this.getMilestoneRows(opportunityId).catch(() => undefined)
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

    // Portfolio includes milestone-team opportunities as well as Deal Team opportunities.
    // Reuse its visible accounts for scope, but keep actual Deal Team membership separate.
    const portfolio = await this.getPortfolio()
    const accountNameById = new Map(
      portfolio.accounts
        .filter((account) => account.visibility !== 'hidden')
        .map((account) => [account.id, account.name])
    )
    const assignedAccountIds = [...accountNameById.keys()]
    if (assignedAccountIds.length === 0) return []
    const rows = await measurePerformance('msx.discover-opportunities', this.performanceReporter, () =>
      this.requestOpportunitiesForAccounts(assignedAccountIds, domainClauses))

    return rows
      .filter((row) => row._parentaccountid_value && accountNameById.has(row._parentaccountid_value))
      .map((row) => this.mapDiscoverableOpportunity(row, domain, accountNameById, portfolio.dealTeamOpportunityIds))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  getDiscoverySnapshot() {
    return this.withReadContext(async () => {
      const portfolio = await this.getPortfolio()
      const accountNames = new Map(portfolio.accounts.filter((account) => account.visibility !== 'hidden')
        .map((account) => [account.id, account.name]))
      const rows = accountNames.size === 0 ? [] : await measurePerformance('msx.discovery-snapshot', this.performanceReporter, () =>
        this.requestOpportunitiesForAccounts([...accountNames.keys()], []))
      const opportunities = rows.filter((row) => row._parentaccountid_value && accountNames.has(row._parentaccountid_value))
        .flatMap((row) => seDomainIds.flatMap((domain) => {
          const definition = getSeDomainDefinition(domain)
          const matches = (typeof row.msp_technicalcapability === 'number' && definition.technicalCapabilityCodes.includes(row.msp_technicalcapability))
            || (typeof row.msp_conversation === 'number' && definition.conversationCodes.includes(row.msp_conversation))
          if (!matches) return []
          return [this.mapDiscoverableOpportunity(row, domain, accountNames, portfolio.dealTeamOpportunityIds)]
        })).sort((left, right) => left.name.localeCompare(right.name))
      return {
        accounts: structuredClone(portfolio.accounts),
        portfolioOpportunities: structuredClone(portfolio.opportunities),
        opportunities,
        milestoneTeamOpportunityIds: portfolio.milestoneTeamOpportunityIds.filter((id) =>
          portfolio.opportunities.some((opportunity) => opportunity.id === id))
      }
    })
  }

  private mapDiscoverableOpportunity(row: OpportunityRow, domain: SeDomainId, accountNames: ReadonlyMap<string, string>, dealTeamOpportunityIds: ReadonlySet<string>): DiscoverableOpportunity {
    const accountName = accountNames.get(row._parentaccountid_value!) ?? formattedValue(row, '_parentaccountid_value')
    const solutionArea = formattedValue(row, 'msp_solutionarea')
    const technicalCapability = formattedValue(row, 'msp_technicalcapability')
    return {
      ...this.mapOpportunity(row), domain,
      ...(accountName ? { accountName } : {}),
      ...(solutionArea ? { solutionArea } : {}),
      ...(technicalCapability ? { technicalCapability } : {}),
      onDealTeam: dealTeamOpportunityIds.has(row.opportunityid)
    }
  }

  /** Fetches open opportunities within the given assigned accounts, filtered by the domain clauses. */
  private async requestOpportunitiesForAccounts(accountIds: string[], domainClauses: string[]): Promise<OpportunityRow[]> {
    const select = 'opportunityid,_parentaccountid_value,_ownerid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate,msp_forecastcomments,msp_solutionarea,msp_technicalcapability,msp_conversation,msp_opportunitytype'
    return this.collectChunks(accountIds, async (chunk) => {
      const accountFilter = chunk.map((id) => `_parentaccountid_value eq ${id}`).join(' or ')
      const filterClauses = ['statecode eq 0', `(${accountFilter})`, ...domainClauses]
      return this.requestAll<OpportunityRow>('opportunities', {
        '$select': select,
        '$filter': filterClauses.join(' and '),
        '$orderby': 'name asc'
      })
    })
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
    const membershipQuery = {
      '$select': 'msp_dealteamid',
      '$filter': `statecode eq 0 and ${dealTeam.userLookupField} eq ${userId} and ${dealTeam.opportunityLookupField} eq ${opportunityId}`,
      '$top': '2'
    }
    const existing = await this.requestAll<DealTeamMemberRow>(dealTeam.entitySet, membershipQuery)
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
    const remaining = await this.requestAll<DealTeamMemberRow>(dealTeam.entitySet, membershipQuery)
    if (remaining.length > 0) {
      throw new Error('MSX still reports you on this Deal Team after the delete request. Removal could not be confirmed. Refresh and try again.')
    }
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

  async getOpportunityEvidence(opportunityId: string): Promise<OpportunityEvidence> {
    if (!guidPattern.test(opportunityId)) throw new Error('The opportunity id must be a valid MSX GUID.')
    const portfolio = await this.getPortfolio()
    if (!portfolio.opportunities.some((opportunity) => opportunity.id === opportunityId)) {
      throw new Error('The opportunity is not in the signed-in user’s active MSX portfolio.')
    }
    const gaps: string[] = []
    // Each sub-read stands alone: a field or privilege missing in one environment must not discard the rest.
    // `optional` reads (history fields that older environments lack) stay silent on a 400.
    const attempt = async <T>(label: string, fallback: T, read: () => Promise<T>, optional = false): Promise<T> => {
      try {
        return await read()
      } catch (error) {
        this.readContext.getStore()?.signal?.throwIfAborted()
        const status = error instanceof MsxRequestError ? error.status : undefined
        if (!(optional && status === 400)) gaps.push(`${label} could not be read${status ? ` (HTTP ${status})` : ''}.`)
        return fallback
      }
    }
    const filter = `_regardingobjectid_value eq ${opportunityId}`
    const categoryField = this.writeMetadata.taskCategoryField
    const activitySelect = (extra: string[]) => ['activityid', 'subject', 'description', 'statecode', 'scheduledend', 'createdon', '_ownerid_value', ...extra].join(',')

    const milestoneRows = await attempt('Milestones', [] as MilestoneRow[], () => this.getMilestoneRows(opportunityId))
    const milestoneIds = milestoneRows.map((row) => row.msp_engagementmilestoneid)
    type Row = Record<string, unknown>
    const [details, historyRaw, notes, activities, milestoneHistoryRaw, milestoneTasks, dealTeam] = await Promise.all([
      attempt<Row | undefined>('Opportunity details', undefined, () => this.requestJson<Row>(
        `opportunities(${opportunityId})?$select=description,createdon,modifiedon,msp_solutionarea,msp_technicalcapability,msp_conversation`)),
      attempt<Row | undefined>('Opportunity comment history', undefined, () => this.requestJson<Row>(
        `opportunities(${opportunityId})?$select=${commentHistoryField}`), true),
      attempt('Opportunity notes', [] as Row[], () => this.requestAll<Row>('annotations', {
        '$select': 'subject,notetext,createdon,_createdby_value',
        '$filter': `_objectid_value eq ${opportunityId} and isdocument eq false`,
        '$orderby': 'createdon desc',
        '$top': String(evidenceRowLimit)
      })),
      attempt('Opportunity activities', [] as TaskRow[], () => this.requestAll<TaskRow>('activitypointers', {
        '$select': activitySelect(['activitytypecode']),
        '$filter': filter,
        '$orderby': 'createdon desc',
        '$top': String(evidenceRowLimit)
      })),
      attempt('Milestone comment history', [] as Row[], () => this.requestAll<Row>('msp_engagementmilestones', {
        '$select': `msp_engagementmilestoneid,${commentHistoryField}`,
        '$filter': `statecode eq 0 and _msp_opportunityid_value eq ${opportunityId}`
      }), true),
      attempt('Milestone activities', [] as TaskRow[], () => this.collectChunks(milestoneIds, (chunk) => this.requestAll<TaskRow>('tasks', {
        '$select': activitySelect(['_regardingobjectid_value', 'prioritycode', ...(categoryField ? [categoryField] : [])]),
        '$filter': chunk.map((id) => `_regardingobjectid_value eq ${id}`).join(' or '),
        '$orderby': 'createdon desc',
        '$top': String(evidenceRowLimit * 4)
      }))),
      attempt('Deal team', [] as Row[], () => this.requestAll<Row>('msp_dealteams', {
        '$select': '_msp_dealteamuserid_value',
        '$filter': `statecode eq 0 and _msp_parentopportunityid_value eq ${opportunityId}`,
        '$top': '50'
      }))
    ])

    const opportunityHistory = parseCommentHistoryRows(historyRaw?.[commentHistoryField])
    const milestoneHistory = new Map(milestoneHistoryRaw.map((row) => [String(row.msp_engagementmilestoneid), parseCommentHistoryRows(row[commentHistoryField])]))
    const userIds = unique([...opportunityHistory, ...[...milestoneHistory.values()].flat()].map((row) => row.userId).filter(isPresent)).slice(0, 80)
    const names = await attempt('Comment author names', new Map<string, string>(), async () => new Map(
      (await this.collectChunks(userIds, (chunk) => this.requestAll<{ systemuserid: string; fullname?: string }>('systemusers', {
        '$select': 'systemuserid,fullname',
        '$filter': chunk.map((id) => `systemuserid eq ${id}`).join(' or ')
      }))).flatMap((user) => user.fullname ? [[user.systemuserid.toLowerCase(), user.fullname] as const] : [])
    ), true)
    const authorOf = (userId: string) => names.get(userId.toLowerCase())

    const tasksByMilestone = new Map<string, EvidenceEntry[]>()
    for (const row of milestoneTasks) {
      const milestoneId = typeof row._regardingobjectid_value === 'string' ? row._regardingobjectid_value : undefined
      if (!milestoneId) continue
      tasksByMilestone.set(milestoneId, [...(tasksByMilestone.get(milestoneId) ?? []), this.toActivityEntry(row)])
    }
    const retrievedAt = new Date().toISOString()
    const dealTeamNames = unique(dealTeam.map((row) => formattedValue(row, '_msp_dealteamuserid_value')).filter(isPresent))
    const detailRow: Record<string, unknown> = details ?? {}
    const need = plainText(detailRow.description)
    const optionDetail = (field: string) => formattedValue(detailRow, field)
    const createdOn = isoTimestamp(detailRow.createdon)
    const modifiedOn = isoTimestamp(detailRow.modifiedon)
    return {
      details: {
        ...(need ? { need } : {}),
        ...(optionDetail('msp_solutionarea') ? { solutionArea: optionDetail('msp_solutionarea')! } : {}),
        ...(optionDetail('msp_technicalcapability') ? { technicalCapability: optionDetail('msp_technicalcapability')! } : {}),
        ...(optionDetail('msp_conversation') ? { conversation: optionDetail('msp_conversation')! } : {}),
        ...(createdOn ? { createdOn } : {}),
        ...(modifiedOn ? { modifiedOn } : {}),
        ...(dealTeamNames.length > 0 ? { dealTeam: dealTeamNames } : {})
      },
      commentHistory: commentHistoryEntries(opportunityHistory, authorOf, evidenceRowLimit),
      notes: notes.flatMap((row): EvidenceEntry[] => {
        const text = plainText(row.notetext, 2_000)
        const subject = plainText(row.subject, 200)
        if (!text && !subject) return []
        const at = isoTimestamp(row.createdon)
        const author = formattedValue(row, '_createdby_value')
        return [{ kind: 'note', text: text || subject, ...(text && subject ? { subject } : {}), ...(at ? { at } : {}), ...(author ? { author } : {}) }]
      }),
      activities: activities.map((row) => this.toActivityEntry(row)),
      milestones: milestoneIds.map((milestoneId) => ({
        milestoneId,
        commentHistory: commentHistoryEntries(milestoneHistory.get(milestoneId) ?? [], authorOf, evidenceRowLimit),
        activities: (tasksByMilestone.get(milestoneId) ?? []).sort(newestFirst).slice(0, evidenceRowLimit)
      })),
      gaps,
      retrievedAt,
      sourceHealth: {
        source: 'msx',
        state: gaps.length > 0 ? 'partial' : 'live',
        detail: gaps.length > 0
          ? `Live MSX evidence was read with gaps: ${gaps.join(' ')}`
          : 'Live MSX comment history, notes, and activities for the opportunity and its milestones.',
        checkedAt: retrievedAt
      }
    }
  }

  private toActivityEntry(row: TaskRow): EvidenceEntry {
    const type = formattedValue(row, 'activitytypecode')
    const subject = plainText(row.subject, 200) || 'Untitled activity'
    const text = plainText(row.description, 1_500)
    const at = isoTimestamp(row.createdon)
    const author = formattedValue(row, '_ownerid_value')
    return {
      kind: 'activity',
      text,
      subject: type ? `${type}: ${subject}` : subject,
      ...(at ? { at } : {}),
      ...(author ? { author } : {}),
      status: typeof row.statecode === 'number' ? (taskStatusByState[row.statecode] ?? 'Open') : 'Open',
      ...(row.scheduledend ? { due: row.scheduledend.slice(0, 10) } : {})
    }
  }

  private resolveMilestoneTeamTemplateId(): Promise<string> {
    const configured = resolveMilestoneTeamAccessMetadata(this.writeMetadata.milestoneTeam)
    if (configured.templateId && guidPattern.test(configured.templateId)) {
      return Promise.resolve(configured.templateId)
    }
    const context = this.scopedReads()
    if (context) {
      context.template ??= this.discoverMilestoneTeamTemplateId(configured.templateName).catch((error: unknown) => {
        delete context.template
        throw error
      })
      return context.template
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

  async getConcurrencyTokens(opportunityId: string): Promise<Record<string, string>> {
    const milestones = await this.getMilestoneRows(opportunityId)
    const paths = [`opportunities(${opportunityId})`, ...milestones.map((row) => `msp_engagementmilestones(${row.msp_engagementmilestoneid})`)]
    const result: Record<string, string> = {}
    for (const path of paths) {
      const token = (this.readContext.getStore()?.versions ?? this.entityVersions).get(path.toLowerCase())
      if (token) result[path.toLowerCase()] = token
    }
    return result
  }

  withExpectedVersions<T>(versions: Readonly<Record<string, string>>, operation: () => Promise<T>, verifyAccessToken?: (token: string) => void, onDispatch?: () => void): Promise<T> {
    return this.expectedVersions.run({ versions: { ...versions }, ...(verifyAccessToken ? { verifyAccessToken } : {}), ...(onDispatch ? { onDispatch } : {}) }, operation)
  }

  private rememberNativeVersions(value: unknown): void {
    const versions = this.readContext.getStore()?.versions ?? this.entityVersions
    const remember = (row: unknown) => {
      if (!isObjectRecord(row)) return
      const records: ReadonlyArray<readonly [string, string]> = [
        ['opportunityid', 'opportunities'], ['msp_engagementmilestoneid', 'msp_engagementmilestones'],
        ['msp_dealteamid', this.writeMetadata.dealTeam?.entitySet ?? defaultDealTeamWriteMetadata.entitySet]
      ]
      for (const [field, set] of records) {
        const id = row[field]
        if (typeof id !== 'string' || !guidPattern.test(id)) continue
        const path = `${set}(${id})`.toLowerCase()
        versions.delete(path)
        if ('@odata.etag' in row && typeof row['@odata.etag'] === 'string' && /^(?:W\/)?"[A-Za-z0-9-]{1,100}"$/.test(row['@odata.etag'])) {
          versions.set(path, row['@odata.etag'])
        }
      }
    }
    if (value && typeof value === 'object' && 'value' in value && Array.isArray(value.value)) value.value.forEach(remember)
    else remember(value)
  }

  /** Returns the signed-in user's Dataverse systemuser id (WhoAmI UserId), cached for reuse. */
  getCurrentUserId(): Promise<string> {
    const context = this.scopedReads()
    if (context) {
      context.identity ??= this.requestJson<WhoAmIResponse>('WhoAmI').then((identity) => identity.UserId).catch((error: unknown) => {
        delete context.identity
        throw error
      })
      return context.identity
    }
    this.currentUserIdPromise ??= this.requestJson<WhoAmIResponse>('WhoAmI')
      .then((identity) => identity.UserId)
      .catch((error) => {
        this.currentUserIdPromise = undefined
        throw error
      })
    return this.currentUserIdPromise
  }

  /** Read-only, bounded Dataverse read for dashboard sources. Entity-set names are plain identifiers; every page stays on the trusted origin. */
  async readRows(entitySet: string, parameters: Record<string, string>): Promise<Array<Record<string, unknown>>> {
    if (!navigationPropertyPattern.test(entitySet)) throw new Error('The entity set name is invalid.')
    return this.requestAll<Record<string, unknown>>(entitySet, parameters)
  }

  async getTeamMemberships() {
    const userId = await this.getCurrentUserId()
    const [dealTeamOpportunityIds, milestoneTeamOpportunityIds, milestoneIds] = await Promise.all([
      this.listDealTeamOpportunityIds(userId), this.milestoneTeamOpportunityIds(), this.milestoneTeamMilestoneIds()
    ])
    return { dealTeamOpportunityIds, milestoneTeamOpportunityIds, milestoneTeamMilestoneIds: [...milestoneIds] }
  }

  /** Opportunity ids on the given user's active deal teams. */
  async listDealTeamOpportunityIds(userId: string): Promise<string[]> {
    if (!guidPattern.test(userId)) throw new Error('The user id must be a valid MSX GUID.')
    const rows = await this.requestAll<DealTeamRow>('msp_dealteams', {
      '$select': '_msp_parentopportunityid_value',
      '$filter': `statecode eq 0 and _msp_dealteamuserid_value eq ${userId}`
    })
    return unique(rows.map((row) => row._msp_parentopportunityid_value).filter(isPresent))
  }

  /** Milestone ids on the given user's milestone-team (access team) memberships. */
  async listMilestoneTeamMilestoneIds(userId: string): Promise<string[]> {
    if (!guidPattern.test(userId)) throw new Error('The user id must be a valid MSX GUID.')
    return unique((await this.readMilestoneTeamMemberships(userId)).map((membership) => membership.milestoneId))
  }

  /** Parent opportunity ids of the given user's milestone-team (access team) memberships. */
  async listMilestoneTeamOpportunityIds(userId: string): Promise<string[]> {
    if (!guidPattern.test(userId)) throw new Error('The user id must be a valid MSX GUID.')
    const memberships = await this.readMilestoneTeamMemberships(userId)
    if (memberships.length === 0) return []
    const rows = await this.requestByIds<{ msp_engagementmilestoneid: string; _msp_opportunityid_value?: string }>(
      'msp_engagementmilestones', 'msp_engagementmilestoneid',
      unique(memberships.map((membership) => membership.milestoneId)), 'msp_engagementmilestoneid,_msp_opportunityid_value'
    )
    return unique(rows.map((row) => row._msp_opportunityid_value).filter(isPresent))
  }

  async assertNativeIdentity(entraObjectId: string): Promise<string> {
    const userId = await this.getCurrentUserId()
    if (!guidPattern.test(entraObjectId) || !guidPattern.test(userId)) throw new Error('The native source identity mapping is invalid.')
    const user = await this.requestJson<unknown>(`systemusers(${userId})?$select=azureactivedirectoryobjectid,isdisabled`)
    if (!isObjectRecord(user) || user['isdisabled'] !== false ||
        typeof user['azureactivedirectoryobjectid'] !== 'string' ||
        user['azureactivedirectoryobjectid'].toLowerCase() !== entraObjectId.toLowerCase()) {
      throw new Error('The native source identity is absent, disabled or belongs to another Entra subject.')
    }
    return userId
  }

  private async assertOpportunityAccess(opportunityId: string): Promise<void> {
    if (!(await this.getPortfolio()).opportunities.some((opportunity) => opportunity.id === opportunityId)) {
      throw new Error('The opportunity is not in the signed-in user’s active MSX portfolio.')
    }
  }

  private getOpportunityObservations(opportunity: Opportunity): Promise<CriterionObservation[]> {
    const promises = this.scopedReads()?.observations ?? this.observationPromises
    let observations = promises.get(opportunity.id)
    if (!observations) {
      observations = measurePerformance('msx.opportunity-evidence', this.performanceReporter, async () => {
        const milestones = await this.getMilestoneRows(opportunity.id)
        return mapOpportunityObservations(opportunity, milestones)
      }).catch((error: unknown) => {
        promises.delete(opportunity.id)
        throw error
      })
      promises.set(opportunity.id, observations)
    }
    return observations
  }

  private getMilestoneRows(opportunityId: string): Promise<MilestoneRow[]> {
    const promises = this.scopedReads()?.milestones ?? this.milestonePromises
    let milestones = promises.get(opportunityId)
    if (!milestones) {
      milestones = this.requestAll<MilestoneRow>('msp_engagementmilestones', {
        '$select': ['msp_engagementmilestoneid', 'msp_name', '_ownerid_value', 'msp_milestonedate', 'msp_milestonestatus', 'msp_commitmentrecommendation', 'msp_monthlyuse', 'msp_forecastcomments', this.writeMetadata.riskDetailsField].filter(Boolean).join(','),
        '$filter': `statecode eq 0 and _msp_opportunityid_value eq ${opportunityId}`,
        '$orderby': 'msp_milestonedate asc'
      }).catch((error: unknown) => {
        promises.delete(opportunityId)
        throw error
      })
      promises.set(opportunityId, milestones)
    }
    return milestones
  }

  private getPortfolio(): Promise<MsxPortfolio> {
    if (this.cacheOptions.cachePortfolio === false || this.readContext.getStore()?.fresh) {
      const context = this.readContext.getStore()
      if (!context) return this.loadPortfolio()
      context.portfolio ??= this.loadPortfolio()
      return context.portfolio
    }
    this.portfolioPromise ??= this.loadPortfolio().catch((error: unknown) => {
      this.portfolioPromise = undefined
      throw error
    })
    return this.portfolioPromise
  }

  withReadContext<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const existing = this.readContext.getStore()
    if (existing && !signal) {
      existing.signal?.throwIfAborted()
      return operation()
    }
    return this.readContext.run({ milestones: new Map(), observations: new Map(), versions: new Map(), ...(signal ? { signal } : {}) }, operation)
  }

  withFreshReadContext<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const existing = this.readContext.getStore()
    if (existing?.fresh && !signal) return operation()
    return this.readContext.run({
      fresh: true, milestones: new Map(), observations: new Map(), versions: new Map(),
      ...(signal ? { signal } : existing?.signal ? { signal: existing.signal } : {})
    }, operation)
  }

  private scopedReads() {
    const context = this.readContext.getStore()
    return this.cacheOptions.cachePortfolio === false || context?.signal || context?.fresh ? context : undefined
  }

  private async loadPortfolio(): Promise<MsxPortfolio> {
    const userId = await measurePerformance('msx.identity', this.performanceReporter, () => this.getCurrentUserId())
    const [preferences, dealTeamRows, milestoneOpportunityIds] = await Promise.all([
      this.preferenceStore.read(userId),
      measurePerformance('msx.deal-team', this.performanceReporter, () => this.requestAll<DealTeamRow>('msp_dealteams', {
        '$select': '_msp_parentopportunityid_value',
        '$filter': `statecode eq 0 and _msp_dealteamuserid_value eq ${userId}`
      })),
      measurePerformance('msx.milestone-team', this.performanceReporter, () => this.milestoneTeamOpportunityIds())
    ])
    const dealTeamOpportunityIds = new Set(dealTeamRows.map((row) => row._msp_parentopportunityid_value).filter(isPresent))
    const opportunityIds = unique([
      ...dealTeamOpportunityIds,
      ...milestoneOpportunityIds
    ])
    const opportunityRows = await measurePerformance('msx.opportunities', this.performanceReporter, () => this.requestByIds<OpportunityRow>(
      'opportunities',
      'opportunityid',
      opportunityIds,
      'opportunityid,statecode,_parentaccountid_value,_ownerid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate,msp_forecastcomments,msp_opportunitytype'
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
      ['accountid', 'name', this.accountTpidField].filter(isPresent).join(',')
    ))
    const accounts = accountRows
      .map((row) => this.mapAccount(row, preferences, new Set(dealTeamAccountIds)))
      .sort((left, right) => left.name.localeCompare(right.name))
    const visibleAccountIds = new Set(accounts.filter((account) => account.visibility !== 'hidden').map((account) => account.id))
    const opportunities = activeOpportunities
      .filter((row) => row._parentaccountid_value && visibleAccountIds.has(row._parentaccountid_value))
      .map((row) => this.mapOpportunity(row))
      .sort((left, right) => left.name.localeCompare(right.name))

    return { accounts, opportunities, dealTeamOpportunityIds, milestoneTeamOpportunityIds: milestoneOpportunityIds }
  }

  private mapAccount(
    row: AccountRow,
    preferences: PortfolioPreferences = { manualAccountIds: [], hiddenAccountIds: [], revision: 0 },
    dealTeamAccountIds: ReadonlySet<string> = new Set()
  ): Account {
    const manual = preferences.manualAccountIds.includes(row.accountid)
    const dealTeam = dealTeamAccountIds.has(row.accountid)
    const tpidField = this.accountTpidField
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
    const opportunityIntent = formattedValue(row, 'msp_opportunitytype')
      ?.split(';')
      .map((value) => value.trim())
      .filter(Boolean)

    return {
      id: row.opportunityid,
      accountId: row._parentaccountid_value!,
      name: row.name,
      ...(formattedValue(row, '_ownerid_value') ? { owner: formattedValue(row, '_ownerid_value') } : {}),
      ...(opportunityIntent?.length ? { opportunityIntent } : {}),
      recordedStage,
      value: row.estimatedvalue || row.msp_consumptionconsumedrecurring || 0,
      currency: 'USD',
      closeDate: closeDate?.slice(0, 10) ?? '1970-01-01',
      ...(typeof row.msp_forecastcomments === 'string' ? { comments: row.msp_forecastcomments } : {})
    }
  }

  private async requestByIds<T>(
    entitySet: string,
    idField: string,
    ids: string[],
    select: string
  ): Promise<T[]> {
    return this.collectChunks(ids, (chunk) => {
      const idFilter = chunk.map((id) => `${idField} eq ${id}`).join(' or ')
      return this.requestAll<T>(entitySet, {
        '$select': select,
        '$filter': `statecode eq 0 and (${idFilter})`
      })
    })
  }

  private async collectChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
    const rows: T[] = []
    for (let offset = 0; offset < ids.length; offset += 80) {
      this.readContext.getStore()?.signal?.throwIfAborted()
      const chunks = [ids.slice(offset, offset + 40), ids.slice(offset + 40, offset + 80)].filter((chunk) => chunk.length > 0)
      rows.push(...(await Promise.all(chunks.map(read))).flat())
    }
    return rows
  }

  private async requestAll<T>(entitySet: string, parameters: Record<string, string>): Promise<T[]> {
    const firstUrl = new URL(entitySet, this.baseUrl)
    for (const [name, value] of Object.entries(parameters)) firstUrl.searchParams.set(name, value)

    const rows: T[] = []
    let nextUrl: URL | undefined = firstUrl
    while (nextUrl) {
      this.readContext.getStore()?.signal?.throwIfAborted()
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
    const signal = this.readContext.getStore()?.signal
    signal?.throwIfAborted()
    const accessToken = await this.tokenProvider.getAccessToken()
    signal?.throwIfAborted()
    return measurePerformance('msx.http.read', this.performanceReporter, async () => {
      const response = await this.fetchImplementation(url, {
        ...(signal ? { signal } : {}),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=500'
        }
      })
      signal?.throwIfAborted()
      if (!response.ok) {
        const retry = response.headers.get('retry-after')
        const retryAfterMs = retry === null ? undefined : /^\d+$/.test(retry)
          ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())
        throw new MsxRequestError(`MSX request failed with status ${response.status}.`, response.status,
          retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? retryAfterMs : undefined)
      }
      const result: unknown = await response.json()
      signal?.throwIfAborted()
      this.rememberNativeVersions(result)
      return result as T
    })
  }

  private async patch(path: string, body: Record<string, unknown>): Promise<void> {
    const url = new URL(path, this.baseUrl)
    this.assertTrustedUrl(url)
    const expected = this.expectedVersions.getStore()
    const conditional = this.cacheOptions.requireConditionalWrites || expected !== undefined
    const version = conditional ? expected?.versions[path.toLowerCase()] : '*'
    if (!version || conditional && !/^(?:W\/)?"[A-Za-z0-9-]{1,100}"$/.test(version)) {
      throw new MsxRequestError('A reviewed native concurrency token is required before this update.', undefined, undefined, 'not-dispatched')
    }
    const accessToken = await this.writeAccessToken()
    this.expectedVersions.getStore()?.onDispatch?.()
    const response = await this.fetchImplementation(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'If-Match': version
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      throw new MsxRequestError(`MSX update failed with status ${response.status}${await serviceErrorDetail(response)}.`, response.status)
    }
    if (conditional && expected) {
      const next = response.headers.get('etag')
      if (next && /^(?:W\/)?"[A-Za-z0-9-]{1,100}"$/.test(next)) expected.versions[path.toLowerCase()] = next
      else delete expected.versions[path.toLowerCase()]
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<void> {
    const url = new URL(path, this.baseUrl)
    this.assertTrustedUrl(url)
    const accessToken = await this.writeAccessToken()
    this.expectedVersions.getStore()?.onDispatch?.()
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
      throw new MsxRequestError(`MSX create failed with status ${response.status}${await serviceErrorDetail(response)}.`, response.status)
    }
  }

  /** searchquery is a read-only POST action; other callers create records. */
  private async postReturningEntity<T>(path: string, body: Record<string, unknown>, operation: 'create' | 'search' = 'create'): Promise<T> {
    const url = new URL(path, this.baseUrl)
    this.assertTrustedUrl(url)
    const accessToken = operation === 'search' ? await this.tokenProvider.getAccessToken() : await this.writeAccessToken()
    if (operation === 'create') this.expectedVersions.getStore()?.onDispatch?.()
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
      const detail = operation === 'search' ? '' : await serviceErrorDetail(response)
      throw new MsxRequestError(`MSX ${operation} failed with status ${response.status}${detail}.`, response.status)
    }
    return await response.json() as T
  }

  private async delete(path: string): Promise<void> {
    const url = new URL(path, this.baseUrl)
    this.assertTrustedUrl(url)
    const expected = this.expectedVersions.getStore()
    const conditional = this.cacheOptions.requireConditionalWrites || expected !== undefined
    const version = conditional ? expected?.versions[path.toLowerCase()]
      ?? (this.readContext.getStore()?.versions ?? this.entityVersions).get(path.toLowerCase()) : '*'
    if (!version || conditional && !/^(?:W\/)?"[A-Za-z0-9-]{1,100}"$/.test(version)) {
      throw new MsxRequestError('A verified native membership concurrency token is required before removal.', undefined, undefined, 'not-dispatched')
    }
    const accessToken = await this.writeAccessToken()
    this.expectedVersions.getStore()?.onDispatch?.()
    const response = await this.fetchImplementation(url, {
      method: 'DELETE',
      headers: {
        Authorization: ['Bearer', accessToken].join(' '),
        Accept: 'application/json',
        'If-Match': version
      }
    })
    if (!response.ok) {
      throw new MsxRequestError(`MSX delete failed with status ${response.status}${await serviceErrorDetail(response)}.`, response.status)
    }
  }

  private async writeAccessToken(): Promise<string> {
    const token = await this.tokenProvider.getAccessToken()
    this.expectedVersions.getStore()?.verifyAccessToken?.(token)
    return token
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function formattedValue(row: Record<string, unknown>, field: string): string | undefined {
  const value = row[`${field}${formattedValueSuffix}`]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Dataverse's own error text so a bare status code is actionable; never includes request data. A missing-privilege denial is summarized without the principal's internal identifiers. */
async function serviceErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: unknown } }
    const message = typeof body?.error?.message === 'string' ? body.error.message : ''
    // eslint-disable-next-line no-control-regex
    const text = message.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
    const privilege = /\bis missing (prv[A-Za-z0-9_]{1,80})/.exec(text)?.[1]
    if (privilege) return ` (your MSX security role is missing the ${privilege} privilege; ask an MSX administrator to grant it or to make this change for you)`
    const summary = text.replace(/\.$/, '').slice(0, 300)
    return summary ? ` (MSX said: ${summary})` : ''
  } catch {
    return ''
  }
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