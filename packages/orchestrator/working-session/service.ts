import {
  workingSessionContractVersion, workingSessionPrepareRequestSchema, workingSessionResultSchema,
  workingSessionTopicRequestSchema, workingSessionTopicResponseSchema,
  type WorkingSessionFile, type WorkingSessionGap, type WorkingSessionResult, type WorkingSessionTopicResponse
} from '../../common/contracts/working-session.js'
import type { KnowledgeSearch } from '../knowledge-search.js'
import { Microsoft365DeckSource, GitHubDeckSource, LocalDeckSource, SeismicDeckSource, isPptx, selectDecks, type DeckCandidate, type DeckSource } from './decks.js'
import { generateIac, type IacCompiler } from './iac.js'
import { fileSlug, workingSessionFolderName } from './folder-name.js'
import { gatherLearnPages, LearnMcpClient, writeLearnSet, type LearnPage, type LearnSource } from './learn.js'
import type { WorkingSessionOutput } from './outputs.js'
import { sampleLearnSource } from './sample.js'
import { buildDraftOutlineDeck } from './pptx-draft.js'
import { deriveTopic, scenarioForTopic, type StructuredModel } from './topic.js'

export interface WorkingSessionOptions {
  mode: 'sample' | 'live'
  learn: LearnSource
  deckSources: readonly DeckSource[]
  openOutput(folderName: string): Promise<WorkingSessionOutput>
  model?: StructuredModel
  compiler?: IacCompiler
  /** Renders Markdown as a .docx; supplied by hosts from the shared documents package. */
  renderDocx?: (title: string, markdown: string) => Promise<Uint8Array>
  maximumDeckBytes?: number
  now?: () => Date
}

class UnavailableDeckSource implements DeckSource {
  constructor(readonly label: string, private readonly code: 'not-available-here' | 'not-configured', private readonly message: string) {}
  async find() { return { candidates: [], gap: { source: this.label, code: this.code, message: this.message } } }
}

export class WorkingSessionService {
  constructor(private readonly options: WorkingSessionOptions) {}

  async deriveTopic(input: unknown): Promise<WorkingSessionTopicResponse> {
    const request = workingSessionTopicRequestSchema.parse(input)
    const { topic } = await deriveTopic(request, this.options.mode === 'live' ? this.options.model : undefined)
    return workingSessionTopicResponseSchema.parse({ contractVersion: workingSessionContractVersion, mode: this.options.mode, topic })
  }

  async prepare(input: unknown): Promise<WorkingSessionResult> {
    const request = workingSessionPrepareRequestSchema.parse(input)
    const { topic, deliverables } = request
    const now = (this.options.now ?? (() => new Date()))()
    const folderName = workingSessionFolderName(request.opportunityName, request.milestoneName)
    const output = await this.options.openOutput(folderName)
    const files: WorkingSessionFile[] = []
    const gaps: WorkingSessionGap[] = []
    const maximumDeckBytes = this.options.maximumDeckBytes ?? 60_000_000

    let pagesPromise: Promise<LearnPage[]> | undefined
    const pages = () => (pagesPromise ??= gatherLearnPages(topic, this.options.learn, { now }))

    if (deliverables.learn) {
      try {
        const gathered = await pages()
        if (!gathered.length) gaps.push({ deliverable: 'learn', source: 'Microsoft Learn', code: 'nothing-found', message: 'No Microsoft Learn pages matched the topic.' })
        else {
          const set = await writeLearnSet(gathered, topic, output.sink, now)
          files.push(...set.files)
          if (this.options.renderDocx) {
            try {
              const document = await output.sink.write('Learn-Reading-Set.docx', await this.options.renderDocx(`Microsoft Learn reading set - ${topic.topic}`, set.combinedMarkdown))
              files.push({ path: document.path, kind: 'learn', title: 'Learn reading set (Word)', sourceLabel: 'Microsoft Learn', bytes: document.bytes })
            } catch { gaps.push({ deliverable: 'learn', source: 'Word document', code: 'unavailable', message: 'The combined Word document could not be created; the Markdown pages were saved.' }) }
          }
        }
      } catch (error) {
        gaps.push({ deliverable: 'learn', source: 'Microsoft Learn', code: 'unavailable', message: error instanceof Error ? error.message.slice(0, 300) : 'Microsoft Learn could not be reached.' })
      }
    }

    if (deliverables.decks) await this.prepareDecks(request, output, files, gaps, maximumDeckBytes, pages, now)

    if (deliverables.iac) {
      try {
        const iac = await generateIac({ topic, scenario: scenarioForTopic(topic), sink: output.sink, ...(this.options.model ? { model: this.options.model } : {}), ...(this.options.compiler ? { compiler: this.options.compiler } : {}) })
        files.push(...iac.files)
        gaps.push(...iac.gaps.map((gap) => this.options.mode === 'sample' && gap.code === 'tool-missing'
          ? { ...gap, message: 'Sample mode does not compile the ARM template. Run "az bicep build --file main.bicep" to produce it.' } : gap))
      } catch { gaps.push({ deliverable: 'iac', source: 'Templates', code: 'unavailable', message: 'The deployment templates could not be created.' }) }
    }

    const counts = { decks: files.filter((file) => file.kind === 'deck').length, learn: files.filter((file) => file.kind === 'learn' && file.path.endsWith('.md') && !file.path.endsWith('index.md')).length, iac: files.filter((file) => file.kind === 'iac' && /\.(bicep|json)$/.test(file.path)).length }
    const summary = `Prepared ${files.length} file(s): ${counts.decks} deck(s), ${counts.learn} Learn page(s), ${counts.iac} template file(s)${gaps.length ? `; ${gaps.length} item(s) need attention` : ''}.`

    const readme = this.readme(request.opportunityName, request.milestoneName, topic.topic, now, files, gaps)
    const readmeFile = await output.sink.write('README.md', readme)
    files.push({ path: readmeFile.path, kind: 'manifest', title: 'About this folder', sourceLabel: 'TLC Assist', bytes: readmeFile.bytes })
    const manifest = await output.sink.write('manifest.json', `${JSON.stringify({ contractVersion: workingSessionContractVersion, generatedAt: now.toISOString(), mode: this.options.mode, topic, files, gaps }, null, 2)}\n`)
    files.push({ path: manifest.path, kind: 'manifest', title: 'Manifest', sourceLabel: 'TLC Assist', bytes: manifest.bytes })

    return workingSessionResultSchema.parse({
      contractVersion: workingSessionContractVersion, mode: this.options.mode, folderName,
      delivery: await output.finish(), files, gaps, summary
    })
  }

