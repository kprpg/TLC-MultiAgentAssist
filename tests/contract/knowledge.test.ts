import { describe, expect, it } from 'vitest'
import {
  knowledgeHitSchema, knowledgeSearchRequestSchema, knowledgeSearchResponseSchema
} from '../../packages/common/contracts/knowledge.js'
import { sampleKnowledgeSearchResponse } from '../../packages/common/fixtures/knowledge.js'

const request = { contractVersion: '1.0' as const, source: 'seismic-m365' as const, query: 'Azure AI' }

describe('knowledge contracts v1.0', () => {
  it('accepts bounded source-specific searches and rejects unknown fields and invalid requests', () => {
    expect(knowledgeSearchRequestSchema.parse({ ...request, query: ' Azure AI ' }).query).toBe('Azure AI')
    for (const input of [
      { ...request, contractVersion: '2.0' }, { ...request, query: ' ' }, { ...request, query: 'x'.repeat(501) },
      { ...request, source: 'all' }, { ...request, connectionId: 'another-tenant' },
      { ...request, token: 'not-allowed' }, { ...request, limit: 51 }, { ...request, offset: -1 },
      { ...request, filters: { fileTypes: [] } }, { ...request, filters: { fileTypes: ['exe'] } },
      { ...request, filters: { account: 'injected' } }
    ]) expect(knowledgeSearchRequestSchema.safeParse(input).success).toBe(false)
  })

  it('requires valid source evidence and untrusted marking', () => {
    const response = sampleKnowledgeSearchResponse(request)
    if (response.kind !== 'results' || !response.hits[0]) throw new Error('Missing canonical sample evidence.')
    const hit = response.hits[0]
    for (const patch of [
      { url: 'http://example.test/pitch' }, { url: 'javascript:alert(1)' },
      { url: 'https://user:password@example.test/pitch' }, { untrusted: false }, { evidenceId: '' },
      { title: '' }, { extra: true }
    ]) expect(knowledgeHitSchema.safeParse({ ...hit, ...patch }).success).toBe(false)
    expect(knowledgeSearchResponseSchema.safeParse({ ...response, hits: [{ ...hit, source: 'seismic-mcp' }] }).success).toBe(false)
  })

  it('does not allow unavailable sources to look like empty successful searches', () => {
    const unavailable = sampleKnowledgeSearchResponse({ ...request, source: 'seismic-mcp' })
    expect(unavailable).toMatchObject({ kind: 'unavailable', code: 'mcp-not-configured' })
    expect(knowledgeSearchResponseSchema.safeParse({ ...unavailable, hits: [] }).success).toBe(false)
    const results = sampleKnowledgeSearchResponse(request)
    if (results.kind !== 'results') throw new Error('Expected sample results.')
    expect(knowledgeSearchResponseSchema.safeParse({ ...results, hasMore: true }).success).toBe(false)
    expect(knowledgeSearchResponseSchema.safeParse({ ...results, nextOffset: 5 }).success).toBe(false)
    expect(knowledgeSearchResponseSchema.safeParse({
      ...results, sourceHealth: { ...results.sourceHealth, state: 'unauthorized' }
    }).success).toBe(false)
  })
})
