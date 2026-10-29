import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler } from '../../../apps/web/src/app.js'
import { createMomentumFocusIpcHandler } from '../../../apps/desktop/electron/main/momentum-focus-ipc.js'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { createApplicationOperations } from '../../../packages/orchestrator/operations.js'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { createMomentumFocusHost } from '../../../packages/orchestrator/momentum-focus/host.js'
import { momentumFocusContractVersion, momentumFocusResponseSchema } from '../../../packages/common/contracts/momentum-focus.js'

vi.mock('../../../apps/vscode-extension/src/live-provider.js', () => ({ buildFoundryMeetingExtractor: () => undefined }))
const headers = {
    'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
    'x-ms-client-principal': 'synthetic-principal', 'x-ms-client-principal-name': 'sample@example.test',
    'x-ms-token-aad-access-token': 'synthetic-token'
}
describe('Momentum Desktop/HTTP/VS Code/Teams parity (MF-009, MF-010)', () => {
    let server: Server | undefined
    afterEach(async () => {
        if (server) await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()))
        server = undefined
    })
    async function listen() {
        const host = createMomentumFocusHost({ mode: 'sample' })
        const createRuntime = vi.fn(() => { throw new Error('Unrelated runtime must not be constructed.') })
        const resolve = vi.fn(() => host)
        const handler = buildWebApiHandler({ createRuntime, resolveMomentumFocusHost: resolve })
        server = createServer((request, response) => void handler(request, response))
        await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Expected HTTP test binding')
        return { host, createRuntime, resolve, url: `http://127.0.0.1:${address.port}/api/momentum-focus` }
    }
    it('returns identical scoped/filter/window/page bundles and details through all four adapters', async () => {
        const { host, createRuntime, url } = await listen()
        const ipc = createMomentumFocusIpcHandler(host)
        const provider = { ...createSampleDataProvider(), momentumFocus: host }
        const services = await createSampleApplicationServices({ dataPath: ':memory:' })
        const operations = createApplicationOperations({ ...services, momentumFocus: host })
        try {
            const requests: unknown[] = [
                { contractVersion: momentumFocusContractVersion, operation: 'load' },
                { contractVersion: momentumFocusContractVersion, operation: 'load', refresh: true, query: { scope: 'mine', role: 'SE', pageSize: 2 } },
                { contractVersion: momentumFocusContractVersion, operation: 'get' },
                { contractVersion: momentumFocusContractVersion, operation: 'refresh', query: { role: 'SE', scope: 'mine', focus: 'month', pageSize: 2 } },
                { contractVersion: momentumFocusContractVersion, operation: 'get', query: { accountIds: ['harbor'], lookbackDays: 14, timezone: 'America/Los_Angeles' } },
                { contractVersion: momentumFocusContractVersion, operation: 'get', query: { scope: 'team', currency: 'EUR', basis: 'monthly-usage' } },
                { contractVersion: momentumFocusContractVersion, operation: 'get', query: { customerIndustry: 'all' } }
            ]
            const initial = await host.invoke({ contractVersion: momentumFocusContractVersion, operation: 'get' })
            if (initial.kind !== 'snapshot') throw new Error('Expected synthetic snapshot')
            requests.push({ contractVersion: momentumFocusContractVersion, operation: 'detail', recordKey: initial.rows[0]!.key, snapshotId: initial.snapshotId })
            for (const request of requests) {
                const desktop = momentumFocusResponseSchema.parse(await ipc(request))
                const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(request) })
                expect(response.status).toBe(200)
                expect(response.headers.get('cache-control')).toBe('no-store')
                expect(await response.json()).toEqual(desktop)
                expect(await routeBridgeMessage(provider, { kind: 'request', id: 'momentum', method: 'momentumFocus', params: request }))
                    .toMatchObject({ kind: 'response', ok: true, result: desktop })
                expect(await operations.invoke('momentumFocus', request)).toEqual(desktop)
            }
            expect(operations.describe('momentumFocus')).toMatchObject({ effect: 'read', startsWork: false })
            expect(createRuntime).not.toHaveBeenCalled()
        } finally { await services.dispose() }
    })
    it('preserves same-origin, authentication and strict identity/operation gates', async () => {
        const { host, resolve, url } = await listen()
        const body = JSON.stringify({ contractVersion: momentumFocusContractVersion, operation: 'get' })
        expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401)
        expect((await fetch(url, { method: 'POST', headers: { ...headers, 'sec-fetch-site': 'cross-site' }, body })).status).toBe(403)
        expect(resolve).not.toHaveBeenCalled()
        for (const input of [
            { contractVersion: '2.0', operation: 'get' },
            { contractVersion: '1.0', operation: 'get' },
            { contractVersion: momentumFocusContractVersion, operation: 'publish' },
            { contractVersion: momentumFocusContractVersion, operation: 'get', principalId: 'other' },
            { contractVersion: momentumFocusContractVersion, operation: 'get', query: { tenantId: 'other' } }
        ]) {
            expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) })).status).toBe(400)
            await expect(createMomentumFocusIpcHandler(host)(input)).rejects.toThrow()
            expect(await routeBridgeMessage({ ...createSampleDataProvider(), momentumFocus: host }, {
                kind: 'request', id: 'invalid-momentum', method: 'momentumFocus', params: input
            })).toMatchObject({ ok: false })
        }
    })
    it('does not silently substitute sample data when a live bridge capability is absent', async () => {
        const provider = { ...createSampleDataProvider() }
        delete provider.momentumFocus
        expect(await routeBridgeMessage(provider, {
            kind: 'request', id: 'missing', method: 'momentumFocus', params: { contractVersion: momentumFocusContractVersion, operation: 'get' }
        })).toMatchObject({ ok: false })
    })
})
