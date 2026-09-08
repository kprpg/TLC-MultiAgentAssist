import { describe, expect, it, vi } from 'vitest'
import { fetchWithRetry } from '../../../scripts/smoke-web-release.mjs'

describe('web release smoke test', () => {
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
})