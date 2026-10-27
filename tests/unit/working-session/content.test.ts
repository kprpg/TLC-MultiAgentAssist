import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workingSessionTopicSchema, type WorkingSessionTopic } from '../../../packages/common/contracts/working-session.js'
import { GitHubDeckSource, LocalDeckSource, Microsoft365DeckSource, scoreDeck, SeismicDeckSource, selectDecks, type DeckCandidate } from '../../../packages/orchestrator/working-session/decks.js'
import { canonicalLearnUrl, gatherLearnPages, LearnMcpClient, writeLearnSet } from '../../../packages/orchestrator/working-session/learn.js'
import { MemorySink } from '../../../packages/orchestrator/working-session/sinks.js'
import { buildDraftOutlineDeck } from '../../../packages/orchestrator/working-session/pptx-draft.js'

const topic: WorkingSessionTopic = workingSessionTopicSchema.parse({
  topic: 'Azure Arc-enabled SQL', domain: 'Hybrid', azureServices: ['Azure Arc', 'SQL Managed Instance enabled by Azure Arc'],
  deckQueries: ['Azure Arc-enabled SQL Managed Instance', 'Azure Arc data services'], learnQueries: ['SQL Managed Instance enabled by Azure Arc overview', 'Azure Arc data services prerequisites'],
  iacScenario: 'Arc POC', confidence: 'high', basis: 'rules', evidence: ['ARC ENABLED SQL']
})

const sse = (payload: unknown) => `event: message\ndata: ${JSON.stringify(payload)}\n\n`
const toolResult = (text: string) => sse({ result: { content: [{ type: 'text', text }] } })

function learnFetch(handlers: { search?: unknown; pages?: Record<string, string>; status?: number }) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    if (handlers.status) return new Response('nope', { status: handlers.status })
    const body = JSON.parse(String(init?.body)) as { params: { name: string; arguments: { query?: string; url?: string } } }
    if (body.params.name === 'microsoft_docs_search') return new Response(toolResult(JSON.stringify(handlers.search ?? { results: [] })))
    const page = handlers.pages?.[body.params.arguments.url ?? '']
    return page === undefined ? new Response(toolResult('{"error":1}').replace('"type":"text"', '"type":"nope"')) : new Response(toolResult(page))
  })
}

