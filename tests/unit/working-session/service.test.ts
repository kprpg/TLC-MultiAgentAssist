import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { workingSessionPrepareRequestSchema, workingSessionResultSchema, workingSessionTopicSchema } from '../../../packages/common/contracts/working-session.js'
import { DownloadStore } from '../../../packages/orchestrator/working-session/download-store.js'
import { zipOutput, type WorkingSessionOutput } from '../../../packages/orchestrator/working-session/outputs.js'
import { createWorkingSessionService, deckConfigurationFromEnvironment } from '../../../packages/orchestrator/working-session/service.js'
import { MemorySink } from '../../../packages/orchestrator/working-session/sinks.js'

const topic = workingSessionTopicSchema.parse({
  topic: 'Azure Arc-enabled SQL', domain: 'Hybrid', azureServices: ['Azure Arc'], deckQueries: ['Azure Arc data services'], learnQueries: ['sql managed instance arc'],
  iacScenario: 'Arc POC', confidence: 'high', basis: 'rules', evidence: ['x']
})
const prepareRequest = (deliverables = { decks: true, learn: true, iac: true }) => workingSessionPrepareRequestSchema.parse({
  contractVersion: '1.0', opportunityId: 'opp-1', opportunityName: 'ARC ENABLED SQL', milestoneName: 'POC', topic, deliverables
})
const memoryOutput = (): WorkingSessionOutput & { sink: MemorySink } => {
  const sink = new MemorySink()
  return { sink, finish: async () => ({ kind: 'folder' as const, folderPath: 'C:\\Docs\\TLC\\ARC ENABLED SQL - POC' }) }
}
const now = () => new Date('2026-10-25T05:00:00Z')

const sse = (text: string) => `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text }] } })}\n\n`
const liveFetch = (options: { learn?: 'ok' | 'down'; githubDeck?: boolean } = {}) => vi.fn<typeof fetch>(async (input, init) => {
  const url = String(input)
  if (url === 'https://learn.microsoft.com/api/mcp') {
    if (options.learn === 'down') return new Response('', { status: 503 })
    const body = JSON.parse(String(init?.body)) as { params: { name: string; arguments: { url?: string } } }
    if (body.params.name === 'microsoft_docs_search') return new Response(sse(JSON.stringify({ results: [{ title: 'SQL MI overview', content: '# SQL MI overview\nexcerpt', contentUrl: 'https://learn.microsoft.com/azure/azure-arc/data/managed-instance-overview' }] })))
    return new Response(sse('# SQL MI overview\n\n## Features\n\nbody'))
  }
  if (url.includes('api.github.com')) return new Response(JSON.stringify({ tree: options.githubDeck ? [{ path: 'Arc/Azure Arc data services.pptx', type: 'blob', size: 100 }] : [] }))
  if (url.includes('raw.githubusercontent.com')) return new Response(new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 0]))
  return new Response('', { status: 404 })
})

