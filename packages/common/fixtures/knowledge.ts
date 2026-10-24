import {
  knowledgeContractVersion, knowledgeHitSchema, knowledgeSearchRequestSchema, knowledgeSearchResponseSchema,
  type KnowledgeSearchPage, type KnowledgeSearchRequest, type KnowledgeSearchResponse
} from '../contracts/knowledge.js'

export const sampleKnowledgeCheckedAt = '2026-10-01T00:00:00.000Z'
const hits = knowledgeHitSchema.array().parse([
  {
    id: 'sample-azure-ai-pitch', evidenceId: 'knowledge:seismic-m365:sample:azure-ai-pitch',
    source: 'seismic-m365', title: 'Azure AI solution pitch (sample)',
    url: 'https://seismic.example.test/content/azure-ai-pitch.pptx', fileType: 'pptx',
    snippet: 'Synthetic presentation covering Azure AI business outcomes and solution discovery.',
    connectionId: 'sampleSeismic', untrusted: true
  },
  {
    id: 'sample-azure-ai-guide', evidenceId: 'knowledge:seismic-m365:sample:azure-ai-guide',
    source: 'seismic-m365', title: 'Azure AI architecture guide (sample)',
    url: 'https://seismic.example.test/content/azure-ai-guide.pdf', fileType: 'pdf',
    snippet: 'Synthetic architecture guidance for Azure AI workloads.',
    connectionId: 'sampleSeismic', untrusted: true
  },
  {
    id: 'sample-fabric-overview', evidenceId: 'knowledge:seismic-m365:sample:fabric-overview',
    source: 'seismic-m365', title: 'Microsoft Fabric overview (sample)',
    url: 'https://seismic.example.test/content/fabric-overview.pptx', fileType: 'pptx',
    snippet: 'Synthetic presentation covering analytics, OneLake, and Microsoft Fabric.',
    connectionId: 'sampleSeismic', untrusted: true
  }
])

export function searchSampleKnowledge(input: KnowledgeSearchRequest): KnowledgeSearchPage {
  const request = knowledgeSearchRequestSchema.parse(input)
  if (request.source !== 'seismic-m365') throw new Error('The sample Seismic index cannot search another source.')
  const terms = request.query.toLowerCase().split(/\s+/)
  const matching = hits.filter((hit) =>
    terms.every((term) => `${hit.title} ${hit.snippet}`.toLowerCase().includes(term))
    && (!request.filters?.fileTypes || (hit.fileType && request.filters.fileTypes.includes(hit.fileType))))
  const offset = request.offset ?? 0
  const page = matching.slice(offset, offset + (request.limit ?? 10))
  const next = offset + page.length
  return {
    hits: structuredClone(page), hasMore: next < matching.length,
    ...(next < matching.length ? { nextOffset: next } : {}), warnings: []
  }
}

export function sampleKnowledgeSearchResponse(input: KnowledgeSearchRequest): KnowledgeSearchResponse {
  const request = knowledgeSearchRequestSchema.parse(input)
  const base = { contractVersion: knowledgeContractVersion, source: request.source, mode: 'sample' }
  if (request.source !== 'seismic-m365') {
    const message = request.source === 'seismic-mcp'
      ? 'Direct Seismic MCP is not implemented. Select seismic-m365 for Graph retrieval.'
      : 'MCEM knowledge search is reserved for a future provider. Existing MCEM guidance operations are unchanged.'
    return knowledgeSearchResponseSchema.parse({
      ...base, kind: 'unavailable',
      code: request.source === 'seismic-mcp' ? 'mcp-not-configured' : 'source-not-configured', message,
      sourceHealth: { state: 'unavailable', detail: message, checkedAt: sampleKnowledgeCheckedAt }
    })
  }
  return knowledgeSearchResponseSchema.parse({
    ...base, kind: 'results', ...searchSampleKnowledge(request),
    sourceHealth: {
      state: 'sample', detail: 'Synthetic bundled knowledge results; no Microsoft 365 or Seismic request was made.',
      checkedAt: sampleKnowledgeCheckedAt
    }
  })
}
