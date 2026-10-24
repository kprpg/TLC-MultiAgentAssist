import { z } from 'zod'
import {
  knowledgeContractVersion, knowledgeSearchRequestSchema, knowledgeSearchResponseSchema,
  type KnowledgeSearchRequest, type KnowledgeSearchResponse, type KnowledgeSourceId
} from '../common/contracts/knowledge.js'
import { seismicGraphConfigurationFromEnvironment } from '../common/configuration/knowledge-sources.js'
import { sampleKnowledgeCheckedAt, sampleKnowledgeSearchResponse } from '../common/fixtures/knowledge.js'
import { KnowledgeSourceError, type KnowledgeSource } from '../connectors/common/knowledge.js'
import { SeismicM365Provider, SeismicMCPProvider } from '../connectors/seismic/index.js'

export interface KnowledgeSearch {
  searchKnowledge(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse>
}

export class KnowledgeSearchService implements KnowledgeSearch {
  private readonly sources = new Map<KnowledgeSourceId, KnowledgeSource>()
  constructor(
    sources: readonly KnowledgeSource[] = [],
    private readonly mode: 'sample' | 'live' = 'live',
    private readonly now: () => Date = () => new Date()
  ) {
    for (const source of sources) {
      if (this.sources.has(source.id)) throw new Error('A knowledge source may only be registered once.')
      if (source.mode !== mode) throw new Error('Sample and live knowledge providers cannot share a search service.')
      this.sources.set(source.id, source)
    }
  }

  async searchKnowledge(input: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse> {
    const request = knowledgeSearchRequestSchema.parse(input)
    const base = {
      contractVersion: knowledgeContractVersion, source: request.source, mode: this.mode
    }
    const checkedAt = this.mode === 'sample' ? sampleKnowledgeCheckedAt : this.now().toISOString()
    try {
      const source = this.sources.get(request.source)
      if (!source) throw new KnowledgeSourceError('source-not-configured', 'The requested knowledge source is not configured. Existing MCEM guidance operations are unchanged.')
      const page = await source.search(request)
      const result = knowledgeSearchResponseSchema.parse({
        ...base, kind: 'results', ...page,
        sourceHealth: {
          state: page.warnings.length ? 'partial' : this.mode,
          detail: this.mode === 'sample' ? 'Synthetic bundled knowledge results; no Microsoft 365 or Seismic request was made.'
            : page.warnings.length ? 'Some Seismic index items lacked valid evidence or filter metadata; this page is partial.'
              : 'Retrieved from the configured Seismic Microsoft Graph connection under the delegated user.',
          checkedAt
        }
      })
      if (result.kind === 'results' && (result.hits.length > (request.limit ?? 10)
        || (result.nextOffset !== undefined && result.nextOffset <= (request.offset ?? 0)))) {
        throw new Error('The knowledge provider returned an invalid result window.')
      }
      return result
    } catch (error) {
      if (!(error instanceof KnowledgeSourceError)) throw error
      return knowledgeSearchResponseSchema.parse({
        ...base, kind: 'unavailable', code: error.code, message: error.message,
        sourceHealth: { state: error.state, detail: error.message, checkedAt }
      })
    }
  }
}

export function createKnowledgeSearch(options: {
  mode: 'sample' | 'live'
  environment?: Readonly<Record<string, string | undefined>>
  getGraphToken?: () => Promise<string>
  fetcher?: typeof fetch
  now?: () => Date
}): KnowledgeSearch {
  if (options.mode === 'sample') return { searchKnowledge: async (request) => sampleKnowledgeSearchResponse(request) }
  const graph: KnowledgeSource = {
    id: 'seismic-m365', mode: options.mode,
    search: async (request) => {
      let configuration
      try { configuration = seismicGraphConfigurationFromEnvironment(options.environment ?? process.env) } catch (error) {
        if (!(error instanceof z.ZodError)) throw error
        throw new KnowledgeSourceError('graph-not-configured', 'The Seismic Graph connection or property mapping is invalid. Check TLC_SEISMIC_GRAPH_* configuration.')
      }
      if (!configuration) throw new KnowledgeSourceError('graph-not-configured', 'Set TLC_SEISMIC_GRAPH_CONNECTION_ID to the existing Seismic Microsoft 365 connector connection ID.')
      if (!options.getGraphToken) throw new KnowledgeSourceError('graph-auth-not-configured', 'A separate delegated Microsoft Graph token provider is not configured. MSX and Seismic OAuth tokens cannot be used for Graph search.', 'unauthorized')
      return new SeismicM365Provider(configuration, options.getGraphToken, options.fetcher).search(request)
    }
  }
  return new KnowledgeSearchService([graph, new SeismicMCPProvider(options.mode)], options.mode, options.now)
}
