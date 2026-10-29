import { describe, expect, it, vi } from 'vitest'
import { createMomentumFocusHost, SharedMomentumFocusHost } from '../../../packages/orchestrator/momentum-focus/host.js'
import { createMomentumFixture, momentumSampleNow } from '../../../packages/common/fixtures/momentum-focus.js'
import { momentumFocusContractVersion } from '../../../packages/common/contracts/momentum-focus.js'

describe('Momentum read-only operation family (MF-008 through MF-010)', () => {
    const request = { contractVersion: momentumFocusContractVersion, operation: 'get' }
    it('requests HLS by default and only requests All customers after an explicit scope change', async () => {
        const collect = vi.fn(async (scope: 'portfolio' | 'mine' | 'team', industry: 'hls' | 'all') => ({ ...createMomentumFixture(industry), scope }))
        const host = new SharedMomentumFocusHost({ collect, now: () => new Date(momentumSampleNow) })
        expect(await host.invoke(request)).toMatchObject({ kind: 'snapshot', customerIndustry: 'hls', query: { customerIndustry: 'hls' } })
        expect(collect).toHaveBeenLastCalledWith('portfolio', 'hls')
        expect(await host.invoke({ ...request, query: { customerIndustry: 'all' } })).toMatchObject({ kind: 'snapshot', customerIndustry: 'all' })
        expect(collect).toHaveBeenLastCalledWith('portfolio', 'all')
    })
    it('rejects a provider that returns an unfiltered collection for an HLS request', async () => {
        const host = new SharedMomentumFocusHost({ collect: async () => createMomentumFixture('all') })
        expect(await host.invoke(request)).toMatchObject({ kind: 'unavailable', code: 'industry-unavailable' })
    })
    it('uses one deterministic fixture and the same model for get/refresh/detail', async () => {
        const host = createMomentumFocusHost({ mode: 'sample' })
        const snapshot = await host.invoke(request)
        expect(snapshot.kind).toBe('snapshot')
        expect(await host.invoke({ ...request, operation: 'refresh' })).toEqual(snapshot)
        if (snapshot.kind !== 'snapshot') throw new Error('Expected snapshot')
        const detail = await host.invoke({ ...request, operation: 'detail', recordKey: snapshot.rows[0]!.key, snapshotId: snapshot.snapshotId })
        expect(detail).toMatchObject({ kind: 'detail', item: snapshot.rows[0], scopeKey: snapshot.scopeKey })
    })
    it('loads the whole authorized cohort once, not the current filtered page', async () => {
        const collect = vi.fn(async () => createMomentumFixture())
        const host = new SharedMomentumFocusHost({ collect, now: () => new Date(momentumSampleNow) })
        const loaded = await host.invoke({ ...request, operation: 'load', query: { accountIds: ['harbor'], pageSize: 2, scope: 'mine' } })
        expect(loaded).toMatchObject({
            contractVersion: momentumFocusContractVersion, kind: 'dataset', asOf: new Date(momentumSampleNow).toISOString(),
            data: { scope: 'portfolio', customerIndustry: 'hls', records: expect.any(Array) }
        })
        if (loaded.kind !== 'dataset') throw new Error('Expected loaded dataset')
        expect(loaded.data.records).toHaveLength(createMomentumFixture().records.length)
        expect(collect).toHaveBeenCalledExactlyOnceWith('portfolio', 'hls')
        expect(await host.invoke({ ...request, operation: 'load', refresh: true })).toEqual(loaded)
    })
    it('revalidates access before detail and rejects stale snapshots, never returning cached private data', async () => {
        const data = createMomentumFixture()
        const collect = vi.fn(async () => structuredClone(data))
        const host = new SharedMomentumFocusHost({ collect, now: () => new Date(momentumSampleNow) })
        const snapshot = await host.invoke(request)
        if (snapshot.kind !== 'snapshot') throw new Error('Expected snapshot')
        data.records = []
        expect(await host.invoke({ ...request, operation: 'detail', recordKey: snapshot.rows[0]!.key, snapshotId: snapshot.snapshotId })).toMatchObject({ kind: 'unavailable', code: 'stale' })
        expect(collect).toHaveBeenCalledTimes(2)
    })
    it('discloses unavailable secure shared history and preserves useful current priorities', async () => {
        const data = createMomentumFixture()
        data.mode = 'live'
        const host = new SharedMomentumFocusHost({ collect: async () => data, now: () => new Date(momentumSampleNow) })
        const result = await host.invoke(request)
        if (result.kind !== 'snapshot') throw new Error('Expected snapshot')
        expect(result.sources).toContainEqual(expect.objectContaining({ source: 'history', state: 'unavailable' }))
        expect(result.rows.find((row) => row.id === 'blocker')!.tier).toBe('act-now')
        expect(result.rows.every((row) => row.progressCount === null)).toBe(true)
    })
    it('denies a team scope that has not been verified rather than silently returning a personal view', async () => {
        const data = createMomentumFixture()
        data.teamAvailable = false
        const host = new SharedMomentumFocusHost({ collect: async () => data, now: () => new Date(momentumSampleNow) })
        expect(await host.invoke({ ...request, query: { scope: 'team' } })).toMatchObject({ kind: 'unavailable', code: 'scope-unavailable' })
    })
    it('surfaces source authorization failures without a sample or cached-success fallback', async () => {
        const host = new SharedMomentumFocusHost({
            collect: async () => { throw Object.assign(new Error('Denied'), { status: 403 }) }
        })
        expect(await host.invoke(request)).toMatchObject({ kind: 'unavailable', code: 'forbidden' })
        await expect(host.invoke({ ...request, principalId: 'other' })).rejects.toThrow()
    })
    it('does not expose current or historical data if the source principal changes during a read', async () => {
        let current = 'a'
        const host = new SharedMomentumFocusHost({
            owner: async () => ({ tenantId: 'tenant', principalId: current, sourceId: 'https://crm.example.test', mode: 'live' }),
            collect: async () => { current = 'b'; return createMomentumFixture() },
            now: () => new Date(momentumSampleNow)
        })
        expect(await host.invoke(request)).toMatchObject({ kind: 'unavailable', code: 'unauthorized' })
    })
})
