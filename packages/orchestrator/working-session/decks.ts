import { opendir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { knowledgeContractVersion } from '../../common/contracts/knowledge.js'
import type { WorkingSessionGap, WorkingSessionTopic } from '../../common/contracts/working-session.js'
import type { KnowledgeSearch } from '../knowledge-search.js'

/** A deck we can copy (`load`) or only link to (no `load`). */
export interface DeckCandidate {
  id: string
  title: string
  sourceLabel: string
  sourceUrl?: string
  score: number
  sizeBytes?: number
  load?: () => Promise<Uint8Array>
}

export interface DeckFindResult { candidates: DeckCandidate[]; gap?: Omit<WorkingSessionGap, 'deliverable'> }

export interface DeckSource {
  readonly label: string
  find(topic: WorkingSessionTopic): Promise<DeckFindResult>
}

const genericTokens = new Set(['azure', 'microsoft', 'service', 'services', 'overview', 'enabled', 'and', 'the', 'for', 'with', 'using', 'from', 'what', 'deck', 'decks', 'presentation'])

function tokensOf(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2 && !genericTokens.has(token)))]
}

/** Keyword score over a title or path. A whole query phrase scores higher than loose words. */
export function scoreDeck(topic: WorkingSessionTopic, text: string): number {
  const haystack = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  const words = new Set(haystack.split(' ').filter(Boolean))
  let score = 0
  for (const query of [topic.topic, ...topic.deckQueries]) {
    const phrase = query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (phrase && haystack.includes(phrase)) score += 6
  }
  const tokens = tokensOf([topic.topic, ...topic.azureServices, ...topic.deckQueries].join(' '))
  let matched = 0
  for (const token of tokens) if (words.has(token)) matched += 1
  if (matched < 2 && score === 0) return 0
  return score + matched
}

export const minimumDeckScore = 2
export const isPptx = (bytes: Uint8Array): boolean => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b

export interface LocalDeckOptions { maximumDepth?: number; maximumVisited?: number; maximumBytes?: number }

/** Searches folders the user already syncs (OneDrive, SharePoint sync, a deck library). Desktop and VS Code only. */
export class LocalDeckSource implements DeckSource {
  readonly label = 'Local synced folders'
  constructor(private readonly roots: readonly string[], private readonly options: LocalDeckOptions = {}) {}

  async find(topic: WorkingSessionTopic): Promise<DeckFindResult> {
    if (!this.roots.length) return { candidates: [], gap: { source: this.label, code: 'not-configured', message: 'No local deck folders were found. Set TLC_DECK_LIBRARY_PATHS to a folder (or several, separated by semicolons) that holds your decks.' } }
    const maximumDepth = this.options.maximumDepth ?? 6
    const maximumVisited = this.options.maximumVisited ?? 30_000
    const maximumBytes = this.options.maximumBytes ?? 100_000_000
    const found: DeckCandidate[] = []
    let visited = 0
    const walk = async (directory: string, depth: number, root: string): Promise<void> => {
      let handle
      try { handle = await opendir(directory) } catch { return }
      for await (const entry of handle) {
        if (++visited > maximumVisited) return
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          if (depth < maximumDepth && !entry.name.startsWith('.') && entry.name !== 'node_modules') await walk(path, depth + 1, root)
        } else if (entry.isFile() && /\.pptx$/i.test(entry.name) && !entry.name.startsWith('~$')) {
          const score = scoreDeck(topic, relative(root, path).split(sep).join(' '))
          if (score >= minimumDeckScore) {
            const size = (await stat(path).catch(() => undefined))?.size
            if (size !== undefined && size <= maximumBytes) {
              found.push({ id: path, title: basename(entry.name, '.pptx'), sourceLabel: this.label, score, sizeBytes: size, load: () => readFile(path) })
            }
          }
        }
      }
    }
    for (const root of this.roots) await walk(root, 0, root)
    found.sort((left, right) => right.score - left.score)
    return found.length ? { candidates: found } : { candidates: [], gap: { source: this.label, code: 'nothing-found', message: `No matching decks were found in ${this.roots.length} local folder(s).` } }
  }
}

interface GitHubTree { tree?: Array<{ path?: string; type?: string; size?: number }>; truncated?: boolean }

export interface GitHubDeckOptions { token?: string; maximumBytes?: number; cacheMs?: number; now?: () => number }

