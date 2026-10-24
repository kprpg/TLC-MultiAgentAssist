import { z } from 'zod'
import {
  knowledgeFileTypeSchema, knowledgeHitSchema, knowledgeSearchRequestSchema,
  type KnowledgeFileType, type KnowledgeSearchPage, type KnowledgeSearchRequest
} from '../../common/contracts/knowledge.js'
import { seismicGraphConfigurationSchema, type SeismicGraphConfiguration } from '../../common/configuration/knowledge-sources.js'
import { KnowledgeSourceError, type KnowledgeSource } from '../common/knowledge.js'
import { readBoundedText, ResponseSizeError } from '../common/http-response.js'

const graphSearchUrl = 'https://graph.microsoft.com/v1.0/search/query'
const searchResponse = z.object({
  value: z.array(z.object({
    error: z.unknown().optional(),
    hitsContainers: z.array(z.object({
      hits: z.array(z.unknown()).max(50).optional(),
      moreResultsAvailable: z.boolean(),
      total: z.number().int().nonnegative()
    })).length(1)
  })).length(1)
})
const searchHit = z.object({
  hitId: z.string().min(1).max(500),
  summary: z.string().optional(),
  contentSource: z.string().optional(),
  resource: z.object({
    '@odata.type': z.literal('#microsoft.graph.externalConnectors.externalItem').optional(),
    id: z.string().min(1).max(500).optional(),
    properties: z.record(z.string(), z.unknown())
  })
})
const mimeTypes: Readonly<Record<string, KnowledgeFileType>> = {
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/html': 'html'
}
const text = (value: string) => value.replace(/<[^>]*>/g, '').trim()

function fileType(value: unknown, url: string): KnowledgeFileType | undefined {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase().trim().replace(/^\./, '')
    const parsed = knowledgeFileTypeSchema.safeParse(mimeTypes[normalized] ?? normalized)
    if (parsed.success) return parsed.data
  }
  const extension = new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
  const parsed = knowledgeFileTypeSchema.safeParse(extension)
  return parsed.success ? parsed.data : undefined
}

export class SeismicM365Provider implements KnowledgeSource {
  readonly id = 'seismic-m365' as const
  readonly mode = 'live' as const
  private readonly configuration: SeismicGraphConfiguration

  constructor(
    configuration: SeismicGraphConfiguration,
    private readonly getAccessToken: () => Promise<string>,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.configuration = seismicGraphConfigurationSchema.parse(configuration)
  }

