import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { createTeamsHandler } from '../../../apps/teams/src/app.js'
import { buildWebApiHandler } from '../../../apps/web/src/app.js'
import { createPortfolioIpcHandlers } from '../../../apps/desktop/electron/main/portfolio-ipc.js'
import { buildLiveDataProvider } from '../../../apps/vscode-extension/src/live-provider-core.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { portfolioIndexSchema, portfolioWorkspaceSchema } from '../../../packages/common/contracts/index.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function listen(handler: (request: Parameters<ReturnType<typeof createTeamsHandler>>[0], response: Parameters<ReturnType<typeof createTeamsHandler>>[1]) => Promise<boolean>) {
  const server: Server = createServer((request, response) => { void handler(request, response) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No aggregate parity listener.')
  return `http://127.0.0.1:${address.port}`
}

describe('aggregate portfolio operation parity', () => {
  it('validates identical versioned workspace/index outputs over Teams HTTP, Web HTTP, IPC and the extension bridge', async () => {
    const services = await createSampleApplicationServices()
    cleanup.push(() => services.dispose())
    const store = new SqliteDocumentStore()
    cleanup.push(() => store.close())
    const core = services.orchestrator
    const ipc = createPortfolioIpcHandlers(core)
    const provider = buildLiveDataProvider({ orchestrator: core, host: services.workflows, account: 'synthetic', dispose: async () => undefined }, 'sample')
    const teams = await listen(createTeamsHandler({
      configuration: { mode: 'sample', origin: 'http://127.0.0.1', environmentId: 'sample' },
      store, resolveServices: async () => services,
      authority: { verify: async () => ({ revision: 'sample', canConfigure: true, canPublish: true, audienceEligible: true }) }
    }))
    const web = await listen(buildWebApiHandler({
      authenticate: () => ({ accessToken: 'synthetic', clientPrincipal: 'sample', userEmail: 'synthetic@example.test' }),
      createRuntime: () => Object.assign(core, {
        listMeetingTranscripts: vi.fn(), getMeetingTranscript: vi.fn(), proposeMeetingChangeSet: vi.fn(), applyMeetingChangeSet: vi.fn()
      })
    }))
    for (const kind of ['index', 'workspace'] as const) {
      const method = kind === 'index' ? 'getPortfolioIndex' : 'getPortfolioWorkspace'
      const request = { contractVersion: '1.0' as const }
      const expected = kind === 'index' ? await core.getPortfolioIndex(request) : await core.getPortfolioWorkspace(request)
      const post = async (url: string) => {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
        expect(response.status).toBe(200)
        return response.json()
      }
      expect(await post(`${teams}/api/teams/operations/${method}`)).toEqual(expected)
      expect(await post(`${web}/api/portfolio/${kind}`)).toEqual(expected)
      expect(await ipc[`tlc:portfolio-${kind}`]!(request)).toEqual(expected)
      const bridged = await routeBridgeMessage(provider, { kind: 'request', id: kind, method, params: request })
      expect(bridged.ok).toBe(true)
      if (!bridged.ok) throw new Error('Aggregate bridge read rejected.')
      expect((kind === 'index' ? portfolioIndexSchema : portfolioWorkspaceSchema).parse(bridged.result)).toEqual(expected)
      await expect(ipc[`tlc:portfolio-${kind}`]!({ contractVersion: 'wrong' })).rejects.toThrow()
    }
  })
})
