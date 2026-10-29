import { describe, expect, it, vi } from 'vitest'
import { MomentumDataSession } from '../../../apps/shared/dashboards/momentumFocus/momentum-data-session.js'
import { createMomentumFocusHost, SharedMomentumFocusHost } from '../../../packages/orchestrator/momentum-focus/host.js'
import { buildMomentumSnapshot } from '../../../packages/orchestrator/momentum-focus/analytics.js'
import { createMomentumFixture, momentumSampleNow } from '../../../packages/common/fixtures/momentum-focus.js'
import {
    momentumFocusQuerySchema, type MomentumFocusQuery, type MomentumFocusRequest, type MomentumFocusResponse
} from '../../../packages/common/contracts/momentum-focus.js'
import * as projection from '../../../packages/common/projections/momentum-focus.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { MomentumHistoryRepository } from '../../../packages/connectors/msx/momentum-history.js'

const query = (changes: Partial<MomentumFocusQuery> = {}) => momentumFocusQuerySchema.parse(changes)
function sampleSession() {
    const host = createMomentumFocusHost({ mode: 'sample' })
    const invoke = vi.fn((request: MomentumFocusRequest) => host.invoke(request))
    return { invoke, session: new MomentumDataSession(invoke) }
}

describe('Momentum load-once dataset session', () => {
    it('filters all loaded records locally with exactly the same rules as the orchestrator', async () => {
        const { session, invoke } = sampleSession()
        const inputs: Partial<MomentumFocusQuery>[] = [
            {}, { role: 'SE' }, { focus: 'month' }, { focus: 'custom', from: '2026-10-29', to: '2026-11-25' },
            { lookbackDays: 7 }, { lookbackDays: 14 }, { lookbackDays: 90 }, { timezone: 'Pacific/Auckland' },
            { accountIds: ['harbor'] }, { opportunityIds: ['moving'] }, { milestoneIds: ['proof'] },
            { stages: ['Listen & Consult'] }, { opportunityStatuses: ['On Hold'] }, { milestoneStatuses: ['Blocked'] },
            { ownerIds: ['other'] }, { sourceQuality: ['unknown'] }, { currency: 'EUR' }, { entity: 'milestone' },
            { basis: 'pipeline', currency: 'USD', minValue: 200_000, maxValue: 1_000_000 },
            { dateFrom: '2026-10-29', dateTo: '2026-11-30', includeUndated: false },
            { lens: 'advancing' }, { lens: 'review' }, { lens: 'busy' }, { lens: 'history' }, { lens: 'unknown-history' },
            { lens: 'weekly' }, { lens: 'monthly' }, { deadline: 'overdue' },
            { accountSort: 'activity' }, { accountSort: 'review' },
            { heatmap: 'value', basis: 'monthly-usage', currency: 'EUR' }, { scope: 'mine' },
            { pageSize: 2 }, { pageSize: 2, page: 2 }, { pageSize: 10 }
        ]
        for (const input of inputs) {
            const selected = query(input)
            expect(await session.snapshot(selected)).toEqual(buildMomentumSnapshot(createMomentumFixture(), selected, new Date(momentumSampleNow)))
        }
        expect(invoke).toHaveBeenCalledTimes(1)
        expect(invoke.mock.calls[0]![0]).toMatchObject({ operation: 'load', query: { customerIndustry: 'hls', scope: 'portfolio' } })
    })
    it('reuses the prepared filtered cohort for paging and page-size changes; detail is local and not page-limited', async () => {
        const prepare = vi.spyOn(projection, 'prepareMomentumView')
        try {
            const { session, invoke } = sampleSession()
            const first = await session.snapshot(query({ pageSize: 2 }))
            const second = await session.snapshot(query({ pageSize: 2, page: 2 }))
            const larger = await session.snapshot(query({ pageSize: 10 }))
            expect(first.rows).toHaveLength(2)
            expect(second.rows).toHaveLength(2)
            expect(second.rows[0]!.key).not.toBe(first.rows[0]!.key)
            expect(second.total).toBe(first.total)
            expect(second.charts).toEqual(first.charts)
            expect(larger.charts).toEqual(first.charts)
            expect(session.detail(second.rows[0]!.key, first)).toEqual(second.rows[0])
            expect(() => session.detail('opportunity:outside-authorized-cohort', first)).toThrow('current loaded')
            expect(invoke).toHaveBeenCalledTimes(1)
            expect(prepare).toHaveBeenCalledTimes(1)
        } finally { prepare.mockRestore() }
    })
    it('single-flights the first load even when the role or paging changes while it is pending', async () => {
        const host = createMomentumFocusHost({ mode: 'sample' })
        let release!: () => void
        const ready = new Promise<void>((done) => { release = done })
        const invoke = vi.fn(async (request: MomentumFocusRequest) => { await ready; return host.invoke(request) })
        const session = new MomentumDataSession(invoke)
        const first = session.snapshot(query())
        const second = session.snapshot(query({ role: 'SE', pageSize: 2 }))
        release()
        expect((await first).query.role).toBe('SSP')
        expect((await second).query.role).toBe('SE')
        expect(invoke).toHaveBeenCalledTimes(1)
    })
    it('pages a larger canonical-derived cohort without reloading or rebuilding its filtered read model', async () => {
        const fixture = createMomentumFixture()
        const data = { ...fixture, records: Array.from({ length: 150 }, (_, copy) => fixture.records.map((row) => ({
            ...structuredClone(row), id: `${row.id}-${copy}`, key: `${row.entity}:${row.id}-${copy}`, opportunityId: `${row.opportunityId}-${copy}`
        }))).flat() }
        const collect = vi.fn(async () => data)
        const host = new SharedMomentumFocusHost({ collect, now: () => new Date(momentumSampleNow) })
        const invoke = vi.fn((request: MomentumFocusRequest) => host.invoke(request))
        const session = new MomentumDataSession(invoke)
        const prepare = vi.spyOn(projection, 'prepareMomentumView')
        try {
            const first = await session.snapshot(query())
            expect(first.total).toBe(1_650)
            for (let page = 1; page <= 50; page++) {
                const next = await session.snapshot(query({ role: 'SE', page, pageSize: 25 }))
                expect(next.total).toBe(first.total)
                expect(next.rows).toHaveLength(25)
                expect(next.charts.values).toEqual(first.charts.values)
            }
            expect(collect).toHaveBeenCalledTimes(1)
            expect(invoke).toHaveBeenCalledTimes(1)
            expect(prepare).toHaveBeenCalledTimes(2)
        } finally { prepare.mockRestore() }
    })
    it('does not prefetch broader industries or Team; revisiting a loaded cohort and My work needs no request', async () => {
        const { session, invoke } = sampleSession()
        await session.snapshot(query())
        await session.snapshot(query({ scope: 'mine' }))
        expect(invoke).toHaveBeenCalledTimes(1)
        await session.snapshot(query({ customerIndustry: 'all' }))
        expect(invoke).toHaveBeenCalledTimes(2)
        await session.snapshot(query({ scope: 'team' }))
        expect(invoke).toHaveBeenCalledTimes(3)
        await session.snapshot(query())
        await session.snapshot(query({ customerIndustry: 'all', scope: 'mine' }))
        expect(invoke).toHaveBeenCalledTimes(3)
    })
    it('invalidates all cohorts on Refresh and captures history exactly once on the fresh load', async () => {
        const { session, invoke } = sampleSession()
        await session.snapshot(query())
        await session.snapshot(query({ customerIndustry: 'all' }))
        session.invalidate()
        await Promise.all([session.snapshot(query(), true), session.snapshot(query({ role: 'SE' }), true)])
        expect(invoke).toHaveBeenCalledTimes(3)
        expect(invoke.mock.calls[2]![0]).toMatchObject({ operation: 'load', refresh: true })
        await session.snapshot(query({ page: 2, pageSize: 2 }))
        expect(invoke).toHaveBeenCalledTimes(3)
        await session.snapshot(query({ customerIndustry: 'all' }))
        expect(invoke).toHaveBeenCalledTimes(4)
    })
    it('does not allow an older in-flight dataset to replace a refreshed one', async () => {
        const host = createMomentumFocusHost({ mode: 'sample' })
        let release!: () => void
        const ready = new Promise<void>((done) => { release = done })
        const invoke = vi.fn(async (request: MomentumFocusRequest) => {
            if (!request.refresh) await ready
            return host.invoke(request)
        })
        const session = new MomentumDataSession(invoke)
        const older = session.snapshot(query()).catch((error: unknown) => error)
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
        session.invalidate()
        const fresh = await session.snapshot(query(), true)
        release()
        expect(await older).toBeInstanceOf(Error)
        expect(await session.snapshot(query())).toEqual(fresh)
        expect(invoke).toHaveBeenCalledTimes(2)
    })
    it('never rereads MSX or private per-record history for local interactions; Refresh captures once', async () => {
        const store = new SqliteDocumentStore()
        try {
            const history = new MomentumHistoryRepository(store)
            const read = vi.spyOn(history, 'read'), observe = vi.spyOn(history, 'observe')
            const collect = vi.fn(async () => ({ ...createMomentumFixture(), mode: 'live' as const }))
            const host = new SharedMomentumFocusHost({
                collect, history, now: () => new Date(momentumSampleNow),
                owner: async () => ({ tenantId: 'tenant', principalId: 'a', sourceId: 'https://crm.example.test', mode: 'live' })
            })
            const session = new MomentumDataSession((request) => host.invoke(request))
            const first = await session.snapshot(query({ pageSize: 2 }))
            for (const input of [{ role: 'SE' }, { lookbackDays: 90 }, { page: 2, pageSize: 2 }, { scope: 'mine' }] satisfies Partial<MomentumFocusQuery>[]) {
                await session.snapshot(query(input))
            }
            session.detail(first.rows[0]!.key, first)
            const records = createMomentumFixture().records.length
            expect(collect).toHaveBeenCalledTimes(1)
            expect(read).toHaveBeenCalledTimes(records)
            expect(observe).not.toHaveBeenCalled()
            session.invalidate()
            await session.snapshot(query(), true)
            await session.snapshot(query({ role: 'SE', pageSize: 2 }))
            expect(collect).toHaveBeenCalledTimes(2)
            expect(read).toHaveBeenCalledTimes(records)
            expect(observe).toHaveBeenCalledTimes(records)
        } finally { store.close() }
    })
    it('clears every cached cohort after denied refreshes, without returning a stale success', async () => {
        const host = createMomentumFocusHost({ mode: 'sample' })
        let deny = false
        const invoke = vi.fn(async (request: MomentumFocusRequest): Promise<MomentumFocusResponse> => deny
            ? { contractVersion: request.contractVersion, kind: 'unavailable', code: 'forbidden', message: 'Synthetic access revoked.' }
            : host.invoke(request))
        const session = new MomentumDataSession(invoke)
        const snapshot = await session.snapshot(query())
        await session.snapshot(query({ customerIndustry: 'all' }))
        session.invalidate()
        deny = true
        await expect(session.snapshot(query(), true)).rejects.toThrow('Synthetic access revoked')
        expect(session.hasDataset(query())).toBe(false)
        expect(session.hasDataset(query({ customerIndustry: 'all' }))).toBe(false)
        expect(() => session.detail(snapshot.rows[0]!.key, snapshot)).toThrow('current loaded')
    })
    it('rejects mismatched industry, scope, rule and identity bundles rather than reusing private data', async () => {
        for (const mismatch of ['industry', 'scope', 'identity', 'mode', 'rule'] as const) {
            let changed = false
            const host = new SharedMomentumFocusHost({
                now: () => new Date(momentumSampleNow),
                collect: async (scope, industry) => ({ ...createMomentumFixture(industry), scope, scopeKey: changed ? 'other-source-principal' : 'first-source-principal' })
            })
            const session = new MomentumDataSession(async (request: MomentumFocusRequest) => {
                const response = await host.invoke(request)
                if (response.kind === 'dataset' && changed) {
                    if (mismatch === 'industry') response.data.customerIndustry = 'hls'
                    if (mismatch === 'scope') response.data.scope = 'team'
                    if (mismatch === 'mode') { response.data.scopeKey = 'first-source-principal'; response.data.mode = 'live' }
                    if (mismatch === 'rule') return { ...response, ruleVersion: 'unrecognized-rules' }
                }
                return response
            })
            await session.snapshot(query())
            changed = true
            await expect(session.snapshot(query({ customerIndustry: 'all' }))).rejects.toThrow()
            expect(session.hasDataset(query())).toBe(false)
        }
    })
    it('keeps sessions isolated and invalidates their local rows and detail on source-session changes', async () => {
        const first = sampleSession(), second = sampleSession()
        const snapshot = await first.session.snapshot(query())
        expect(second.session.hasDataset(query())).toBe(false)
        expect(() => second.session.detail(snapshot.rows[0]!.key, snapshot)).toThrow('current loaded')
        first.session.invalidate()
        expect(first.session.hasDataset(query())).toBe(false)
        expect(() => first.session.detail(snapshot.rows[0]!.key, snapshot)).toThrow('current loaded')
        await first.session.snapshot(query())
        expect(first.invoke).toHaveBeenCalledTimes(2)
    })
})
