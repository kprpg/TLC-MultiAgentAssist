import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler } from '../../../apps/web/src/app.js'
import { createSellerDashboardIpcHandler } from '../../../apps/desktop/electron/main/seller-dashboard-ipc.js'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { createSellerDashboardHost } from '../../../packages/orchestrator/seller-dashboard.js'

vi.mock('../../../apps/vscode-extension/src/live-provider.js', () => ({
    buildFoundryMeetingExtractor: () => undefined
}))

const headers = {
    'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
    'x-ms-client-principal': 'synthetic-principal',
    'x-ms-client-principal-name': 'sample@example.test',
    'x-ms-token-aad-access-token': 'synthetic-token'
}

describe('Seller Dashboard IPC/HTTP/webview transport parity', () => {
    let server: Server | undefined
    afterEach(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
        server = undefined
    })
    async function listen() {
        const host = createSellerDashboardHost({ mode: 'sample', resolveUserEmail: async () => undefined })
        const createRuntime = vi.fn(() => { throw new Error('Unrelated runtime must not be created for dashboard calls.') })
        const handler = buildWebApiHandler({ createRuntime, resolveSellerDashboardHost: () => host })
        server = createServer((request, response) => void handler(request, response))
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Test HTTP host did not bind.')
        return { host, createRuntime, url: `http://127.0.0.1:${address.port}/api/seller-dashboard` }
    }

    it('returns the same strict sample snapshot on get and confirmed refresh across all transports', async () => {
        const { host, createRuntime, url } = await listen()
        const ipc = createSellerDashboardIpcHandler(host)
        const provider = { ...createSampleDataProvider(), sellerDashboard: host }
        for (const request of [
            { contractVersion: '1.0', operation: 'get' },
            { contractVersion: '1.0', operation: 'refresh', confirmed: true, asOf: '2026-10-10' }
        ]) {
            const desktop = await ipc(request)
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(request) })
            expect(response.status).toBe(200)
            expect(response.headers.get('cache-control')).toBe('no-store')
            expect(await response.json()).toEqual(desktop)
            const bridge = await routeBridgeMessage(provider, {
                kind: 'request', id: 'dashboard-test', method: 'sellerDashboard', params: request
            })
            expect(bridge).toMatchObject({ kind: 'response', ok: true, result: desktop })
        }
        expect(createRuntime).not.toHaveBeenCalled()
    })

    it('preserves authentication, same-origin, version and explicit-confirmation gates', async () => {
        const { host, url } = await listen()
        const body = JSON.stringify({ contractVersion: '1.0', operation: 'get' })
        expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401)
        expect((await fetch(url, { method: 'POST', headers: { ...headers, 'sec-fetch-site': 'cross-site' }, body })).status).toBe(403)
        for (const request of [
            { contractVersion: '2.0', operation: 'get' },
            { contractVersion: '1.0', operation: 'refresh' },
            { contractVersion: '1.0', operation: 'get', profile: 'another-seller' }
        ]) {
            expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify(request) })).status).toBe(400)
            await expect(createSellerDashboardIpcHandler(host)(request)).rejects.toThrow()
            expect(await routeBridgeMessage({ ...createSampleDataProvider(), sellerDashboard: host }, {
                kind: 'request', id: 'bad-dashboard', method: 'sellerDashboard', params: request
            })).toMatchObject({ ok: false })
        }
    })
})