describe('Microsoft Learn client', () => {
  it('only accepts https Learn pages and strips query and fragment', () => {
    expect(canonicalLearnUrl('https://learn.microsoft.com/en-us/azure/x/?view=a#b')).toBe('https://learn.microsoft.com/en-us/azure/x')
    for (const bad of ['http://learn.microsoft.com/a', 'https://evil.com/a', 'https://learn.microsoft.com.evil.com/a', 'https://u:p@learn.microsoft.com/a', 'not a url']) expect(canonicalLearnUrl(bad)).toBeUndefined()
  })

  it('parses MCP search results and drops non-Learn links', async () => {
    const fetcher = learnFetch({ search: { results: [
      { title: 'One', content: '# One\nbody', contentUrl: 'https://learn.microsoft.com/azure/a' },
      { title: 'Evil', content: 'x', contentUrl: 'https://evil.com/a' },
      { title: 'Two', content: 'y', contentUrl: 'https://learn.microsoft.com/azure/b?x=1' }
    ] } })
    const hits = await new LearnMcpClient(fetcher).search('q', 5)
    expect(hits.map((hit) => hit.url)).toEqual(['https://learn.microsoft.com/azure/a', 'https://learn.microsoft.com/azure/b'])
    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).toBe('https://learn.microsoft.com/api/mcp')
    expect(init?.redirect).toBe('error')
  })

  it('refuses to fetch a non-Learn page and reports transport failures plainly', async () => {
    await expect(new LearnMcpClient(learnFetch({})).fetchPage('https://evil.com/x')).rejects.toMatchObject({ code: 'rejected' })
    await expect(new LearnMcpClient(learnFetch({ status: 503 })).search('q', 5)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('gathers distinct pages across queries, falling back to the excerpt when a fetch fails', async () => {
    const results = { results: [
      { title: 'A', content: '# A\nexcerpt a', contentUrl: 'https://learn.microsoft.com/azure/a' },
      { title: 'B', content: '# B\nexcerpt b', contentUrl: 'https://learn.microsoft.com/azure/b' }
    ] }
    const pages = await gatherLearnPages(topic, new LearnMcpClient(learnFetch({ search: results, pages: { 'https://learn.microsoft.com/azure/a': '# A full\n\n## Section\n\nbody' } })), { maximumPages: 8 })
    expect(pages.map((page) => page.title)).toEqual(['A full', 'B'])
    expect(pages[1]!.markdown).toContain('excerpt b')
  })

  it('writes numbered Markdown, an index with sources, and combined text for the Word document', async () => {
    const sink = new MemorySink()
    const result = await writeLearnSet([
      { title: 'SQL MI overview', url: 'https://learn.microsoft.com/azure/a', markdown: '# SQL MI overview\n\n## Features\n\ntext' },
      { title: 'Prerequisites', url: 'https://learn.microsoft.com/azure/b', markdown: 'plain text' }
    ], topic, sink, new Date('2026-10-25T00:00:00Z'))
    expect([...sink.files.keys()].sort()).toEqual(['learn/01-sql-mi-overview.md', 'learn/02-prerequisites.md', 'learn/index.md'])
    expect(sink.text('learn/01-sql-mi-overview.md')).toContain('Source: https://learn.microsoft.com/azure/a')
    expect(sink.text('learn/index.md')).toContain('Retrieved 2026-10-25')
    expect(result.combinedMarkdown).toContain('## 1. SQL MI overview')
    expect(result.files.every((file) => file.kind === 'learn')).toBe(true)
  })
})

describe('deck scoring and selection', () => {
  it('scores topical decks above unrelated ones and ignores generic words', () => {
    expect(scoreDeck(topic, 'Azure Arc enabled Data Services/L200 Azure Arc Enabled data services customer BDM presentation')).toBeGreaterThanOrEqual(2)
    expect(scoreDeck(topic, 'Azure Arc enabled SQL Managed Instance')).toBeGreaterThan(scoreDeck(topic, 'Azure Arc enabled Data Services/Roadmap'))
    expect(scoreDeck(topic, 'Azure Virtual Desktop and Bicep conference 2018')).toBe(0)
    expect(scoreDeck(topic, 'azure microsoft overview')).toBe(0)
  })

  it('limits per source and overall, and de-duplicates by title', () => {
    const make = (title: string, score: number, source: string): DeckCandidate => ({ id: `${source}${title}`, title, score, sourceLabel: source })
    const picked = selectDecks([
      [make('A', 9, 's1'), make('B', 8, 's1'), make('C', 7, 's1'), make('D', 6, 's1')],
      [make('a', 5, 's2'), make('E', 4, 's2')]
    ], 3, 4)
    expect(picked.map((deck) => deck.title)).toEqual(['A', 'B', 'C', 'E'])
  })
})

describe('LocalDeckSource', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tlc-decks-'))
    await mkdir(join(root, 'Arc', 'node_modules'), { recursive: true })
    await writeFile(join(root, 'Arc', 'Azure Arc enabled SQL Managed Instance.pptx'), 'PK-deck')
    await writeFile(join(root, 'Arc', '~$Azure Arc enabled SQL Managed Instance.pptx'), 'lock')
    await writeFile(join(root, 'Arc', 'Azure Arc notes.docx'), 'doc')
    await writeFile(join(root, 'Arc', 'node_modules', 'Azure Arc SQL.pptx'), 'skip')
    await writeFile(join(root, 'Unrelated deck.pptx'), 'PK')
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('finds matching .pptx files only, skipping lock files, other types and node_modules', async () => {
    const result = await new LocalDeckSource([root]).find(topic)
    expect(result.candidates.map((candidate) => candidate.title)).toEqual(['Azure Arc enabled SQL Managed Instance'])
    expect(Buffer.from(await result.candidates[0]!.load!()).toString()).toBe('PK-deck')
  })

  it('says when nothing matches or no folder is configured', async () => {
    expect((await new LocalDeckSource([root]).find({ ...topic, topic: 'Quantum', azureServices: ['Quantum'], deckQueries: ['Quantum'] })).gap?.code).toBe('nothing-found')
    expect((await new LocalDeckSource([]).find(topic)).gap?.code).toBe('not-configured')
  })

  it('respects the depth and visit budgets', async () => {
    expect((await new LocalDeckSource([root], { maximumVisited: 1 }).find(topic)).candidates.length).toBeLessThanOrEqual(1)
  })
})

describe('GitHubDeckSource', () => {
  const tree = { tree: [
    { path: 'Azure Arc enabled Data Services/L200 Azure Arc SQL Managed Instance.pptx', type: 'blob', size: 1000 },
    { path: 'Azure Arc enabled Data Services/huge Arc SQL Managed Instance.pptx', type: 'blob', size: 900_000_000 },
    { path: 'README.md', type: 'blob', size: 10 },
    { path: 'unrelated/Bicep.pptx', type: 'blob', size: 10 }
  ] }

  it('lists matching decks with a github link, skips oversized ones, and downloads with a size check', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes('api.github.com')
      ? new Response(JSON.stringify(tree)) : new Response(new Uint8Array([0x50, 0x4b, 3, 4, 9]), { headers: { 'content-length': '5' } }))
    const source = new GitHubDeckSource(['AzureDataCommunity/Resources'], fetcher)
    const result = await source.find(topic)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]!.sourceUrl).toBe('https://github.com/AzureDataCommunity/Resources/blob/HEAD/Azure%20Arc%20enabled%20Data%20Services/L200%20Azure%20Arc%20SQL%20Managed%20Instance.pptx')
    expect((await result.candidates[0]!.load!()).length).toBe(5)
    await source.find(topic)
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('api.github.com'))).toHaveLength(1)
  })

  it('ignores malformed repository names and reports rate limiting', async () => {
    const limited = new GitHubDeckSource(['bad name/..'], vi.fn<typeof fetch>())
    expect((await limited.find(topic)).gap?.code).toBe('nothing-found')
    const rate = new GitHubDeckSource(['a/b'], vi.fn<typeof fetch>(async () => new Response('', { status: 403 })))
    expect((await rate.find(topic)).gap).toMatchObject({ code: 'unavailable', message: expect.stringContaining('rate-limited') })
  })

  it('refuses a download that is larger than allowed', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes('api.github.com') ? new Response(JSON.stringify(tree)) : new Response(new Uint8Array(10), { headers: { 'content-length': '999999999' } }))
    const result = await new GitHubDeckSource(['a/b'], fetcher, { maximumBytes: 50_000_000 }).find(topic)
    await expect(result.candidates[0]!.load!()).rejects.toThrow('too-large')
  })
})

