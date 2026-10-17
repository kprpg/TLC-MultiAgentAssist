import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { importCreationCsv } from '../../../apps/shared/record-creation/csv.js'
import { createRecordCreationIpcHandlers } from '../../../apps/desktop/electron/main/record-creation-ipc.js'
import { createLocalStoreDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { contractVersion, recordCreationDraftSchema, recordCreationPreviewSchema, recordCreationResultSchema } from '../../../packages/common/index.js'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { LocalStoreRecordCreation } from '../../../packages/connectors/local-store/record-creation.js'
import { SAMPLE_USER_ID } from '../../../packages/connectors/local-store/seed.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { RecordCreationService } from '../../../packages/orchestrator/record-creation/service.js'

const fixture = recordCreationDraftSchema.parse(JSON.parse(readFileSync(
  resolve('tests', 'fixtures', 'record-creation', 'single-opportunity-multiple-milestones', 'input.json'), 'utf8'
)))
const headers = {
  'content-type': 'application/json',
  'sec-fetch-site': 'same-origin',
  'x-ms-token-aad-access-token': 'test-token',
  'x-ms-client-principal': 'test-principal',
  'x-ms-client-principal-name': 'sample@example.test'
}

function createRuntime(): { runtime: WebRuntime; close(): void } {
  const store = new LocalStore()
  const msx = new LocalStoreMsxConnector(store)
  const writer = new LocalStoreRecordCreation(store, SAMPLE_USER_ID)
  const service = new RecordCreationService(msx, writer, { writer })
  const orchestrator = new ThinSliceOrchestrator(msx, { getStageGuidance: vi.fn() }, {}, undefined, service)
  return {
    runtime: Object.assign(orchestrator, {
      listMeetingTranscripts: vi.fn(), getMeetingTranscript: vi.fn(),
      proposeMeetingChangeSet: vi.fn(), applyMeetingChangeSet: vi.fn()
    }),
    close: () => store.close()
  }
}

describe('record creation transport parity', () => {
  let server: Server | undefined
  afterEach(async () => {
    if (server) await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()))
    server = undefined
  })

  async function listen(handler: ReturnType<typeof buildWebApiHandler>): Promise<string> {
    server = createServer((request, response) => void handler(request, response))
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test listener.')
    return `http://127.0.0.1:${address.port}`
  }

  async function post(base: string, operation: string, body: unknown) {
    const response = await fetch(`${base}/api/record-creation/${operation}`, {
      method: 'POST', headers, body: JSON.stringify(body)
    })
    expect(response.status).toBe(200)
    return response.json()
  }

  async function bridge(provider: ReturnType<typeof createLocalStoreDataProvider>, method: string, params: unknown) {
    const response = await routeBridgeMessage(provider, { kind: 'request', id: 'create-1', method, params })
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('Bridge rejected a valid record creation request.')
    return response.result
  }

  it('exposes catalog, reviewed commit, and no-write draft on all three hosts', async () => {
    const desktop = createRuntime()
    const web = createRuntime()
    const extension = createLocalStoreDataProvider()
    const ipc = createRecordCreationIpcHandlers(desktop.runtime)
    const base = await listen(buildWebApiHandler({ createRuntime: () => web.runtime }))
    try {
      const catalogRequest = { contractVersion, accountId: 'account-contoso' }
      const ipcCatalog = await ipc['tlc:get-record-creation-catalog']!(catalogRequest)
      const httpCatalogResponse = await fetch(`${base}/api/record-creation/catalog?accountId=account-contoso`, { headers })
      expect(httpCatalogResponse.status).toBe(200)
      const httpCatalog = await httpCatalogResponse.json()
      const bridgeCatalog = await bridge(extension, 'getRecordCreationCatalog', catalogRequest)
      for (const catalog of [ipcCatalog, httpCatalog, bridgeCatalog]) {
        expect(catalog).toMatchObject({
          target: 'sqlite',
          account: { id: 'account-contoso' },
          choices: { intent: expect.arrayContaining([{ value: 606820001, label: 'Consumption' }]) }
        })
      }

      const input = { contractVersion, target: 'sqlite', draft: fixture }
      const ipcPreview = await ipc['tlc:preview-record-creation']!(input) as { digest: string }
      const httpPreview = await post(base, 'preview', input) as { digest: string }
      const bridgePreview = await bridge(extension, 'previewRecordCreation', input) as { digest: string }
      for (const preview of [ipcPreview, httpPreview, bridgePreview]) {
        expect(preview).toMatchObject({ target: 'sqlite', mutationCount: 5, digest: expect.stringMatching(/^[a-f0-9]{64}$/) })
      }

      const confirm = (preview: { digest: string }) => ({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true })
      const ipcResult = await ipc['tlc:commit-record-creation']!(confirm(ipcPreview))
      const httpResult = await post(base, 'commit', confirm(httpPreview))
      const bridgeResult = await bridge(extension, 'commitRecordCreation', confirm(bridgePreview))
      for (const result of [ipcResult, httpResult, bridgeResult]) {
        expect(result).toMatchObject({
          state: 'committed', target: 'sqlite', created: expect.arrayContaining([expect.objectContaining({ kind: 'milestone' })]),
          audit: { opportunityCount: 1, milestoneCount: 3 }
        })
      }

      const draftRequest = { contractVersion, target: 'draft', draft: fixture }
      const ipcDraftPreview = await ipc['tlc:preview-record-creation']!(draftRequest) as { digest: string }
      const httpDraftPreview = await post(base, 'preview', draftRequest) as { digest: string }
      const bridgeDraftPreview = await bridge(extension, 'previewRecordCreation', draftRequest) as { digest: string }
      const exports = await Promise.all([
        ipc['tlc:export-record-creation-draft']!(confirm(ipcDraftPreview)),
        post(base, 'draft', confirm(httpDraftPreview)),
        bridge(extension, 'exportRecordCreationDraft', confirm(bridgeDraftPreview))
      ])
      for (const result of exports) {
        expect(result).toMatchObject({ result: { state: 'drafted', created: [] } })
      }
    } finally {
      desktop.close()
      web.close()
      await extension.dispose()
    }
  })

  it('rejects unauthenticated, forged and live-write requests on HTTP and bridge', async () => {
    const web = createRuntime()
    const extension = createLocalStoreDataProvider()
    const base = await listen(buildWebApiHandler({ createRuntime: () => web.runtime }))
    try {
      const request = { contractVersion, target: 'live-msx', draft: fixture }
      expect((await fetch(`${base}/api/record-creation/preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
      })).status).toBe(401)
      const disabled = await fetch(`${base}/api/record-creation/preview`, {
        method: 'POST', headers, body: JSON.stringify(request)
      })
      expect(disabled.status).toBe(403)
      const response = await routeBridgeMessage(extension, { kind: 'request', id: 'create-2', method: 'previewRecordCreation', params: request })
      expect(response).toMatchObject({ ok: false })
      const invalid = await fetch(`${base}/api/record-creation/preview`, {
        method: 'POST', headers, body: JSON.stringify({ ...request, target: 'sqlite', arbitrary: true })
      })
      expect(invalid.status).toBe(400)
    } finally {
      web.close()
      await extension.dispose()
    }
  })

  it.each([
    'single-opportunity-multiple-milestones',
    'multiple-opportunities-multiple-milestones'
  ])('imports and reopens %s through the VS Code SQLite bridge', async (scenario) => {
    const folder = resolve('tests', 'fixtures', 'record-creation', scenario)
    const expected = recordCreationDraftSchema.parse(JSON.parse(readFileSync(join(folder, 'input.json'), 'utf8')))
    if (expected.kind !== 'opportunity-batch') throw new Error('Expected an Opportunity-batch fixture.')
    const milestoneCount = expected.opportunities.reduce((total, bundle) => total + bundle.milestones.length, 0)
    const directory = await mkdtemp(join(tmpdir(), 'tlc-vscode-creation-'))
    const storePath = join(directory, 'extension-storage', 'sample.sqlite')
    try {
      const first = createLocalStoreDataProvider({ storePath })
      try {
        const catalog = await first.getRecordCreationCatalog({ contractVersion, accountId: expected.account.id })
        expect(catalog.target).toBe('sqlite')
        const draft = importCreationCsv(
          catalog,
          readFileSync(join(folder, 'opportunities.csv'), 'utf8'),
          readFileSync(join(folder, 'milestones.csv'), 'utf8')
        )
        expect(draft).toEqual(expected)
        const beforeSubmit = await first.listOpportunities(expected.account.id)
        expect(beforeSubmit.some((item) => expected.opportunities.some((bundle) => bundle.opportunity.name === item.name))).toBe(false)
        const input = { contractVersion, target: 'sqlite', draft }
        const preview = recordCreationPreviewSchema.parse(await bridge(first, 'previewRecordCreation', input))
        const result = recordCreationResultSchema.parse(await bridge(first, 'commitRecordCreation', {
          contractVersion, preview, expectedDigest: preview.digest, confirmed: true
        }))
        expect(result.state).toBe('committed')
        expect(result.created.filter((item) => item.kind === 'opportunity')).toHaveLength(expected.opportunities.length)
        expect(result.created.filter((item) => item.kind === 'milestone')).toHaveLength(milestoneCount)
      } finally {
        await first.dispose()
      }
      const second = createLocalStoreDataProvider({ storePath })
      try {
        const opportunities = await second.listOpportunities(expected.account.id)
        for (const bundle of expected.opportunities) {
          const created = opportunities.find((item) => item.name === bundle.opportunity.name)
          expect(created).toBeDefined()
          const milestones = await second.listMilestones(created!.id)
          expect(milestones.map((item) => item.name).sort()).toEqual(bundle.milestones.map((item) => item.name).sort())
        }
      } finally {
        await second.dispose()
      }
      const persisted = new LocalStore({ path: storePath })
      try {
        expect(Number(persisted.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total'])).toBe(1)
      } finally {
        persisted.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
