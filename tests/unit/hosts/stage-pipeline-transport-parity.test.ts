import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler } from '../../../apps/web/src/app.js'
import { createStagePipelineIpcHandler } from '../../../apps/desktop/electron/main/stage-pipeline-ipc.js'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { createApplicationOperations } from '../../../packages/orchestrator/operations.js'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { createStagePipelineReviewHost } from '../../../packages/orchestrator/stage-pipeline-review.js'
import { stagePipelineResponseSchema } from '../../../packages/common/contracts/stage-pipeline-review.js'

vi.mock('../../../apps/vscode-extension/src/live-provider.js', () => ({
    buildFoundryMeetingExtractor: () => undefined
}))

const headers = {
    'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
    'x-ms-client-principal': 'synthetic-principal', 'x-ms-client-principal-name': 'sample@example.test',
    'x-ms-token-aad-access-token': 'synthetic-token'
}

describe('Stage and Pipeline Review IPC/HTTP/webview/Teams transport parity', () => {
    let server: Server | undefined
    afterEach(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
        server = undefined
    })
    async function listen() {
        const host = createStagePipelineReviewHost({ mode: 'sample' })
        const createRuntime = vi.fn(() => { throw new Error('Unrelated runtime must not be created for dashboard calls.') })
        const resolve = vi.fn(() => host)
        const handler = buildWebApiHandler({ createRuntime, resolveStagePipelineReviewHost: resolve })
        server = createServer((request, response) => void handler(request, response))
        await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Test HTTP host did not bind.')
        return { host, createRuntime, resolve, url: `http://127.0.0.1:${address.port}/api/stage-pipeline-review` }
    }

    it('returns the same strict snapshot for every scope and operation across all transports', async () => {
        const { host, createRuntime, url } = await listen()
        const ipc = createStagePipelineIpcHandler(host)
        const provider = { ...createSampleDataProvider(), stagePipelineReview: host }
        const services = await createSampleApplicationServices({ dataPath: ':memory:' })
        const operations = createApplicationOperations({ ...services, stagePipelineReview: host })
        try {
            for (const request of [
                { contractVersion: '1.1', operation: 'get' },
                { contractVersion: '1.1', operation: 'refresh', scope: 'reports' },
                { contractVersion: '1.1', operation: 'get', scope: 'both', reportIds: ['sample-report-a'] }
            ]) {
                const desktop = await ipc(request)
                stagePipelineResponseSchema.parse(desktop)
                const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(request) })
                expect(response.status).toBe(200)
                expect(response.headers.get('cache-control')).toBe('no-store')
                expect(await response.json()).toEqual(desktop)
                expect(await routeBridgeMessage(provider, { kind: 'request', id: 'stage-pipeline', method: 'stagePipelineReview', params: request }))
                    .toMatchObject({ kind: 'response', ok: true, result: desktop })
                expect(await operations.invoke('stagePipelineReview', request)).toEqual(desktop)
            }
            expect(createRuntime).not.toHaveBeenCalled()
        } finally {
            await services.dispose()
        }
    })

    it('preserves authentication, same-origin and strict-request gates on every transport', async () => {
        const { host, url, resolve } = await listen()
        const body = JSON.stringify({ contractVersion: '1.1', operation: 'get' })
        expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401)
        expect((await fetch(url, { method: 'POST', headers: { ...headers, 'sec-fetch-site': 'cross-site' }, body })).status).toBe(403)
        expect(resolve).not.toHaveBeenCalled()
        for (const request of [
            { contractVersion: '1.0', operation: 'get' },
            { contractVersion: '1.1', operation: 'delete' },
            { contractVersion: '1.1', operation: 'get', profile: 'another-seller' },
            { contractVersion: '1.1', operation: 'get', scope: 'mine', reportIds: ['x'] }
        ]) {
            expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify(request) })).status).toBe(400)
            await expect(createStagePipelineIpcHandler(host)(request)).rejects.toThrow()
            expect(await routeBridgeMessage({ ...createSampleDataProvider(), stagePipelineReview: host }, {
                kind: 'request', id: 'bad', method: 'stagePipelineReview', params: request
            })).toMatchObject({ ok: false })
        }
    })

    it('answers the webview bridge with an explicit error when the host is not provided', async () => {
        const provider = { ...createSampleDataProvider() }
        delete (provider as { stagePipelineReview?: unknown }).stagePipelineReview
        expect(await routeBridgeMessage(provider, { kind: 'request', id: 'missing', method: 'stagePipelineReview', params: { contractVersion: '1.1', operation: 'get' } }))
            .toMatchObject({ ok: false })
    })
})
