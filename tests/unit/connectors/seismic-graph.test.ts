import { describe, expect, it, vi } from 'vitest'
import { seismicGraphConfigurationSchema } from '../../../packages/common/configuration/knowledge-sources.js'
import { SeismicM365Provider } from '../../../packages/connectors/seismic/index.js'
import type { KnowledgeSearchRequest } from '../../../packages/common/contracts/knowledge.js'

const configuration = seismicGraphConfigurationSchema.parse({ connectionId: 'SeismicContent' })
const request: KnowledgeSearchRequest = { contractVersion: '1.0', source: 'seismic-m365', query: 'Azure AI' }
function hit(id = 'deck', properties: Record<string, unknown> = {}) {
  return {
    hitId: id, rank: 1, summary: 'Azure <c0>AI</c0> pitch.',
    contentSource: '/external/connections/SeismicContent',
    resource: {
      '@odata.type': '#microsoft.graph.externalConnectors.externalItem', id,
      properties: { title: 'Azure AI pitch', url: `https://seismic.example.test/content/${id}.pptx`, ...properties }
    }
  }
}
function page(hits: unknown[], more = false) {
  return { value: [{ hitsContainers: [{ hits, total: hits.length + (more ? 10 : 0), moreResultsAvailable: more }] }] }
}

describe('Seismic Microsoft Graph external-item provider', () => {
  it('uses only a scoped Graph search with the delegated token and preserves grounded metadata', async () => {
    const token = vi.fn(async () => 'synthetic-delegated-token')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page([hit()])))
    const provider = new SeismicM365Provider(configuration, token, fetcher)
    expect(token).not.toHaveBeenCalled()
    const result = await provider.search(request)
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://graph.microsoft.com/v1.0/search/query')
    expect(init).toMatchObject({
      method: 'POST', redirect: 'error',
      headers: { authorization: 'Bearer synthetic-delegated-token' }
    })
    expect(JSON.parse(String(init?.body))).toEqual({ requests: [{
      entityTypes: ['externalItem'], contentSources: ['/external/connections/SeismicContent'],
      query: { queryString: 'Azure AI' }, from: 0, size: 10, fields: ['title', 'url']
    }] })
    expect(result).toEqual({
      hits: [{
        id: 'deck', evidenceId: 'knowledge:seismic-m365:SeismicContent:deck', source: 'seismic-m365',
        title: 'Azure AI pitch', url: 'https://seismic.example.test/content/deck.pptx',
        snippet: 'Azure AI pitch.', connectionId: 'SeismicContent', untrusted: true, fileType: 'pptx'
      }], hasMore: false, warnings: []
    })
    expect(JSON.stringify(result)).not.toContain('synthetic-delegated-token')
  })

  it('supports configured connector properties, MIME file types, and modification dates', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page([hit('native-link', {
      contentTitle: 'Mapped pitch', sourceUrl: 'https://seismic.example.test/Link/Content/native-link',
      format: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', modified: '2026-10-01T12:00:00Z'
    })])))
    const provider = new SeismicM365Provider({
      connectionId: 'SeismicContent', titleProperty: 'contentTitle', urlProperty: 'sourceUrl',
      fileTypeProperty: 'format', modifiedProperty: 'modified'
    }, async () => 'synthetic-token', fetcher)
    const result = await provider.search({ ...request, filters: { fileTypes: ['pptx'] } })
    expect(result.hits[0]).toMatchObject({ title: 'Mapped pitch', fileType: 'pptx', lastModifiedAt: '2026-10-01T12:00:00Z' })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).requests[0].fields).toEqual(['contentTitle', 'sourceUrl', 'format', 'modified'])
  })

  it('filters the requested page without claiming a filtered total or losing the raw continuation position', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page([
      hit('deck'), hit('guide', { url: 'https://seismic.example.test/guide.pdf' }),
      hit('unknown', { url: 'https://seismic.example.test/Link/Content/unknown' })
    ], true)))
    const result = await new SeismicM365Provider(configuration, async () => 'synthetic', fetcher).search({
      ...request, offset: 20, limit: 3, filters: { fileTypes: ['pptx'] }
    })
    expect(result).toMatchObject({
      hits: [{ id: 'deck', fileType: 'pptx' }], hasMore: true, nextOffset: 23, warnings: ['unverified-file-types']
    })
    expect(result).not.toHaveProperty('total')
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).requests[0]).toMatchObject({ from: 20, size: 3 })
  })

  it('discards unsafe, ungrounded, cross-connection, and duplicate hits without inventing citations', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page([
      hit(), hit(), hit('unsafe', { url: 'javascript:alert(1)' }), hit('untitled', { title: '' }),
      { ...hit('other'), contentSource: '/external/connections/OtherConnection' }, { hitId: 'broken' }
    ])))
    const result = await new SeismicM365Provider(configuration, async () => 'synthetic', fetcher).search(request)
    expect(result.hits.map((item) => item.id)).toEqual(['deck'])
    expect(result.warnings).toEqual(['invalid-source-items'])
  })

  it.each([
    [401, 'graph-sign-in-required', 'unauthorized'], [403, 'graph-permission-denied', 'unauthorized'],
    [429, 'graph-throttled', 'unavailable'], [500, 'graph-request-failed', 'unavailable'],
    [302, 'graph-request-failed', 'unavailable']
  ])('reports HTTP %s honestly without returning tokens, raw errors, or fallback data', async (status, code, state) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private server content', { status }))
    const search = new SeismicM365Provider(configuration, async () => 'synthetic-secret', fetcher).search(request)
    await expect(search).rejects.toMatchObject({ code, state })
    await expect(search).rejects.not.toThrow('private server content')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('requires a token and rejects cross-source calls before dispatch', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const token = vi.fn(async () => ' ')
    const provider = new SeismicM365Provider(configuration, token, fetcher)
    await expect(provider.search({ ...request, source: 'seismic-mcp' })).rejects.toThrow('another knowledge source')
    expect(token).not.toHaveBeenCalled()
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'graph-sign-in-required' })
    await expect(new SeismicM365Provider(configuration, async () => { throw new Error('private login detail') }, fetcher).search(request))
      .rejects.toMatchObject({ code: 'graph-sign-in-required' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    {}, { value: [] }, { value: [{ error: { code: 'failure' }, hitsContainers: [] }] },
    { value: [{ hitsContainers: [{ total: 1, moreResultsAvailable: false }] }] },
    page([], true), page(Array.from({ length: 11 }, (_, index) => hit(String(index))))
  ])('rejects an invalid or nonadvancing response envelope', async (response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response))
    await expect(new SeismicM365Provider(configuration, async () => 'synthetic', fetcher).search(request))
      .rejects.toMatchObject({ code: 'graph-response-invalid' })
  })

  it('distinguishes an empty page, malformed JSON, transport failure, and oversized content', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(page([])))
      .mockResolvedValueOnce(new Response('invalid JSON'))
      .mockRejectedValueOnce(new Error('private network detail'))
      .mockResolvedValueOnce(new Response('x'.repeat(1_000_001)))
    const provider = new SeismicM365Provider(configuration, async () => 'synthetic', fetcher)
    await expect(provider.search(request)).resolves.toEqual({ hits: [], hasMore: false, warnings: [] })
    for (const code of ['graph-response-invalid', 'graph-transport-failed', 'graph-response-too-large']) {
      await expect(provider.search(request)).rejects.toMatchObject({ code })
    }
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('accepts Graph empty results without a hits array when the total is zero', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      value: [{ hitsContainers: [{ total: 0, moreResultsAvailable: false }] }]
    }))
    await expect(new SeismicM365Provider(configuration, async () => 'synthetic', fetcher).search(request))
      .resolves.toEqual({ hits: [], hasMore: false, warnings: [] })
  })
})