describe('working-session service', () => {
  it('derives a confirmable topic in sample mode without any network', async () => {
    const service = createWorkingSessionService({ mode: 'sample', openOutput: async () => memoryOutput(), now })
    const response = await service.deriveTopic({ contractVersion: '1.0', opportunityId: 'o', opportunityName: 'ARC ENABLED SQL', milestoneName: 'POC' })
    expect(response).toMatchObject({ mode: 'sample', topic: { topic: 'Azure Arc-enabled SQL', basis: 'rules' } })
  })

  it('prepares the whole folder in sample mode from bundled content only', async () => {
    const output = memoryOutput()
    const fetcher = vi.fn<typeof fetch>()
    const result = await createWorkingSessionService({ mode: 'sample', openOutput: async () => output, fetcher, now }).prepare(prepareRequest())
    expect(fetcher).not.toHaveBeenCalled()
    expect(workingSessionResultSchema.safeParse(result).success).toBe(true)
    expect(result.folderName).toBe('ARC ENABLED SQL - POC')
    expect(result.delivery).toEqual({ kind: 'folder', folderPath: 'C:\\Docs\\TLC\\ARC ENABLED SQL - POC' })
    const paths = [...output.sink.files.keys()]
    expect(paths).toEqual(expect.arrayContaining(['README.md', 'manifest.json', 'iac/main.bicep', 'learn/index.md']))
    expect(paths.some((path) => path.startsWith('decks/DRAFT-') && path.endsWith('.pptx'))).toBe(true)
    expect(result.gaps.map((gap) => gap.code)).toEqual(expect.arrayContaining(['not-available-here', 'nothing-found']))
    expect(result.gaps.find((gap) => gap.code === 'tool-missing')?.message).toContain('Sample mode does not compile')
    expect(JSON.parse(output.sink.text('manifest.json')!).mode).toBe('sample')
  })

  it('copies a real deck, writes Learn pages and templates, and records sources in live mode', async () => {
    const output = memoryOutput()
    const fetcher = liveFetch({ githubDeck: true })
    const renderDocx = vi.fn(async () => new Uint8Array([1, 2, 3]))
    const result = await createWorkingSessionService({ mode: 'live', openOutput: async () => output, fetcher, renderDocx, githubRepositories: ['AzureDataCommunity/Resources'], now }).prepare(prepareRequest())
    const paths = [...output.sink.files.keys()]
    expect(paths).toContain('decks/azure-arc-data-services.pptx')
    expect(paths.some((path) => path.includes('DRAFT'))).toBe(false)
    expect(paths).toEqual(expect.arrayContaining(['learn/01-sql-mi-overview.md', 'Learn-Reading-Set.docx', 'iac/main.bicep']))
    expect(renderDocx).toHaveBeenCalledOnce()
    expect(result.files.find((file) => file.kind === 'deck')).toMatchObject({ sourceLabel: 'GitHub AzureDataCommunity/Resources', sourceUrl: expect.stringContaining('github.com/AzureDataCommunity/Resources/blob/HEAD/') })
    const codes = result.gaps.map((gap) => `${gap.source}:${gap.code}`)
    expect(codes).toContain('Local synced folders:not-available-here')
    expect(codes).toContain('Seismic:not-configured')
    expect(codes).toContain('Microsoft 365 files:needs-consent')
    expect(result.summary).toMatch(/1 deck\(s\), 1 Learn page\(s\)/)
  })

  it('falls back to a labelled draft outline when no existing deck is found', async () => {
    const output = memoryOutput()
    const result = await createWorkingSessionService({ mode: 'live', openOutput: async () => output, fetcher: liveFetch(), now }).prepare(prepareRequest({ decks: true, learn: false, iac: false }))
    expect([...output.sink.files.keys()].some((path) => /^decks\/DRAFT-.*-outline\.pptx$/.test(path))).toBe(true)
    expect(output.sink.files.has('learn/index.md')).toBe(false)
    expect(result.gaps.some((gap) => gap.source === 'Existing decks' && gap.message.includes('DRAFT'))).toBe(true)
  })

  it('isolates failures: Learn being down does not stop the templates or the manifest', async () => {
    const output = memoryOutput()
    const result = await createWorkingSessionService({ mode: 'live', openOutput: async () => output, fetcher: liveFetch({ learn: 'down' }), now }).prepare(prepareRequest())
    expect(output.sink.files.has('iac/main.bicep')).toBe(true)
    expect(output.sink.files.has('manifest.json')).toBe(true)
    expect(result.gaps.some((gap) => gap.deliverable === 'learn' && gap.code === 'unavailable')).toBe(true)
    expect(result.gaps.some((gap) => gap.source === 'Existing decks' && gap.code === 'nothing-found')).toBe(true)
  })

  it('rejects a deck that is not a pptx and records why', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('raw.githubusercontent.com') ? new Response('<html>LFS pointer</html>') : liveFetch({ githubDeck: true })(input))
    const output = memoryOutput()
    const result = await createWorkingSessionService({ mode: 'live', openOutput: async () => output, fetcher, now }).prepare(prepareRequest({ decks: true, learn: false, iac: false }))
    expect([...output.sink.files.keys()].some((path) => path.endsWith('azure-arc-data-services.pptx'))).toBe(false)
    expect(result.gaps.some((gap) => gap.code === 'rejected')).toBe(true)
  })

  it('requires at least one deliverable and a strict request', () => {
    expect(workingSessionPrepareRequestSchema.safeParse({ ...prepareRequest(), deliverables: { decks: false, learn: false, iac: false } }).success).toBe(false)
    expect(workingSessionPrepareRequestSchema.safeParse({ ...prepareRequest(), extra: 1 }).success).toBe(false)
  })

  it('delivers a zip for hosted surfaces', async () => {
    const store = new DownloadStore()
    const service = createWorkingSessionService({ mode: 'sample', openOutput: async (folder) => zipOutput(store, 'alice@contoso.com', folder), now })
    const result = await service.prepare(prepareRequest({ decks: false, learn: true, iac: true }))
    expect(result.delivery.kind).toBe('download')
    if (result.delivery.kind !== 'download') return
    const stored = store.get('alice@contoso.com', result.delivery.downloadId)!
    const zip = await JSZip.loadAsync(stored.bytes)
    expect(zip.file('ARC ENABLED SQL - POC/iac/main.bicep')).not.toBeNull()
    expect(zip.file('ARC ENABLED SQL - POC/manifest.json')).not.toBeNull()
    expect(store.get('mallory@contoso.com', result.delivery.downloadId)).toBeUndefined()
  })
})

describe('deck configuration', () => {
  it('uses OneDrive, Downloads and TLC_DECK_LIBRARY_PATHS, and a configurable repository allowlist', () => {
    const configuration = deckConfigurationFromEnvironment({ TLC_DECK_LIBRARY_PATHS: 'D:\\Decks; E:\\More', OneDrive: 'C:\\Users\\x\\OneDrive', USERPROFILE: 'C:\\Users\\x', TLC_DECK_GITHUB_REPOS: 'a/b, c/d' })
    expect(configuration.localDeckRoots).toEqual(['D:\\Decks', 'E:\\More', 'C:\\Users\\x\\OneDrive', 'C:\\Users\\x\\Downloads'])
    expect(configuration.githubRepositories).toEqual(['a/b', 'c/d'])
    expect(deckConfigurationFromEnvironment({}).githubRepositories).toEqual(['AzureDataCommunity/Resources'])
  })
})