  private async prepareDecks(request: ReturnType<typeof workingSessionPrepareRequestSchema.parse>, output: WorkingSessionOutput, files: WorkingSessionFile[], gaps: WorkingSessionGap[], maximumDeckBytes: number, pages: () => Promise<LearnPage[]>, now: Date): Promise<void> {
    const { topic } = request
    const sources = this.options.deckSources
    const results = await Promise.allSettled(sources.map((source) => source.find(topic)))
    const groups: DeckCandidate[][] = []
    results.forEach((result, index) => {
      const label = sources[index]?.label ?? 'Deck source'
      if (result.status === 'rejected') { gaps.push({ deliverable: 'decks', source: label, code: 'unavailable', message: `${label} could not be searched.` }); return }
      groups.push(result.value.candidates)
      if (result.value.gap) gaps.push({ deliverable: 'decks', ...result.value.gap })
    })
    if (this.options.mode === 'sample') gaps.push({ deliverable: 'decks', source: 'Sample mode', code: 'not-available-here', message: 'Sample mode does not search deck libraries.' })

    const picked = selectDecks(groups)
    const links: DeckCandidate[] = []
    let copied = 0
    for (const candidate of picked) {
      if (!candidate.load) { links.push(candidate); continue }
      try {
        const bytes = await candidate.load()
        if (!isPptx(bytes) || bytes.length > maximumDeckBytes) throw new Error('rejected')
        const written = await output.sink.write(`decks/${fileSlug(candidate.title, 80)}.pptx`, bytes)
        files.push({ path: written.path, kind: 'deck', title: candidate.title, sourceLabel: candidate.sourceLabel, ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}), bytes: written.bytes })
        copied += 1
      } catch {
        if (candidate.sourceUrl) links.push(candidate)
        gaps.push({ deliverable: 'decks', source: candidate.sourceLabel, code: 'rejected', message: `"${candidate.title}" could not be copied (download failed, not a .pptx, or too large).`.slice(0, 600) })
      }
    }
    if (links.length) {
      const body = ['# Decks to open', '', 'These presentations were found but could not be copied. Open them from the link.', '', ...links.map((link) => `- [${link.title}](${link.sourceUrl ?? ''}) - ${link.sourceLabel}`), ''].join('\n')
      const written = await output.sink.write('decks/links.md', body)
      files.push({ path: written.path, kind: 'deck', title: 'Deck links', sourceLabel: 'TLC Assist', bytes: written.bytes })
    }
    if (!copied && !links.length) {
      try {
        const gathered = await pages()
        if (!gathered.length) throw new Error('no pages')
        const bytes = await buildDraftOutlineDeck(topic, gathered, now)
        const written = await output.sink.write(`decks/DRAFT-${fileSlug(topic.topic, 50)}-outline.pptx`, bytes)
        files.push({ path: written.path, kind: 'deck', title: `DRAFT outline - ${topic.topic}`, sourceLabel: 'TLC Assist (from Microsoft Learn)', bytes: written.bytes })
        gaps.push({ deliverable: 'decks', source: 'Existing decks', code: 'nothing-found', message: 'No existing deck was found, so a labelled DRAFT outline deck was generated from the Learn pages. Review and edit it before presenting.' })
      } catch {
        gaps.push({ deliverable: 'decks', source: 'Existing decks', code: 'nothing-found', message: 'No existing deck was found and no Learn content was available to draft an outline.' })
      }
    }
  }

  private readme(opportunity: string, milestone: string, topic: string, now: Date, files: WorkingSessionFile[], gaps: WorkingSessionGap[]): string {
    const sections = (kind: WorkingSessionFile['kind'], heading: string) => {
      const items = files.filter((file) => file.kind === kind)
      return items.length ? [`## ${heading}`, '', ...items.map((file) => `- \`${file.path}\` - ${file.title} (${file.sourceLabel}${file.sourceUrl ? `, ${file.sourceUrl}` : ''})`), ''] : []
    }
    return [
      `# Working session: ${opportunity} - ${milestone}`, '', `Topic: **${topic}**`, `Prepared ${now.toISOString().slice(0, 10)} by TLC Assist (${this.options.mode} mode).`, '',
      'Everything here is a starting point. Decks come from places you can already read; Learn pages link to their source; templates are drafts that TLC never deploys.', '',
      ...sections('deck', 'Decks'), ...sections('learn', 'Microsoft Learn'), ...sections('iac', 'Deployment templates'),
      ...(gaps.length ? ['## Not available or needs attention', '', ...gaps.map((gap) => `- **${gap.deliverable} / ${gap.source}** (${gap.code}): ${gap.message}`), ''] : [])
    ].join('\n')
  }
}

