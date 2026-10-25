import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workingSessionPrepareRequestSchema } from '../../packages/common/contracts/working-session.js'
import { createBicepCliCompiler, createWorkingSessionService, folderOutput } from '../../packages/orchestrator/working-session/index.js'

// Opt-in: needs the network (Microsoft Learn, GitHub) and, for ARM output, the Bicep CLI. TLC_RUN_LIVE_SMOKE=1
describe.skipIf(process.env['TLC_RUN_LIVE_SMOKE'] !== '1')('working session against live public sources', () => {
  let documents: string
  beforeAll(async () => { documents = await mkdtemp(join(tmpdir(), 'tlc-ws-live-')) })
  afterAll(async () => { await rm(documents, { recursive: true, force: true }) })

  it('builds a real folder: an Arc deck from GitHub, Learn pages, and Bicep that compiles to ARM', async () => {
    const service = createWorkingSessionService({
      mode: 'live', openOutput: async (name) => folderOutput(documents, name),
      compiler: createBicepCliCompiler(), githubRepositories: ['AzureDataCommunity/Resources'], maximumDeckBytes: 30_000_000
    })
    const { topic } = await service.deriveTopic({ contractVersion: '1.0', opportunityId: 'opp', opportunityName: 'ARC ENABLED SQL', milestoneName: 'POC' })
    expect(topic.topic).toBe('Azure Arc-enabled SQL')
    const result = await service.prepare(workingSessionPrepareRequestSchema.parse({
      contractVersion: '1.0', opportunityId: 'opp', opportunityName: 'ARC ENABLED SQL', milestoneName: 'POC', topic, deliverables: { decks: true, learn: true, iac: true }
    }))
    expect(result.delivery.kind).toBe('folder')
    const root = (result.delivery as { folderPath: string }).folderPath
    const files = (await readdir(root, { recursive: true })).map(String)
    console.info(JSON.stringify({ summary: result.summary, files: result.files.map((file) => `${file.path} [${file.sourceLabel}] ${file.bytes}`), gaps: result.gaps.map((gap) => `${gap.source}:${gap.code}`) }, null, 1))

    expect(files.filter((file) => file.startsWith('learn') && file.endsWith('.md')).length).toBeGreaterThanOrEqual(3)
    expect(files).toEqual(expect.arrayContaining([join('iac', 'main.bicep'), join('iac', 'main.json'), 'README.md', 'manifest.json']))
    const deck = result.files.find((file) => file.kind === 'deck' && file.path.endsWith('.pptx'))
    expect(deck, 'a real deck should be found on GitHub').toBeDefined()
    const bytes = await readFile(join(root, deck!.path))
    expect(bytes[0]).toBe(0x50)
    expect((await stat(join(root, deck!.path))).size).toBeGreaterThan(100_000)
    expect(await JSZip.loadAsync(bytes).then((zip) => zip.file('ppt/presentation.xml') !== null)).toBe(true)
    const arm = JSON.parse(await readFile(join(root, 'iac', 'main.json'), 'utf8')) as { resources: unknown[] }
    expect(arm.resources.length).toBeGreaterThan(0)
  }, 300_000)
})
