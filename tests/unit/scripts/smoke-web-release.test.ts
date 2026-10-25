import { describe, expect, it, vi } from 'vitest'
import { fetchWithRetry, verifyAnonymousSample, verifyWebAccess } from '../../../scripts/smoke-web-release.mjs'

describe('web release smoke test', () => {
    it('distinguishes a restored protected origin from a public origin without following redirects', async () => {
        const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302 }))
        await expect(verifyWebAccess('https://sample.example.test', { fetchFn, protectedAccess: true })).resolves.toBeUndefined()
        await expect(verifyWebAccess('https://sample.example.test', { fetchFn })).rejects.toThrow('HTTP 302')
    })

    it('verifies anonymous sample identity, data and SQLite transcripts without following login redirects', async () => {
        const fetchFn = sampleFetch()
        await verifyAnonymousSample('https://sample.example.test', { fetchFn })
        expect(fetchFn).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
            redirect: 'manual', credentials: 'omit'
        }))
        expect(fetchFn.mock.calls.map(([url]) => new URL(String(url)).pathname)).toContain('/api/meeting-transcripts/transcript-sample')
    })

    it('rejects a healthy host that redirects visitors to login', async () => {
        const fetchFn = sampleFetch('/', new Response(null, { status: 302, headers: { location: '/.auth/login/aad' } }))
        await expect(verifyAnonymousSample('https://sample.example.test', { fetchFn })).rejects.toThrow('HTTP 302')
    })

    it('rejects a live API even when health and the sample HTML shell succeed', async () => {
        const fetchFn = sampleFetch('/api/me', Response.json({ email: 'not-the-sample-user@example.test' }))
        await expect(verifyAnonymousSample('https://sample.example.test', { fetchFn })).rejects.toThrow('sample identity')
    })

    it('requires SQLite meeting capabilities for the deployed sample demo', async () => {
        const fetchFn = sampleFetch('/api/meeting-transcripts', Response.json([]))
        await expect(verifyAnonymousSample('https://sample.example.test', { fetchFn })).rejects.toThrow('SQLite')
    })

    it('allows more than 30 startup probes before failing', async () => {
        const response = new Response('{}', { status: 200 })
        const fetchFn = vi.fn()
            .mockRejectedValueOnce(new Error('not ready'))
            .mockRejectedValueOnce(new Error('not ready'))

        for (let attempt = 2; attempt < 30; attempt += 1) {
            fetchFn.mockRejectedValueOnce(new Error('not ready'))
        }
        fetchFn.mockResolvedValueOnce(response)

        await expect(fetchWithRetry('http://127.0.0.1/health', { delayMs: 0, fetchFn })).resolves.toBe(response)
        expect(fetchFn).toHaveBeenCalledTimes(31)
    })

    function sampleFetch(overridePath?: string, overrideResponse?: Response) {
        return vi.fn<typeof fetch>().mockImplementation(async (url) => {
            const path = new URL(String(url)).pathname
            if (path === overridePath && overrideResponse) return overrideResponse.clone()
            if (path === '/') return new Response('<head><meta name="tlc-data-mode" content="sample" /><meta name="tlc-local-exit" content="0" /></head><div id="root"></div>')
            const bodies: Record<string, unknown> = {
                '/api/health': { status: 'ready' },
                '/api/me': { email: 'sample.user@example.com' },
                '/api/accounts': [{ id: 'account-contoso' }],
                '/api/accounts/account-contoso/opportunities': [{ id: 'opp-grid-modernization' }],
                '/api/meeting-transcripts': [{ id: 'transcript-sample' }],
                '/api/meeting-transcripts/transcript-sample': { id: 'transcript-sample' }
            }
            return Response.json(bodies[path] ?? {}, { status: path in bodies ? 200 : 404 })
        })
    }
})