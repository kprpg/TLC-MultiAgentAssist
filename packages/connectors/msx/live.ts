import { measurePerformance, type Account, type Opportunity, type PerformanceReporter } from '../../common/index.js'
import type { CriterionObservation, MsxConnector, OpportunityContext } from '../common/index.js'

const defaultBaseUrl = 'https://microsoftsales.crm.dynamics.com/api/data/v9.2/'
const formattedValueSuffix = '@OData.Community.Display.V1.FormattedValue'

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
  name: string
  msp_activesalesstage?: number
  estimatedvalue?: number
  msp_consumptionconsumedrecurring?: number
  msp_estcompletiondate?: string
  estimatedclosedate?: string
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

  constructor(
    private readonly tokenProvider: MsxAccessTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
    baseUrl = defaultBaseUrl,
    private readonly performanceReporter?: PerformanceReporter
  ) {
    this.baseUrl = new URL(baseUrl)
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

  refresh(): void {
    this.portfolioPromise = undefined
    this.observationPromises.clear()
  }

  private getOpportunityObservations(opportunity: Opportunity): Promise<CriterionObservation[]> {
    let observations = this.observationPromises.get(opportunity.id)
    if (!observations) {
      observations = measurePerformance('msx.opportunity-evidence', this.performanceReporter, async () => {
        const milestones = await this.requestAll<MilestoneRow>('msp_engagementmilestones', {
          '$select': 'msp_engagementmilestoneid,msp_name,_ownerid_value,msp_milestonedate,msp_milestonestatus,msp_commitmentrecommendation,msp_monthlyuse',
          '$filter': `statecode eq 0 and _msp_opportunityid_value eq ${opportunity.id}`,
          '$orderby': 'msp_milestonedate asc'
        })
        return mapOpportunityObservations(opportunity, milestones)
      }).catch((error: unknown) => {
        this.observationPromises.delete(opportunity.id)
        throw error
      })
      this.observationPromises.set(opportunity.id, observations)
    }
    return observations
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
      'opportunityid,_parentaccountid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate'
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
      recordedStage,
      value: row.estimatedvalue ?? row.msp_consumptionconsumedrecurring ?? 0,
      currency: 'USD',
      closeDate: closeDate?.slice(0, 10) ?? '1970-01-01'
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