import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler } from '../../../apps/web/src/app.js'
import { createSeReportingIpcHandler } from '../../../apps/desktop/electron/main/se-reporting-ipc.js'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { createSampleSeReportingHost } from '../../../packages/orchestrator/se-reporting/sample.js'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { createApplicationOperations } from '../../../packages/orchestrator/operations.js'

vi.mock('../../../apps/vscode-extension/src/live-provider.js', () => ({ buildFoundryMeetingExtractor: () => undefined }))

describe('SE Reporting IPC, HTTP, webview and operation parity', () => {
    let server: Server | undefined
    afterEach(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
        server = undefined
    })
    async function listen() {
        const host = createSampleSeReportingHost()
        const handler = buildWebApiHandler({ createRuntime: () => { throw new Error('Unrelated source runtime must not be created.') }, resolveSeReportingHost: () => host })
        server = createServer((request, response) => void handler(request, response))
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('The test host did not bind.')
        return { host, url: `http://127.0.0.1:${address.port}/api/se-reporting` }
    }
    const headers = {
        'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
        'x-ms-client-principal': 'synthetic-principal', 'x-ms-client-principal-name': 'sample@example.test',
        'x-ms-token-aad-access-token': 'synthetic-token'
    }
    it('returns the same canonical synthetic package across all four transports', async () => {
        const { host, url } = await listen()
        const request = { contractVersion: '1.0', operation: 'get' }
        const ipc = await createSeReportingIpcHandler(host)(request)
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(request) })
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual(ipc)
        expect(await routeBridgeMessage({ ...createSampleDataProvider(), seReporting: host }, {
            kind: 'request', id: 'se-reporting-test', method: 'seReporting', params: request
        })).toMatchObject({ ok: true, result: ipc })
        const services = await createSampleApplicationServices()
        try { expect(await createApplicationOperations(services).invoke('seReporting', request)).toEqual(ipc) } finally { await services.dispose() }
    })
    it('preserves same-origin/authentication, strict versions and explicit write confirmation', async () => {
        const { host, url } = await listen()
        const body = JSON.stringify({ contractVersion: '1.0', operation: 'get' })
        expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401)
        expect((await fetch(url, { method: 'POST', headers: { ...headers, 'sec-fetch-site': 'cross-site' }, body })).status).toBe(403)
        for (const input of [{ contractVersion: '2.0', operation: 'get' }, { contractVersion: '1.0', operation: 'publish' }, { contractVersion: '1.0', operation: 'get', token: 'injected' }]) {
            expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) })).status).toBe(400)
            await expect(createSeReportingIpcHandler(host)(input)).rejects.toThrow()
        }
    })
    it('does not disguise generation or publication as an unbudgeted read operation in Teams', async () => {
        const services = await createSampleApplicationServices()
        try {
            const operations = createApplicationOperations(services)
            expect(operations.describe('seReportingRun').startsWork).toBe(true)
            expect(operations.describe('publishSeReporting').effect).toBe('source')
            await expect(operations.invoke('seReporting', {
                contractVersion: '1.0', operation: 'run', profileId: 'sample-manager', period: '2026-10',
                pillar: 'infra', allowUnavailable: [], confirmed: true
            })).rejects.toThrow()
        } finally { await services.dispose() }
    })
})
