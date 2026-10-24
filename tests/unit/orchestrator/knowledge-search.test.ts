import { describe, expect, it, vi } from 'vitest'
import { createKnowledgeSearch, KnowledgeSearchService } from '../../../packages/orchestrator/knowledge-search.js'
import { KnowledgeSourceError, type KnowledgeSource } from '../../../packages/connectors/common/knowledge.js'
import { seismicGraphConfigurationFromEnvironment } from '../../../packages/common/configuration/knowledge-sources.js'
import { sampleKnowledgeSearchResponse } from '../../../packages/common/fixtures/knowledge.js'

const request = { contractVersion: '1.0' as const, source: 'seismic-m365' as const, query: 'Azure AI' }

describe('knowledge source dispatch', () => {
  it('keeps sample search deterministic, filtered, paginated, and entirely offline', async () => {
    const getGraphToken = vi.fn(async () => 'must-not-be-used')
    const fetcher = vi.fn<typeof fetch>()
    const service = createKnowledgeSearch({ mode: 'sample', environment: { TLC_SEISMIC_GRAPH_CONNECTION_ID: 'ConfiguredLive' }, getGraphToken, fetcher })
    const response = await service.searchKnowledge(request)
    expect(response).toEqual(sampleKnowledgeSearchResponse(request))
    expect(response).toMatchObject({ kind: 'results', mode: 'sample', sourceHealth: { state: 'sample' }, hits: [{ fileType: 'pptx' }, { fileType: 'pdf' }] })
    const filtered = await service.searchKnowledge({ ...request, filters: { fileTypes: ['pptx'] } })
    expect(filtered).toMatchObject({ kind: 'results', hits: [{ fileType: 'pptx' }], hasMore: false })
    const first = await service.searchKnowledge({ ...request, limit: 1 })
    expect(first).toMatchObject({ hasMore: true, nextOffset: 1 })
    const second = await service.searchKnowledge({ ...request, limit: 1, offset: 1 })
    expect(second).toMatchObject({ hits: [{ fileType: 'pdf' }], hasMore: false })
    expect(getGraphToken).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports missing or invalid Graph configuration before requesting a token', async () => {
    const getGraphToken = vi.fn(async () => 'synthetic')
    for (const environment of [{}, { TLC_SEISMIC_GRAPH_CONNECTION_ID: '../bad' }]) {
      const service = createKnowledgeSearch({ mode: 'live', environment, getGraphToken })
      expect(await service.searchKnowledge(request)).toMatchObject({ kind: 'unavailable', mode: 'live', code: 'graph-not-configured' })
    }
    expect(getGraphToken).not.toHaveBeenCalled()
    expect(await createKnowledgeSearch({ mode: 'live', environment: { TLC_SEISMIC_GRAPH_CONNECTION_ID: 'Seismic' } }).searchKnowledge(request))
      .toMatchObject({ kind: 'unavailable', code: 'graph-auth-not-configured', sourceHealth: { state: 'unauthorized' } })
  })

  it('leaves MCP explicitly unavailable and never falls back to Graph or sample data', async () => {
    const getGraphToken = vi.fn(async () => 'synthetic')
    const fetcher = vi.fn<typeof fetch>()
    for (const mode of ['sample', 'live'] as const) {
      const service = createKnowledgeSearch({ mode, environment: { TLC_SEISMIC_GRAPH_CONNECTION_ID: 'Seismic' }, getGraphToken, fetcher })
      const result = await service.searchKnowledge({ ...request, source: 'seismic-mcp' })
      expect(result).toMatchObject({ kind: 'unavailable', mode, code: 'mcp-not-configured', sourceHealth: { state: 'unavailable' } })
      expect(result).not.toHaveProperty('hits')
      expect(await service.searchKnowledge({ ...request, source: 'mcem' })).toMatchObject({ kind: 'unavailable', code: 'source-not-configured' })
    }
    expect(getGraphToken).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('supports replacing the MCP placeholder through the same provider interface and prevents mixed modes', async () => {
    const graph: KnowledgeSource = { id: 'seismic-m365', mode: 'live', search: vi.fn(async () => ({ hits: [], hasMore: false, warnings: [] })) }
    const mcp: KnowledgeSource = { id: 'seismic-mcp', mode: 'live', search: vi.fn(async () => ({ hits: [], hasMore: false, warnings: [] })) }
    const service = new KnowledgeSearchService([graph, mcp], 'live')
    expect(await service.searchKnowledge({ ...request, source: 'seismic-mcp' })).toMatchObject({ kind: 'results', source: 'seismic-mcp' })
    expect(mcp.search).toHaveBeenCalledWith({ ...request, source: 'seismic-mcp' })
    expect(graph.search).not.toHaveBeenCalled()
    expect(() => new KnowledgeSearchService([graph, graph])).toThrow('only be registered once')
    expect(() => new KnowledgeSearchService([graph], 'sample')).toThrow('cannot share')
  })

  it('surfaces typed source failures but does not swallow programming errors', async () => {
    const search = vi.fn<KnowledgeSource['search']>()
      .mockRejectedValueOnce(new KnowledgeSourceError('graph-permission-denied', 'Access denied.', 'unauthorized'))
      .mockRejectedValueOnce(new Error('Unexpected implementation failure'))
    const service = new KnowledgeSearchService([{ id: 'seismic-m365', mode: 'live', search }])
    expect(await service.searchKnowledge(request)).toMatchObject({ kind: 'unavailable', code: 'graph-permission-denied' })
    await expect(service.searchKnowledge(request)).rejects.toThrow('Unexpected implementation failure')
  })

  it('validates configuration property mappings without allowing client-provided paths', () => {
    expect(seismicGraphConfigurationFromEnvironment({ TLC_SEISMIC_GRAPH_CONNECTION_ID: 'SeismicContent' })).toEqual({
      connectionId: 'SeismicContent', titleProperty: 'title', urlProperty: 'url'
    })
    expect(() => seismicGraphConfigurationFromEnvironment({
      TLC_SEISMIC_GRAPH_CONNECTION_ID: 'SeismicContent', TLC_SEISMIC_GRAPH_URL_PROPERTY: '../injected'
    })).toThrow()
  })
})