/** Public repositories on an allowlist. Downloads .pptx only; the repository's own license still applies. */
export class GitHubDeckSource implements DeckSource {
  readonly label = 'Public GitHub decks'
  private readonly cache = new Map<string, { at: number; tree: GitHubTree }>()
  constructor(private readonly repositories: readonly string[], private readonly fetcher: typeof fetch = fetch, private readonly options: GitHubDeckOptions = {}) {}

  private async tree(repository: string): Promise<GitHubTree> {
    const now = (this.options.now ?? Date.now)()
    const cached = this.cache.get(repository)
    if (cached && now - cached.at < (this.options.cacheMs ?? 600_000)) return cached.tree
    const response = await this.fetcher(`https://api.github.com/repos/${repository}/git/trees/HEAD?recursive=1`, {
      redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'tlc-assist', ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}) }
    })
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'rate-limited' : `http-${response.status}`)
    const tree = await response.json() as GitHubTree
    this.cache.set(repository, { at: now, tree })
    return tree
  }

  async find(topic: WorkingSessionTopic): Promise<DeckFindResult> {
    const maximumBytes = this.options.maximumBytes ?? 60_000_000
    const candidates: DeckCandidate[] = []
    let failures = 0
    let rateLimited = false
    for (const repository of this.repositories) {
      if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) continue
      try {
        for (const item of (await this.tree(repository)).tree ?? []) {
          if (item.type !== 'blob' || !item.path || !/\.pptx$/i.test(item.path) || (item.size ?? 0) > maximumBytes) continue
          const score = scoreDeck(topic, item.path.replace(/\//g, ' '))
          if (score < minimumDeckScore) continue
          const encoded = item.path.split('/').map(encodeURIComponent).join('/')
          const raw = `https://raw.githubusercontent.com/${repository}/HEAD/${encoded}`
          candidates.push({
            id: `${repository}:${item.path}`, title: basename(item.path, '.pptx'), sourceLabel: `GitHub ${repository}`,
            sourceUrl: `https://github.com/${repository}/blob/HEAD/${encoded}`, score, ...(item.size === undefined ? {} : { sizeBytes: item.size }),
            load: async () => {
              const response = await this.fetcher(raw, { redirect: 'error', signal: AbortSignal.timeout(120_000) })
              if (!response.ok) throw new Error('download-failed')
              const length = Number(response.headers.get('content-length') ?? 0)
              if (length > maximumBytes) throw new Error('too-large')
              const bytes = new Uint8Array(await response.arrayBuffer())
              if (bytes.length > maximumBytes) throw new Error('too-large')
              return bytes
            }
          })
        }
      } catch (error) {
        failures += 1
        if (error instanceof Error && error.message === 'rate-limited') rateLimited = true
      }
    }
    candidates.sort((left, right) => right.score - left.score)
    if (candidates.length) return { candidates }
    if (failures === this.repositories.length && this.repositories.length) {
      return { candidates: [], gap: { source: this.label, code: 'unavailable', message: rateLimited ? 'GitHub rate-limited this request. Try again later.' : 'GitHub could not be reached.' } }
    }
    return { candidates: [], gap: { source: this.label, code: 'nothing-found', message: 'No matching public decks were found in the allowlisted repositories.' } }
  }
}

/** Seismic through the existing knowledge search. It returns links and snippets; the file itself is not downloaded. */
export class SeismicDeckSource implements DeckSource {
  readonly label = 'Seismic'
  constructor(private readonly search?: KnowledgeSearch) {}

  async find(topic: WorkingSessionTopic): Promise<DeckFindResult> {
    if (!this.search) return { candidates: [], gap: { source: this.label, code: 'not-configured', message: 'Seismic search is not available on this connection.' } }
    const candidates: DeckCandidate[] = []
    for (const query of topic.deckQueries.slice(0, 2)) {
      const result = await this.search.searchKnowledge({ contractVersion: knowledgeContractVersion, query, source: 'seismic-m365', filters: { fileTypes: ['pptx', 'ppt'] }, limit: 5 })
      if (result.kind === 'unavailable') {
        const consent = result.sourceHealth.state === 'unauthorized' || result.code === 'graph-auth-not-configured'
        return { candidates, gap: { source: this.label, code: consent ? 'needs-consent' : 'not-configured', message: `${result.message}`.slice(0, 500) } }
      }
      for (const hit of result.hits) {
        if (candidates.some((existing) => existing.id === hit.id)) continue
        candidates.push({ id: hit.id, title: hit.title, sourceLabel: this.label, sourceUrl: hit.url, score: Math.max(minimumDeckScore, scoreDeck(topic, hit.title)) })
      }
    }
    return candidates.length ? { candidates } : { candidates, gap: { source: this.label, code: 'nothing-found', message: 'Seismic returned no matching presentations.' } }
  }
}