export interface WorkingSessionFactoryOptions {
  mode: 'sample' | 'live'
  openOutput(folderName: string): Promise<WorkingSessionOutput>
  model?: StructuredModel
  compiler?: IacCompiler
  renderDocx?: WorkingSessionOptions['renderDocx']
  fetcher?: typeof fetch
  knowledgeSearch?: KnowledgeSearch
  /** Present only where the host can read the user's own disk (Desktop, VS Code). */
  localDeckRoots?: readonly string[]
  githubRepositories?: readonly string[]
  githubToken?: string
  getFileGraphToken?: () => Promise<string>
  maximumDeckBytes?: number
  now?: () => Date
}

export const defaultDeckRepositories = ['AzureDataCommunity/Resources'] as const

/** Deck folders and allowlisted repositories from the environment. Local roots default to OneDrive and Downloads. */
export function deckConfigurationFromEnvironment(environment: Readonly<Record<string, string | undefined>>): { localDeckRoots: string[]; githubRepositories: string[] } {
  const configured = (environment['TLC_DECK_LIBRARY_PATHS'] ?? '').split(';').map((value) => value.trim()).filter(Boolean)
  const automatic = [environment['OneDriveCommercial'], environment['OneDrive'], environment['USERPROFILE'] ? `${environment['USERPROFILE']}\\Downloads` : undefined]
  const repositories = (environment['TLC_DECK_GITHUB_REPOS'] ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  return {
    localDeckRoots: [...new Set([...configured, ...automatic.filter((value): value is string => !!value)])],
    githubRepositories: repositories.length ? repositories : [...defaultDeckRepositories]
  }
}

export function createWorkingSessionService(options: WorkingSessionFactoryOptions): WorkingSessionService {
  const sample = options.mode === 'sample'
  const fetcher = options.fetcher ?? fetch
  const deckSources: DeckSource[] = sample ? [] : [
    options.localDeckRoots ? new LocalDeckSource(options.localDeckRoots) : new UnavailableDeckSource('Local synced folders', 'not-available-here', 'Local deck folders can only be searched from the Desktop app or the VS Code extension.'),
    new GitHubDeckSource(options.githubRepositories ?? defaultDeckRepositories, fetcher, options.githubToken ? { token: options.githubToken } : {}),
    new SeismicDeckSource(options.knowledgeSearch),
    new Microsoft365DeckSource(options.getFileGraphToken, fetcher)
  ]
  return new WorkingSessionService({
    mode: options.mode, learn: sample ? sampleLearnSource : new LearnMcpClient(fetcher), deckSources,
    openOutput: options.openOutput,
    ...(options.model ? { model: options.model } : {}), ...(options.compiler ? { compiler: options.compiler } : {}),
    ...(options.renderDocx ? { renderDocx: options.renderDocx } : {}),
    ...(options.maximumDeckBytes ? { maximumDeckBytes: options.maximumDeckBytes } : {}),
    ...(options.now ? { now: options.now } : {})
  })
}