  async search(input: KnowledgeSearchRequest): Promise<KnowledgeSearchPage> {
    const request = knowledgeSearchRequestSchema.parse(input)
    if (request.source !== this.id) throw new Error('The Seismic Graph provider cannot search another knowledge source.')
    let token: string
    try { token = await this.getAccessToken() } catch {
      throw new KnowledgeSourceError('graph-sign-in-required', 'A delegated Microsoft Graph session is required for Seismic search.', 'unauthorized')
    }
    if (!token.trim()) throw new KnowledgeSourceError('graph-sign-in-required', 'A delegated Microsoft Graph token was not returned.', 'unauthorized')
    const config = this.configuration
    const contentSource = `/external/connections/${config.connectionId}`
    const fields = [...new Set([config.titleProperty, config.urlProperty, config.fileTypeProperty, config.modifiedProperty]
      .filter((field): field is string => field !== undefined))]
    let response: Response
    try {
      response = await this.fetcher(graphSearchUrl, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ requests: [{
          entityTypes: ['externalItem'], contentSources: [contentSource],
          query: { queryString: request.query }, from: request.offset ?? 0, size: request.limit ?? 10, fields
        }] })
      })
    } catch {
      throw new KnowledgeSourceError('graph-transport-failed', 'The Seismic Graph search request could not be completed.')
    }
    if (!response.ok) {
      if (response.status === 401) throw new KnowledgeSourceError('graph-sign-in-required', 'Microsoft Graph rejected the delegated session. Sign in again.', 'unauthorized')
      if (response.status === 403) throw new KnowledgeSourceError('graph-permission-denied', 'Microsoft Graph denied Seismic search. Verify ExternalItem.Read.All consent and connector access.', 'unauthorized')
      if (response.status === 429) throw new KnowledgeSourceError('graph-throttled', 'Microsoft Graph throttled Seismic search. Retry later.')
      throw new KnowledgeSourceError('graph-request-failed', `Microsoft Graph Seismic search returned HTTP ${response.status}.`)
    }
    let raw: unknown
    try { raw = JSON.parse(await readBoundedText(response, 1_000_000)) } catch (error) {
      if (error instanceof ResponseSizeError) throw new KnowledgeSourceError('graph-response-too-large', 'The Seismic search response exceeded its byte budget.')
      if (error instanceof SyntaxError) throw new KnowledgeSourceError('graph-response-invalid', 'Microsoft Graph returned an invalid search response.')
      throw new KnowledgeSourceError('graph-transport-failed', 'The Seismic Graph search response could not be read.')
    }
    const parsed = searchResponse.safeParse(raw)
    const result = parsed.success ? parsed.data.value[0] : undefined
    const page = result?.hitsContainers[0]
    const rawHits = page?.hits ?? []
    if (!page || result?.error || rawHits.length > (request.limit ?? 10)
      || (!rawHits.length && (page.moreResultsAvailable || (request.offset ?? 0) < page.total))) {
      throw new KnowledgeSourceError('graph-response-invalid', 'Microsoft Graph returned an incomplete or invalid Seismic search page.')
    }
    const hits: KnowledgeSearchPage['hits'] = []
    const warnings = new Set<KnowledgeSearchPage['warnings'][number]>()
    const seen = new Set<string>()
    for (const rawHit of rawHits) {
      const candidate = searchHit.safeParse(rawHit)
      if (!candidate.success || (candidate.data.contentSource && candidate.data.contentSource !== contentSource)) {
        warnings.add('invalid-source-items')
        continue
      }
      const { resource, hitId, summary } = candidate.data
      const title = resource.properties[config.titleProperty]
      const url = resource.properties[config.urlProperty]
      const modified = config.modifiedProperty ? resource.properties[config.modifiedProperty] : undefined
      const hit = knowledgeHitSchema.safeParse({
        id: resource.id ?? hitId, evidenceId: `knowledge:seismic-m365:${config.connectionId}:${resource.id ?? hitId}`,
        source: this.id, title: typeof title === 'string' ? text(title) : title, url,
        ...(summary ? { snippet: text(summary).slice(0, 4000) } : {}),
        ...(modified === undefined ? {} : { lastModifiedAt: modified }),
        connectionId: config.connectionId, untrusted: true
      })
      if (!hit.success) {
        warnings.add('invalid-source-items')
        continue
      }
      const extension = fileType(config.fileTypeProperty ? resource.properties[config.fileTypeProperty] : undefined, hit.data.url)
      if (request.filters?.fileTypes) {
        if (!extension) warnings.add('unverified-file-types')
        if (!extension || !request.filters.fileTypes.includes(extension)) continue
      }
      if (!seen.has(hit.data.id)) {
        hits.push({ ...hit.data, ...(extension ? { fileType: extension } : {}) })
        seen.add(hit.data.id)
      }
    }
    const nextOffset = (request.offset ?? 0) + rawHits.length
    if (page.moreResultsAvailable && nextOffset > 10_000) {
      throw new KnowledgeSourceError('graph-response-invalid', 'Narrow the Seismic query; its continuation exceeds the supported search window.')
    }
    return {
      hits, hasMore: page.moreResultsAvailable,
      ...(page.moreResultsAvailable ? { nextOffset } : {}), warnings: [...warnings]
    }
  }
}
