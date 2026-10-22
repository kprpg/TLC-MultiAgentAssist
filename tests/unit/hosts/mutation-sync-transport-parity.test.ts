import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { createMutationSession } from '../../../packages/orchestrator/mutations/composition.js'
import { mutationSyncResponseSchema, type MutationSyncRequest, type MutationSyncResponse } from '../../../packages/common/contracts/cache-sync.js'
import { createTeamsHandler } from '../../../apps/teams/src/app.js'
import { buildWebApiHandler } from '../../../apps/web/src/app.js'
import { createMutationSyncIpcHandler } from '../../../apps/desktop/electron/main/portfolio-ipc.js'
import { buildLiveDataProvider } from '../../../apps/vscode-extension/src/live-provider-core.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { MsxRequestError } from '../../../packages/connectors/msx/live.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function listen(handler: ReturnType<typeof buildWebApiHandler>): Promise<string> {
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No mutation parity listener.')
  return `http://127.0.0.1:${address.port}`
}

describe('governed mutation transport parity', () => {
  it('preserves source denial and throttling status across HTTP without disclosing source error details', async () => {
    const services = await createSampleApplicationServices()
    cleanup.push(() => services.dispose())
    const store = new SqliteDocumentStore()
    cleanup.push(() => store.close())
    const denied = vi.spyOn(services.orchestrator, 'getPortfolioIndex').mockRejectedValue(new MsxRequestError('Private source details must not be returned', 403))
    const teams = await listen(createTeamsHandler({
      configuration: { mode: 'sample', origin: 'http://127.0.0.1', environmentId: 'sample' }, store, resolveServices: async () => services,
      authority: { verify: async () => ({ revision: 'sample', canConfigure: true, canPublish: true, audienceEligible: true }) }
    }))
    const web = await listen(buildWebApiHandler({
      authenticate: () => ({ accessToken: 'synthetic', clientPrincipal: 'sample', userEmail: 'synthetic@example.test' }),
      createRuntime: () => Object.assign(services.orchestrator, {
        listMeetingTranscripts: vi.fn(), getMeetingTranscript: vi.fn(), proposeMeetingChangeSet: vi.fn(), applyMeetingChangeSet: vi.fn()
      })
    }))
    for (const url of [`${teams}/api/teams/operations/getPortfolioIndex`, `${web}/api/portfolio/index`]) {
      const request = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contractVersion: '1.0' }) })
      denied.mockRejectedValue(new MsxRequestError('Private source details must not be returned', 403))
      const response = await request()
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain('Private source details')
      denied.mockRejectedValue(new MsxRequestError('Private source details must not be returned', 429, 12_000))
      const throttled = await request()
      expect(throttled.status).toBe(429)
      expect(throttled.headers.get('retry-after')).toBe('12')
    }
  })
  it('uses one strict review/admission/receipt contract on Desktop, Web, VS Code and Teams', async () => {
    for (const surface of ['desktop', 'web', 'vscode', 'teams'] as const) {
      const services = await createSampleApplicationServices()
      cleanup.push(() => services.dispose())
      const store = new SqliteDocumentStore()
      cleanup.push(() => store.close())
      const core = services.orchestrator
      const session = createMutationSession({ core, mode: 'sample', source: `parity:${surface}`, state: { store, durable: true, close() {} },
        enabled: true, readCacheOwner: surface === 'desktop' || surface === 'vscode' ? 'host' : 'client' })
      cleanup.push(() => session.drain())
      let invoke: (input: MutationSyncRequest) => Promise<MutationSyncResponse>
      if (surface === 'desktop') invoke = createMutationSyncIpcHandler(session)
      else if (surface === 'vscode') {
        const provider = buildLiveDataProvider({ orchestrator: core, host: services.workflows, account: 'synthetic', dispose: async () => {} }, 'sample')
        provider.mutationSync = (input) => session.invoke(input)
        invoke = async (params) => {
          const result = await routeBridgeMessage(provider, { kind: 'request', id: crypto.randomUUID(), method: 'mutationSync', params })
          if (!result.ok) throw new Error(result.error.message)
          return mutationSyncResponseSchema.parse(result.result)
        }
      } else {
        const handler = surface === 'teams' ? createTeamsHandler({
          configuration: { mode: 'sample', origin: 'http://127.0.0.1', environmentId: 'sample' }, store,
          backgroundSync: true, durableMutationState: true, resolveServices: async () => services,
          authority: { verify: async () => ({ revision: 'sample', canConfigure: true, canPublish: true, audienceEligible: true }) }
        }) : buildWebApiHandler({
          authenticate: () => ({ accessToken: 'synthetic', clientPrincipal: 'sample', userEmail: 'synthetic@example.test' }),
          createRuntime: () => Object.assign(core, { mutationSync: (input: MutationSyncRequest) => session.invoke(input),
            listMeetingTranscripts: vi.fn(), getMeetingTranscript: vi.fn(), proposeMeetingChangeSet: vi.fn(), applyMeetingChangeSet: vi.fn() })
        })
        const drain = 'drainMutations' in handler ? handler.drainMutations : undefined
        if (typeof drain === 'function') cleanup.push(async () => { await drain() })
        const baseUrl = await listen(handler)
        invoke = async (input) => {
          const response = await fetch(`${baseUrl}${surface === 'teams' ? '/api/teams' : '/api'}/mutation-sync`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input)
          })
          expect([200, 202], surface).toContain(response.status)
          return mutationSyncResponseSchema.parse(await response.json())
        }
      }
      expect(await invoke({ contractVersion: '1.0', operation: 'capabilities' })).toMatchObject({ kind: 'capabilities', capabilities: { available: true } })
      const input = { opportunityId: 'opp-grid-modernization', update: { comments: 'Synthetic parity update' } }
      const prepared = await invoke({ contractVersion: '1.0', operation: 'prepare', mutation: 'updateOpportunity', input })
      if (prepared.kind !== 'review') throw new Error('Expected exact source review')
      expect(prepared.review.input).toEqual(input)
      const submit: MutationSyncRequest = { contractVersion: '1.0', operation: 'submit', id: prepared.review.id,
        digest: prepared.review.digest, reason: 'Confirmed synthetic parity update', confirmed: true }
      expect(await invoke(submit)).toMatchObject({ kind: 'receipt', receipt: { state: 'accepted' } })
      await vi.waitFor(async () => {
        const status = await invoke({ contractVersion: '1.0', operation: 'status', id: prepared.review.id })
        expect(status).toMatchObject({ receipt: { state: 'confirmed', result: { comments: 'Synthetic parity update' } } })
      })
      expect(await invoke(submit)).toMatchObject({ receipt: { state: 'confirmed' } })
    }
  })
})
