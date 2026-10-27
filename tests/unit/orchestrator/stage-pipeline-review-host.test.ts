import { describe, expect, it, vi } from 'vitest'
import { createStagePipelineReviewHost, SharedStagePipelineReviewHost } from '../../../packages/orchestrator/stage-pipeline-review.js'
import { StagePipelineSourceError } from '../../../packages/connectors/msx/stage-pipeline.js'
import { stagePipelineResponseSchema } from '../../../packages/common/contracts/stage-pipeline-review.js'
import { createSampleStagePipelineReview } from '../../../packages/common/fixtures/stage-pipeline-review.js'

const get = (extra: Record<string, unknown> = {}) => ({ contractVersion: '1.1', operation: 'get', ...extra })

describe('Stage and Pipeline Review host', () => {
    it('serves the canonical synthetic sample for get and refresh without a source', async () => {
        const host = createStagePipelineReviewHost({ mode: 'sample' })
        const response = stagePipelineResponseSchema.parse(await host.invoke(get()))
        expect(response).toMatchObject({ kind: 'snapshot', mode: 'sample', scope: 'mine' })
        expect(await host.invoke({ ...get(), operation: 'refresh' })).toEqual(response)
    })

    it('models the manager view in sample mode: direct reports, read-only report rows and a scoped subset', async () => {
        const host = createStagePipelineReviewHost({ mode: 'sample' })
        const mine = createSampleStagePipelineReview()
        const reports = await host.invoke(get({ scope: 'reports' }))
        const both = await host.invoke(get({ scope: 'both' }))
        if (reports.kind !== 'snapshot' || both.kind !== 'snapshot') throw new Error('expected snapshots')
        expect(reports.reports.length).toBeGreaterThanOrEqual(2)
        expect(reports.opportunities.length).toBeGreaterThan(0)
        expect(reports.opportunities.length).toBeLessThan(mine.opportunities.length)
        expect(reports.opportunities.every((row) => !row.editable && row.owner !== 'Sample Seller')).toBe(true)
        expect(both.opportunities.length).toBe(mine.opportunities.length + reports.opportunities.length)
        expect(both.opportunities.some((row) => row.editable)).toBe(true)
        expect(both.opportunities.some((row) => !row.editable)).toBe(true)
        const ids = new Set(reports.opportunities.map((row) => row.id))
        expect(reports.milestones.every((row) => ids.has(row.opportunityId))).toBe(true)
        expect(reports.sources.find((row) => row.source === 'hierarchy')).toMatchObject({ state: 'complete', count: reports.reports.length })

        const first = reports.reports[0]!
        const subset = await host.invoke(get({ scope: 'reports', reportIds: [first.id] }))
        if (subset.kind !== 'snapshot') throw new Error('expected snapshot')
        expect(subset.opportunities.length).toBeGreaterThan(0)
        expect(subset.opportunities.length).toBeLessThan(reports.opportunities.length)
        expect(subset.opportunities.every((row) => row.owner === first.displayName)).toBe(true)
    })

    it('validates every request before it reaches a source', async () => {
        const load = vi.fn()
        const host = new SharedStagePipelineReviewHost({ load })
        for (const request of [{ contractVersion: '1.0', operation: 'get' }, get({ extra: true }), get({ scope: 'everyone' }), get({ scope: 'mine', reportIds: ['x'] }), 'get', null]) {
            await expect(host.invoke(request)).rejects.toThrow()
        }
        expect(load).not.toHaveBeenCalled()
    })

    it('passes the parsed request to a live loader and validates its snapshot', async () => {
        const snapshot = { ...createSampleStagePipelineReview(), mode: 'live' as const }
        const load = vi.fn(async () => snapshot)
        const host = new SharedStagePipelineReviewHost({ load })
        expect(await host.invoke(get({ scope: 'both' }))).toEqual(snapshot)
        expect(load).toHaveBeenCalledWith(expect.objectContaining({ operation: 'get', scope: 'both' }), expect.anything())
        load.mockResolvedValueOnce({ ...snapshot, extra: true } as never)
        await expect(host.invoke(get())).rejects.toThrow()
    })

    it.each(['unauthorized', 'forbidden', 'throttled', 'source-unavailable'] as const)('maps %s source failures to an explicit unavailable response', async (code) => {
        const host = new SharedStagePipelineReviewHost({ load: async () => { throw new StagePipelineSourceError(code, 'Public failure message.') } })
        expect(await host.invoke(get())).toEqual({ contractVersion: '1.1', kind: 'unavailable', code, message: 'Public failure message.' })
    })

    it('does not leak unexpected loader errors as responses', async () => {
        const host = new SharedStagePipelineReviewHost({ load: async () => { throw new Error('customer Contoso secret') } })
        await expect(host.invoke(get())).rejects.toThrow('customer Contoso secret')
    })

    it('caches live reads per view, refreshes on demand and serves a stale snapshot when MSX fails', async () => {
        let calls = 0
        let fail = false
        const source = {
            getCurrentUserId: async () => { calls += 1; if (fail) throw Object.assign(new Error('boom'), { status: 429 }); return 'me' },
            readRows: async () => [],
            listDealTeamOpportunityIds: async () => [],
            listMilestoneTeamOpportunityIds: async () => []
        }
        const host = createStagePipelineReviewHost({ mode: 'live', source })
        await host.invoke(get())
        await host.invoke(get())
        expect(calls).toBe(1)
        await host.invoke({ ...get(), operation: 'refresh' })
        expect(calls).toBe(2)
        fail = true
        const stale = await host.invoke({ ...get(), operation: 'refresh' })
        expect(stale).toMatchObject({ kind: 'snapshot', state: 'stale', mode: 'live' })
        const noFallback = createStagePipelineReviewHost({ mode: 'live', source })
        expect(await noFallback.invoke(get())).toMatchObject({ kind: 'unavailable', code: 'throttled' })
    })
})
