import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler } from '../../../apps/web/src/app.js'
import { createKnowledgeSearchIpcHandler } from '../../../apps/desktop/electron/main/knowledge-ipc.js'
import { buildLiveDataProvider } from '../../../apps/vscode-extension/src/live-provider-core.js'
import { createSampleDataProvider, createLocalStoreDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { createWebApiClient, createDataClient } from '../../../apps/desktop/renderer-revamp/src/data-client.js'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { createApplicationOperations } from '../../../packages/orchestrator/operations.js'
import { createKnowledgeSearch } from '../../../packages/orchestrator/knowledge-search.js'
import { sampleKnowledgeSearchResponse } from '../../../packages/common/fixtures/knowledge.js'
import type { KnowledgeSearchRequest } from '../../../packages/common/contracts/knowledge.js'

vi.mock('../../../apps/vscode-extension/src/live-provider.js', () => ({ buildFoundryMeetingExtractor: () => undefined }))

const headers = {
  'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
  'x-ms-client-principal': 'synthetic-principal', 'x-ms-client-principal-name': 'sample@example.test',
  'x-ms-token-aad-access-token': 'synthetic-token'
}
const request: KnowledgeSearchRequest = {
  contractVersion: '1.0', source: 'seismic-m365', query: 'Azure AI', filters: { fileTypes: ['pptx'] }
}
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function harness(mode: 'sample' | 'live' = 'sample') {
  const services = await createSampleApplicationServices()
  cleanup.push(() => services.dispose())
  const search = createKnowledgeSearch({ mode, environment: {}, now: () => new Date('2026-10-01T00:00:00.000Z') })
  const core = Object.assign(services.orchestrator, { searchKnowledge: search.searchKnowledge.bind(search) })
  const runtime = Object.assign(core, {
    listMeetingTranscripts: vi.fn(), getMeetingTranscript: vi.fn(), proposeMeetingChangeSet: vi.fn(), applyMeetingChangeSet: vi.fn()
  })
  const handler = buildWebApiHandler({ createRuntime: () => runtime })
  const server: Server = createServer((request, response) => void handler(request, response))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Knowledge parity listener did not bind.')
  return {
    services, core, url: `http://127.0.0.1:${address.port}/api/knowledge/search`,
    provider: buildLiveDataProvider({ orchestrator: core, host: services.workflows, account: 'synthetic', dispose: async () => undefined }, mode)
  }
}

describe('knowledge operation transport parity', () => {
  it('returns identical filtered evidence over IPC, HTTP, webview, and the operation registry', async () => {
    const { services, core, provider, url } = await harness()
    const expected = sampleKnowledgeSearchResponse(request)
    expect(await createKnowledgeSearchIpcHandler(core)(request)).toEqual(expected)
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(request) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(expected)
    expect(await routeBridgeMessage(provider, { kind: 'request', id: 'knowledge', method: 'searchKnowledge', params: request }))
      .toMatchObject({ ok: true, result: expected })
    const operations = createApplicationOperations(services)
    expect(await operations.invoke('searchKnowledge', request)).toEqual(expected)
    expect(operations.describe('searchKnowledge')).toMatchObject({ effect: 'read', startsWork: false })
  })

  it.each(['sample', 'live'] as const)('preserves explicit MCP unavailable results in %s mode on every transport', async (mode) => {
    const { core, provider, services, url } = await harness(mode)
    const input = { ...request, source: 'seismic-mcp' as const }
    const expected = await core.searchKnowledge(input)
    expect(expected).toMatchObject({ kind: 'unavailable', mode, code: 'mcp-not-configured' })
    expect(await createKnowledgeSearchIpcHandler(core)(input)).toEqual(expected)
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) })
    const http = await response.json()
    expect(http).toMatchObject({ ...expected, sourceHealth: { ...expected.sourceHealth, checkedAt: expect.any(String) } })
    expect(await routeBridgeMessage(provider, { kind: 'request', id: 'mcp', method: 'searchKnowledge', params: input }))
      .toMatchObject({ ok: true, result: { kind: 'unavailable', code: 'mcp-not-configured' } })
    expect(await createApplicationOperations(services).invoke('searchKnowledge', input)).toMatchObject({ kind: 'unavailable', code: 'mcp-not-configured' })
  })

  it('keeps HTTP authentication, same-origin checks, strict input validation and output validation', async () => {
    const { core, provider, url } = await harness()
    const body = JSON.stringify(request)
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401)
    expect((await fetch(url, { method: 'POST', headers: { ...headers, 'sec-fetch-site': 'cross-site' }, body })).status).toBe(403)
    for (const input of [{ ...request, contractVersion: 'wrong' }, { ...request, token: 'injected' }, { ...request, source: 'unknown' }]) {
      expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) })).status).toBe(400)
      await expect(createKnowledgeSearchIpcHandler(core)(input)).rejects.toThrow()
      expect(await routeBridgeMessage(provider, { kind: 'request', id: 'bad', method: 'searchKnowledge', params: input })).toMatchObject({ ok: false })
    }
    const malformed = { searchKnowledge: vi.fn().mockResolvedValue({
      ...sampleKnowledgeSearchResponse(request), contractVersion: 'wrong'
    }) }
    await expect(createKnowledgeSearchIpcHandler(malformed)(request)).rejects.toThrow()
  })

  it('wires both extension sample stores and browser/Desktop data clients to the same interface', async () => {
    const expected = sampleKnowledgeSearchResponse(request)
    const sample = createSampleDataProvider()
    const sqlite = createLocalStoreDataProvider()
    cleanup.push(() => sample.dispose(), () => sqlite.dispose())
    expect(await sample.searchKnowledge(request)).toEqual(expected)
    expect(await sqlite.searchKnowledge(request)).toEqual(expected)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(expected))
    expect(await createWebApiClient(fetcher).searchKnowledge(request)).toEqual(expected)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/knowledge/search')
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(request)
    const bridge = { searchKnowledge: vi.fn(async () => expected) }
    vi.stubGlobal('window', { tlc: bridge })
    expect(await createDataClient('desktop').searchKnowledge(request)).toEqual(expected)
    expect(bridge.searchKnowledge).toHaveBeenCalledWith(request)
  })
})
