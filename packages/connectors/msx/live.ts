import {
  customerCommitmentSchema,
  getSeDomainDefinition,
  measurePerformance,
  milestoneStatusSchema,
  milestoneUpdateSchema,
  opportunityUpdateSchema,
  type Account,
  type CustomerCommitment,
  type DealTeamJoinResult,
  type DiscoverableOpportunity,
  type Milestone,
  type MilestoneStatus,
  type MilestoneUpdate,
  type Opportunity,
  type OpportunityUpdate,
  type PerformanceReporter,
  type SeDomainId
} from '../../common/index.js'
import type { CriterionObservation, MsxConnector, OpportunityContext } from '../common/index.js'

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
}

interface OpportunityRow {
  opportunityid: string
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

/** Derives a lookup attribute logical name (e.g. `msp_dealteamuserid`) from its `_x_value` field. */
function lookupAttributeName(valueField: string): string {
  return valueField.replace(/^_/, '').replace(/_value$/, '')
}

export interface MsxWriteMetadata {
  riskDetailsField?: string
  milestoneStatusCodes?: Partial<Record<MilestoneStatus, number>>
  stageCodes?: Partial<Record<1 | 2 | 3 | 4 | 5, number>>
  dealTeam?: Partial<MsxDealTeamWriteMetadata>
}

const navigationPropertyPattern = /^[A-Za-z][A-Za-z0-9_]*$/

export function msxWriteMetadataFromEnvironment(environment: NodeJS.ProcessEnv): MsxWriteMetadata {
  const riskDetailsField = environment['TLC_MSX_RISK_DETAILS_FIELD']?.trim()
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
  return {
    ...(riskDetailsField ? { riskDetailsField } : {}),
    ...(Object.keys(configuredCodes).length > 0 ? { milestoneStatusCodes: configuredCodes } : {}),
    ...(Object.keys(stageCodes).length > 0 ? { stageCodes } : {}),
    ...(Object.keys(dealTeam).length > 0 ? { dealTeam } : {})
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

  constructor(
    private readonly tokenProvider: MsxAccessTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
    baseUrl = defaultBaseUrl,
    private readonly performanceReporter?: PerformanceReporter,
    private readonly writeMetadata: MsxWriteMetadata = {}
  ) {
    this.baseUrl = new URL(baseUrl)
    if (writeMetadata.riskDetailsField && !/^[A-Za-z][A-Za-z0-9_]*$/.test(writeMetadata.riskDetailsField)) {
      throw new Error('The MSX risk details logical field name is invalid.')
    }
  }

  async listAccounts(): Promise<Account[]> {
    const portfolio = await this.getPortfolio()
    return structuredClone(portfolio.accounts)
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
      ...(typeof row.msp_forecastcomments === 'string' ? { comments: row.msp_forecastcomments } : {})
    }))
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
    const accountNameById = new Map(portfolio.accounts.map((account) => [account.id, account.name]))
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

  /**
   * Resolves the single-valued navigation property names used to bind a deal-team row to the
   * systemuser and opportunity. Prefers explicit configuration, then live relationship metadata,
   * then a conventional fallback derived from the lookup field names. The metadata lookup is cached.
   */
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
    const identity = await measurePerformance('msx.identity', this.performanceReporter, () =>
      this.requestJson<WhoAmIResponse>('WhoAmI'))
    const dealTeamRows = await measurePerformance('msx.deal-team', this.performanceReporter, () => this.requestAll<DealTeamRow>('msp_dealteams', {
      '$select': '_msp_parentopportunityid_value',
      '$filter': `statecode eq 0 and _msp_dealteamuserid_value eq ${identity.UserId}`
    }))
    const opportunityIds = unique(
      dealTeamRows.map((row) => row._msp_parentopportunityid_value).filter(isPresent)
    )
    const opportunityRows = await measurePerformance('msx.opportunities', this.performanceReporter, () => this.requestByIds<OpportunityRow>(
      'opportunities',
      'opportunityid',
      opportunityIds,
      'opportunityid,_parentaccountid_value,_ownerid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate,description'
    ))
    const activeOpportunities = opportunityRows.filter((row) => row._parentaccountid_value)
    const accountIds = unique(
      activeOpportunities.map((row) => row._parentaccountid_value).filter(isPresent)
    )
    const accountRows = await measurePerformance('msx.accounts', this.performanceReporter, () => this.requestByIds<AccountRow>(
      'accounts',
      'accountid',
      accountIds,
      'accountid,name'
    ))
    const accounts = accountRows
      .map((row) => ({ id: row.accountid, name: row.name, segment: 'Live MSX' }))
      .sort((left, right) => left.name.localeCompare(right.name))
    const accessibleAccountIds = new Set(accounts.map((account) => account.id))
    const opportunities = activeOpportunities
      .filter((row) => row._parentaccountid_value && accessibleAccountIds.has(row._parentaccountid_value))
      .map((row) => this.mapOpportunity(row))
      .sort((left, right) => left.name.localeCompare(right.name))

    return { accounts, opportunities }
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