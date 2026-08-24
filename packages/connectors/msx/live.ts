import type { Account, Opportunity } from '../../common/index.js'
import type { MsxConnector, OpportunityContext } from '../common/index.js'

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

  constructor(
    private readonly tokenProvider: MsxAccessTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
    baseUrl = defaultBaseUrl
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
    return {
      account: structuredClone(account),
      opportunity: structuredClone(opportunity),
      observations: [],
      retrievedAt,
      sourceHealth: {
        source: 'msx',
        state: 'live',
        detail: 'Live MSX data scoped to active opportunities where the signed-in user is on the deal team.',
        checkedAt: retrievedAt
      }
    }
  }

  refresh(): void {
    this.portfolioPromise = undefined
  }

  private getPortfolio(): Promise<{ accounts: Account[]; opportunities: Opportunity[] }> {
    this.portfolioPromise ??= this.loadPortfolio().catch((error: unknown) => {
      this.portfolioPromise = undefined
      throw error
    })
    return this.portfolioPromise
  }

  private async loadPortfolio(): Promise<{ accounts: Account[]; opportunities: Opportunity[] }> {
    const identity = await this.requestJson<WhoAmIResponse>('WhoAmI')
    const dealTeamRows = await this.requestAll<DealTeamRow>('msp_dealteams', {
      '$select': '_msp_parentopportunityid_value',
      '$filter': `statecode eq 0 and _msp_dealteamuserid_value eq ${identity.UserId}`
    })
    const opportunityIds = unique(
      dealTeamRows.map((row) => row._msp_parentopportunityid_value).filter(isPresent)
    )
    const opportunityRows = await this.requestByIds<OpportunityRow>(
      'opportunities',
      'opportunityid',
      opportunityIds,
      'opportunityid,_parentaccountid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate'
    )
    const activeOpportunities = opportunityRows.filter((row) => row._parentaccountid_value)
    const accountIds = unique(
      activeOpportunities.map((row) => row._parentaccountid_value).filter(isPresent)
    )
    const accountRows = await this.requestByIds<AccountRow>(
      'accounts',
      'accountid',
      accountIds,
      'accountid,name'
    )
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