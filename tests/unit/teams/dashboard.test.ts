import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { createApplicationOperations } from '../../../packages/orchestrator/operations.js'
import { createSellerDashboardHost } from '../../../packages/orchestrator/seller-dashboard.js'
import { createSampleSellerDashboard } from '../../../packages/common/fixtures/seller-dashboard.js'
import { WindowsSellerDashboardConnector } from '../../../packages/connectors/common/seller-dashboard.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { createTeamsHandler } from '../../../apps/teams/src/app.js'
import { createSellerDashboardIpcHandler } from '../../../apps/desktop/electron/main/seller-dashboard-ipc.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'

vi.mock('../../../apps/vscode-extension/src/live-provider.js', () => ({ buildFoundryMeetingExtractor: () => undefined }))
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); vi.restoreAllMocks() })

async function fixture() {
  const services = await createSampleApplicationServices({ dataPath: ':memory:' })
  cleanup.push(() => services.dispose())
  const store = new SqliteDocumentStore()
  cleanup.push(() => store.close())
  const handler = createTeamsHandler({
    configuration: { mode: 'sample', origin: 'http://127.0.0.1', environmentId: 'sample' }, store,
    resolveServices: async () => services,
    authority: { verify: async () => ({ revision: 'sample', canConfigure: true, canPublish: true, audienceEligible: true }) }
  })
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Dashboard test listener did not start.')
  const post = (input: unknown, origin?: string) => fetch(`http://127.0.0.1:${address.port}/api/teams/operations/sellerDashboard`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(input)
  })
  return { services, post }
}

describe('Teams Seller Dashboard adapter', () => {
  it('returns the same strict canonical sample snapshot as IPC and the extension bridge', async () => {
    const { services, post } = await fixture()
    for (const input of [
      { contractVersion: '1.0', operation: 'get' },
      { contractVersion: '1.0', operation: 'refresh', confirmed: true, asOf: '2026-10-18' }
    ]) {
      const response = await post(input)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const expected = createSampleSellerDashboard()
      expect(await response.json()).toEqual(expected)
      expect(await createSellerDashboardIpcHandler(services.sellerDashboard)(input)).toEqual(expected)
      expect(await routeBridgeMessage({ ...createSampleDataProvider(), sellerDashboard: services.sellerDashboard }, {
        kind: 'request', id: 'teams-dashboard-parity', method: 'sellerDashboard', params: input
      })).toMatchObject({ ok: true, result: expected })
    }
  })
  it('rejects malformed, cross-origin, profile-override and unconfirmed-refresh requests', async () => {
    const { post } = await fixture()
    for (const input of [
      { contractVersion: '2.0', operation: 'get' },
      { contractVersion: '1.0', operation: 'refresh' },
      { contractVersion: '1.0', operation: 'get', profile: 'operator' }
    ]) expect((await post(input)).status).toBe(400)
    expect((await post({ contractVersion: '1.0', operation: 'get' }, 'https://elsewhere.invalid')).status).toBe(403)
  })
  it('never reads the runtime operator profile or substitutes sample data in live mode', async () => {
    const { services, post } = await fixture()
    const read = vi.spyOn(WindowsSellerDashboardConnector.prototype, 'read')
    const refresh = vi.spyOn(WindowsSellerDashboardConnector.prototype, 'refresh')
    const resolveUserEmail = vi.fn()
    services.sellerDashboard = createSellerDashboardHost({ mode: 'live', allowLocalProfile: false, resolveUserEmail })
    for (const input of [
      { contractVersion: '1.0', operation: 'get' },
      { contractVersion: '1.0', operation: 'refresh', confirmed: true }
    ]) {
      const response = await post(input)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ mode: 'live', kind: 'unavailable', code: 'hosted-profile-denied' })
    }
    expect(read).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(resolveUserEmail).not.toHaveBeenCalled()
    expect(createApplicationOperations(services).describe('sellerDashboard').effect).toBe('read')
  })
})