interface GraphSearchResponse { value?: Array<{ hitsContainers?: Array<{ hits?: Array<{ resource?: { id?: string; name?: string; webUrl?: string; size?: number; parentReference?: { driveId?: string } } }> }> }> }

/** Microsoft 365 file search (OneDrive and SharePoint) through Graph. Inert until a Graph token with file access exists. */
export class Microsoft365DeckSource implements DeckSource {
  readonly label = 'Microsoft 365 files'
  constructor(private readonly getToken?: () => Promise<string>, private readonly fetcher: typeof fetch = fetch, private readonly maximumBytes = 60_000_000) {}

  async find(topic: WorkingSessionTopic): Promise<DeckFindResult> {
    if (!this.getToken) return { candidates: [], gap: { source: this.label, code: 'needs-consent', message: 'Microsoft 365 file search needs Files.Read.All consent, which this connection does not have.' } }
    let token: string
    try { token = await this.getToken() } catch { return { candidates: [], gap: { source: this.label, code: 'needs-consent', message: 'Microsoft 365 file search needs a Graph sign-in with file access.' } } }
    const candidates: DeckCandidate[] = []
    for (const query of topic.deckQueries.slice(0, 2)) {
      const response = await this.fetcher('https://graph.microsoft.com/v1.0/search/query', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requests: [{ entityTypes: ['driveItem'], query: { queryString: `${query} filetype:pptx` }, from: 0, size: 10 }] })
      })
      if (response.status === 401 || response.status === 403) return { candidates, gap: { source: this.label, code: 'needs-consent', message: 'Microsoft 365 file search was denied. It needs delegated Files.Read.All or Sites.Read.All consent.' } }
      if (!response.ok) return { candidates, gap: { source: this.label, code: 'unavailable', message: `Microsoft 365 file search returned HTTP ${response.status}.` } }
      const body = await response.json() as GraphSearchResponse
      for (const hit of body.value?.[0]?.hitsContainers?.[0]?.hits ?? []) {
        const resource = hit.resource
        if (!resource?.id || !resource.name || !/\.pptx$/i.test(resource.name) || (resource.size ?? 0) > this.maximumBytes) continue
        if (candidates.some((existing) => existing.id === resource.id)) continue
        const driveId = resource.parentReference?.driveId
        const webUrl = resource.webUrl && /^https:\/\//.test(resource.webUrl) ? resource.webUrl : undefined
        candidates.push({
          id: resource.id, title: basename(resource.name, '.pptx'), sourceLabel: this.label, ...(webUrl ? { sourceUrl: webUrl } : {}),
          score: Math.max(minimumDeckScore, scoreDeck(topic, resource.name)), ...(resource.size === undefined ? {} : { sizeBytes: resource.size }),
          ...(driveId ? {
            load: async () => {
              const content = await this.fetcher(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(resource.id!)}/content`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) })
              if (!content.ok) throw new Error('download-failed')
              const bytes = new Uint8Array(await content.arrayBuffer())
              if (bytes.length > this.maximumBytes) throw new Error('too-large')
              return bytes
            }
          } : {})
        })
      }
    }
    return candidates.length ? { candidates } : { candidates, gap: { source: this.label, code: 'nothing-found', message: 'Microsoft 365 file search returned no matching presentations.' } }
  }
}

/** Highest scoring first, at most `perSource` from one source and `total` overall, de-duplicated by title. */
export function selectDecks(groups: ReadonlyArray<readonly DeckCandidate[]>, perSource = 3, total = 5): DeckCandidate[] {
  const picked: DeckCandidate[] = []
  const titles = new Set<string>()
  for (const group of groups) {
    for (const candidate of [...group].sort((left, right) => right.score - left.score).slice(0, perSource)) {
      const key = candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, '')
      if (titles.has(key)) continue
      titles.add(key)
      picked.push(candidate)
    }
  }
  return picked.sort((left, right) => right.score - left.score).slice(0, total)
}
