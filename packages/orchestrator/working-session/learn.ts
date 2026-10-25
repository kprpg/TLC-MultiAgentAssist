import { fileSlug } from './folder-name.js'
import type { ArtifactSink } from './sinks.js'
import type { WorkingSessionFile, WorkingSessionTopic } from '../../common/contracts/working-session.js'

export interface LearnPage { title: string; url: string; markdown: string }
export interface LearnHit { title: string; url: string; excerpt: string }

/** Search and fetch for Microsoft Learn content. */
export interface LearnSource {
  search(query: string, limit: number): Promise<LearnHit[]>
  fetchPage(url: string): Promise<LearnPage>
}

const learnHost = 'learn.microsoft.com'
const mcpEndpoint = `https://${learnHost}/api/mcp`
const maximumPageBytes = 400_000

export class LearnSourceError extends Error {
  constructor(readonly code: 'unavailable' | 'rejected', message: string) { super(message); this.name = 'LearnSourceError' }
}

/** Learn pages only: HTTPS, the Learn host, no credentials, query and fragment removed. */
export function canonicalLearnUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== learnHost || url.username || url.password) return undefined
    url.search = ''; url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch { return undefined }
}

function sseJson(text: string): unknown {
  const data = text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
  return JSON.parse(data || text)
}

/** Microsoft Learn through its public MCP endpoint (no sign-in). */
export class LearnMcpClient implements LearnSource {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 25_000) {}

  private async call(name: string, args: Record<string, string>): Promise<string> {
    let response: Response
    try {
      response = await this.fetcher(mcpEndpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
      })
    } catch { throw new LearnSourceError('unavailable', 'Microsoft Learn could not be reached.') }
    if (!response.ok) throw new LearnSourceError('unavailable', `Microsoft Learn returned HTTP ${response.status}.`)
    const raw = await response.text()
    if (raw.length > maximumPageBytes * 3) throw new LearnSourceError('rejected', 'Microsoft Learn returned an unexpectedly large response.')
    try {
      const envelope = sseJson(raw) as { result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean }; error?: unknown }
      const text = envelope.result?.content?.find((part) => part.type === 'text')?.text
      if (envelope.error || envelope.result?.isError || typeof text !== 'string') throw new Error('tool error')
      return text
    } catch { throw new LearnSourceError('unavailable', 'Microsoft Learn returned an unreadable response.') }
  }

  async search(query: string, limit: number): Promise<LearnHit[]> {
    const text = await this.call('microsoft_docs_search', { query })
    let parsed: { results?: Array<{ title?: string; content?: string; contentUrl?: string }> }
    try { parsed = JSON.parse(text) } catch { return [] }
    const hits: LearnHit[] = []
    for (const result of parsed.results ?? []) {
      const url = result.contentUrl ? canonicalLearnUrl(result.contentUrl) : undefined
      if (!url || !result.title) continue
      hits.push({ title: result.title.slice(0, 300), url, excerpt: (result.content ?? '').slice(0, 20_000) })
      if (hits.length >= limit) break
    }
    return hits
  }

  async fetchPage(url: string): Promise<LearnPage> {
    const safe = canonicalLearnUrl(url)
    if (!safe) throw new LearnSourceError('rejected', 'Only Microsoft Learn pages can be retrieved.')
    const markdown = (await this.call('microsoft_docs_fetch', { url: safe })).slice(0, maximumPageBytes)
    const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim().slice(0, 300) ?? safe
    return { title, url: safe, markdown }
  }
}

export interface LearnSetOptions { maximumPages?: number; now?: Date }

/** Finds distinct Learn pages for the topic and returns their Markdown. A page that cannot be fetched falls back to its search excerpt. */
export async function gatherLearnPages(topic: WorkingSessionTopic, source: LearnSource, options: LearnSetOptions = {}): Promise<LearnPage[]> {
  const maximum = options.maximumPages ?? 8
  const seen = new Map<string, LearnHit>()
  let reached = false
  for (const query of topic.learnQueries) {
    try {
      for (const hit of await source.search(query, 5)) {
        if (!seen.has(hit.url)) seen.set(hit.url, hit)
        if (seen.size >= maximum) { reached = true; break }
      }
    } catch (error) {
      if (seen.size === 0 && query === topic.learnQueries[topic.learnQueries.length - 1]) throw error
    }
    if (reached) break
  }
  const pages: LearnPage[] = []
  for (const hit of [...seen.values()].slice(0, maximum)) {
    try { pages.push(await source.fetchPage(hit.url)) } catch {
      if (hit.excerpt.trim()) pages.push({ title: hit.title, url: hit.url, markdown: hit.excerpt })
    }
  }
  return pages
}

export interface LearnSetResult { files: WorkingSessionFile[]; combinedMarkdown: string }

/** Writes `learn/NN-slug.md` per page plus an index; returns the combined Markdown for the reading-set document. */
export async function writeLearnSet(pages: LearnPage[], topic: WorkingSessionTopic, sink: ArtifactSink, retrieved: Date): Promise<LearnSetResult> {
  const files: WorkingSessionFile[] = []
  const date = retrieved.toISOString().slice(0, 10)
  const index: string[] = [`# Microsoft Learn reading set: ${topic.topic}`, '', `Retrieved ${date} from Microsoft Learn. Content belongs to Microsoft; each page links back to its source.`, '']
  const combined: string[] = [`# Microsoft Learn reading set: ${topic.topic}`, '', `Retrieved ${date}. Each section links to its Microsoft Learn source.`, '']
  let number = 0
  for (const page of pages) {
    number += 1
    const prefix = String(number).padStart(2, '0')
    const body = `# ${page.title}\n\nSource: ${page.url}\nRetrieved: ${date}\n\n${page.markdown.replace(/^#\s+.+\r?\n/, '')}\n`
    const written = await sink.write(`learn/${prefix}-${fileSlug(page.title)}.md`, body)
    files.push({ path: written.path, kind: 'learn', title: page.title, sourceLabel: 'Microsoft Learn', sourceUrl: page.url, bytes: written.bytes })
    index.push(`${number}. [${page.title}](${page.url}) - \`${written.path}\``)
    combined.push(`## ${number}. ${page.title}`, '', `Source: ${page.url}`, '', page.markdown.replace(/^#\s+.+\r?\n/, '').replace(/^(#{1,5})\s/gm, '$1# '), '')
  }
  const indexFile = await sink.write('learn/index.md', `${index.join('\n')}\n`)
  files.push({ path: indexFile.path, kind: 'learn', title: 'Learn reading set index', sourceLabel: 'Microsoft Learn', bytes: indexFile.bytes })
  return { files, combinedMarkdown: combined.join('\n') }
}
