const graphBaseUrl = 'https://graph.microsoft.com/v1.0'
const mcemSitePath = '/teams/MCEM-Portal'
const mcemHomePageName = 'MCEM-Home-Page.aspx'

export interface GraphTokenProvider {
  getAccessToken(): Promise<string>
}

export interface McemPageMetadata {
  siteId: string
  pageId: string
  name: string
  title: string
  webUrl: string
  lastModifiedDateTime?: string
}

interface GraphSite {
  id: string
}

interface GraphPage {
  id: string
  name: string
  title?: string
  webUrl: string
  lastModifiedDateTime?: string
}

interface GraphCollection<T> {
  value: T[]
}

export class GraphMcemAccessProbe {
  constructor(
    private readonly tokenProvider: GraphTokenProvider,
    private readonly request: typeof fetch = fetch
  ) {}

  async getCanonicalPageMetadata(): Promise<McemPageMetadata> {
    const token = await this.tokenProvider.getAccessToken()
    const site = await this.getJson<GraphSite>(
      `${graphBaseUrl}/sites/microsoft.sharepoint.com:${mcemSitePath}`,
      token
    )
    const pages = await this.getJson<GraphCollection<GraphPage>>(
      `${graphBaseUrl}/sites/${encodeURIComponent(site.id)}/pages/microsoft.graph.sitePage?$select=id,name,title,webUrl,lastModifiedDateTime`,
      token
    )
    const page = pages.value.find((candidate) => candidate.name.toLowerCase() === mcemHomePageName.toLowerCase())
    if (!page) throw new Error(`Microsoft Graph could not find ${mcemHomePageName} in the MCEM Portal site.`)

    return {
      siteId: site.id,
      pageId: page.id,
      name: page.name,
      title: page.title ?? page.name,
      webUrl: page.webUrl,
      ...(page.lastModifiedDateTime ? { lastModifiedDateTime: page.lastModifiedDateTime } : {})
    }
  }

  private async getJson<T>(url: string, token: string): Promise<T> {
    const response = await this.request(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    })
    if (!response.ok) {
      const requestId = response.headers.get('request-id')
      throw new Error(
        `Microsoft Graph MCEM metadata request failed (${response.status}${requestId ? `; request-id ${requestId}` : ''}).`
      )
    }
    return await response.json() as T
  }
}