describe('Seismic and Microsoft 365 deck sources', () => {
  it('reports consent or configuration problems instead of failing', async () => {
    expect((await new SeismicDeckSource().find(topic)).gap?.code).toBe('not-configured')
    const unavailable = { searchKnowledge: vi.fn(async () => ({ contractVersion: '1.0', source: 'seismic-m365', mode: 'live', kind: 'unavailable', code: 'graph-auth-not-configured', message: 'No Graph token.', sourceHealth: { state: 'unauthorized', detail: 'x', checkedAt: '2026-10-25T00:00:00.000Z' } })) }
    expect((await new SeismicDeckSource(unavailable as never).find(topic)).gap?.code).toBe('needs-consent')
    expect((await new Microsoft365DeckSource().find(topic)).gap?.code).toBe('needs-consent')
  })

  it('returns Seismic hits as links only', async () => {
    const search = { searchKnowledge: vi.fn(async () => ({ contractVersion: '1.0', source: 'seismic-m365', mode: 'live', kind: 'results', hits: [{ id: 'h1', evidenceId: 'e1', source: 'seismic-m365', title: 'Azure Arc SQL MI deck', url: 'https://microsoft.seismic.com/app?ContentId=1' }], warnings: [], sourceHealth: { state: 'live', detail: 'x', checkedAt: '2026-10-25T00:00:00.000Z' } })) }
    const result = await new SeismicDeckSource(search as never).find(topic)
    expect(result.candidates[0]).toMatchObject({ title: 'Azure Arc SQL MI deck', sourceUrl: 'https://microsoft.seismic.com/app?ContentId=1' })
    expect(result.candidates[0]!.load).toBeUndefined()
  })

  it('maps a Graph denial on file search to needs-consent', async () => {
    const result = await new Microsoft365DeckSource(async () => 'token', vi.fn<typeof fetch>(async () => new Response('', { status: 403 }))).find(topic)
    expect(result.gap?.code).toBe('needs-consent')
  })

  it('finds and downloads Microsoft 365 pptx files when Graph allows it', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes('/search/query')
      ? new Response(JSON.stringify({ value: [{ hitsContainers: [{ hits: [{ resource: { id: 'i1', name: 'Azure Arc SQL Managed Instance.pptx', webUrl: 'https://contoso.sharepoint.com/x', size: 20, parentReference: { driveId: 'd1' } } }] }] }] }))
      : new Response(new Uint8Array([0x50, 0x4b, 1])))
    const result = await new Microsoft365DeckSource(async () => 'token', fetcher).find(topic)
    expect(result.candidates).toHaveLength(1)
    expect((await result.candidates[0]!.load!()).length).toBe(3)
  })
})

describe('draft outline deck', () => {
  it('is a well-formed pptx package, labelled as a draft, with escaped text', async () => {
    const bytes = await buildDraftOutlineDeck(topic, [
      { title: 'SQL MI <overview> & more', url: 'https://learn.microsoft.com/azure/a', markdown: '# t\n\n## Features\n\nx\n\n## Limits\n\ny' },
      { title: 'Prerequisites', url: 'https://learn.microsoft.com/azure/b', markdown: 'This is a long enough sentence to be used as a bullet point. Another sentence that is long enough as well.' }
    ], new Date('2026-10-25T00:00:00Z'))
    expect(bytes[0]).toBe(0x50)
    const zip = await JSZip.loadAsync(bytes)
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide5.xml']) expect(zip.file(part), part).not.toBeNull()
    const slide3 = await zip.file('ppt/slides/slide3.xml')!.async('string')
    expect(slide3).toContain('SQL MI &lt;overview&gt; &amp; more')
    expect(slide3).toContain('Features')
    expect(slide3).toContain('DRAFT')
    for (const name of Object.keys(zip.files).filter((file) => file.endsWith('.xml') || file.endsWith('.rels'))) {
      const xml = await zip.file(name)!.async('string')
      expect(xml.startsWith('<?xml'), name).toBe(true)
      expect((xml.match(/</g) ?? []).length, name).toBe((xml.match(/>/g) ?? []).length)
    }
  })
})
