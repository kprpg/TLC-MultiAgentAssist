import { describe, expect, it, vi } from 'vitest'
import { CachedStagePipelineLoader } from '../../../packages/orchestrator/stage-pipeline-cache.js'
import { StagePipelineSourceError } from '../../../packages/connectors/msx/stage-pipeline.js'
import { stagePipelineRequestSchema, stagePipelineSnapshotSchema, type StagePipelineSnapshot } from '../../../packages/common/contracts/stage-pipeline-review.js'
import { createSampleStagePipelineReview } from '../../../packages/common/fixtures/stage-pipeline-review.js'

const request = (input: Record<string, unknown> = {}) => stagePipelineRequestSchema.parse({ contractVersion: '1.1', operation: 'get', ...input })
const live = (marker: string): StagePipelineSnapshot => ({ ...createSampleStagePipelineReview(), mode: 'live', message: marker, generatedAt: '2026-10-21T12:00:00.000Z' })
const fresh = { fresh: false }

function setup(options: { ttlMs?: number; maxEntries?: number } = {}) {
    let clock = 1_000_000
    const inner = { load: vi.fn(async (): Promise<StagePipelineSnapshot> => live(`load-${inner.load.mock.calls.length}`)) }
    const cache = new CachedStagePipelineLoader(inner, { now: () => clock, ...options })
    return { inner, cache, advance: (ms: number) => { clock += ms } }
}

describe('CachedStagePipelineLoader', () => {
    it('serves repeat reads within the TTL from memory', async () => {
        const { inner, cache, advance } = setup()
        const first = await cache.load(request(), fresh)
        advance(60_000)
        expect(await cache.load(request(), fresh)).toBe(first)
        expect(inner.load).toHaveBeenCalledTimes(1)
        advance(5 * 60_000)
        expect((await cache.load(request(), fresh)).message).toBe('load-2')
        expect(inner.load).toHaveBeenCalledTimes(2)
    })

    it('keys the cache by scope and the unordered report selection', async () => {
        const { inner, cache } = setup()
        await cache.load(request({ scope: 'reports', reportIds: ['b', 'a'] }), fresh)
        await cache.load(request({ scope: 'reports', reportIds: ['a', 'b'] }), fresh)
        expect(inner.load).toHaveBeenCalledTimes(1)
        await cache.load(request({ scope: 'reports' }), fresh)
        await cache.load(request({ scope: 'both', reportIds: ['a', 'b'] }), fresh)
        await cache.load(request(), fresh)
        expect(inner.load).toHaveBeenCalledTimes(4)
    })

    it('bypasses and replaces the cache for an explicit refresh', async () => {
        const { inner, cache } = setup()
        await cache.load(request(), fresh)
        const refreshed = await cache.load(request({ operation: 'refresh' }), { fresh: true })
        expect(refreshed.message).toBe('load-2')
        expect(await cache.load(request(), fresh)).toBe(refreshed)
        expect(inner.load).toHaveBeenCalledTimes(2)
    })

    it('shares one in-flight load between concurrent callers and honours refresh joining', async () => {
        const { inner, cache } = setup()
        let release!: () => void
        inner.load.mockImplementationOnce(() => new Promise<StagePipelineSnapshot>((resolve) => { release = () => resolve(live('slow')) }))
        const pending = [cache.load(request(), fresh), cache.load(request(), fresh), cache.load(request({ operation: 'refresh' }), { fresh: true })]
        release()
        const results = await Promise.all(pending)
        expect(new Set(results).size).toBe(1)
        expect(inner.load).toHaveBeenCalledTimes(1)
    })

    it('returns the last good snapshot marked stale when a reload fails, and recovers on the next success', async () => {
        const { inner, cache, advance } = setup()
        const good = await cache.load(request(), fresh)
        advance(10 * 60_000)
        inner.load.mockRejectedValueOnce(new StagePipelineSourceError('throttled', 'MSX is throttling requests.'))
        const stale = await cache.load(request(), fresh)
        expect(stale.state).toBe('stale')
        expect(stale.message).toContain('MSX is throttling requests.')
        expect(stale.message).toContain('2026-10-21')
        expect(stale.opportunities).toEqual(good.opportunities)
        expect(stagePipelineSnapshotSchema.safeParse(stale).success).toBe(true)
        const recovered = await cache.load(request(), fresh)
        expect(recovered.state).toBe('fresh')
        expect(inner.load).toHaveBeenCalledTimes(3)
    })

    it('does not mask a failed explicit refresh with silently fresh data', async () => {
        const { inner, cache } = setup()
        await cache.load(request(), fresh)
        inner.load.mockRejectedValueOnce(new StagePipelineSourceError('source-unavailable', 'MSX could not be reached.'))
        expect((await cache.load(request({ operation: 'refresh' }), { fresh: true })).state).toBe('stale')
    })

    it('rethrows when there is nothing to fall back to', async () => {
        const { inner, cache } = setup()
        inner.load.mockRejectedValueOnce(new StagePipelineSourceError('forbidden', 'Denied.'))
        await expect(cache.load(request(), fresh)).rejects.toMatchObject({ code: 'forbidden' })
        inner.load.mockResolvedValueOnce(live('ok'))
        expect((await cache.load(request(), fresh)).message).toBe('ok')
    })

    it('bounds the number of cached views and evicts the oldest', async () => {
        const { inner, cache } = setup({ maxEntries: 2 })
        await cache.load(request({ scope: 'mine' }), fresh)
        await cache.load(request({ scope: 'reports' }), fresh)
        await cache.load(request({ scope: 'both' }), fresh)
        await cache.load(request({ scope: 'mine' }), fresh)
        expect(inner.load).toHaveBeenCalledTimes(4)
    })

    it('can be invalidated after a source write', async () => {
        const { inner, cache } = setup()
        await cache.load(request(), fresh)
        cache.invalidate()
        await cache.load(request(), fresh)
        expect(inner.load).toHaveBeenCalledTimes(2)
    })
})
