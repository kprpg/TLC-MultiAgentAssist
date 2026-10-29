import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { MomentumHistoryRepository } from '../../../packages/connectors/msx/momentum-history.js'
import { createMomentumFixture } from '../../../packages/common/fixtures/momentum-focus.js'

describe('private Momentum observation history (MF-008, MF-009)', () => {
    const stores: SqliteDocumentStore[] = []
    afterEach(() => { for (const store of stores) store.close(); stores.length = 0 })
    function setup() {
        const store = new SqliteDocumentStore()
        stores.push(store)
        return { store, history: new MomentumHistoryRepository(store), owner: { tenantId: 'tenant', principalId: 'a', sourceId: 'https://crm.example.test', mode: 'live' as const } }
    }
    it('persists minimal first observations and keeps source time separate from observation time', async () => {
        const { history, owner } = setup()
        const row = createMomentumFixture().records[0]!
        const first = await history.observe(owner, row, '2026-09-01T12:00:00Z')
        expect(first.events).toEqual([])
        expect(first.availableSince).toBe('2026-09-01T12:00:00Z')
        row.stage = 'Inspire & Design'
        const changed = await history.observe(owner, row, '2026-09-03T12:00:00Z')
        expect(changed.events).toHaveLength(1)
        expect(changed.events[0]).toMatchObject({ kind: 'stage-advanced', sourceAt: null, intervalStart: '2026-09-01T12:00:00Z', intervalEnd: '2026-09-03T12:00:00Z' })
    })
    it('deduplicates concurrent refreshes, oscillation, repeated completions and reopenings', async () => {
        const { history, owner } = setup()
        const row = createMomentumFixture().records[0]!
        await history.observe(owner, row, '2026-09-01T12:00:00Z')
        row.stage = 'Empower & Achieve'
        await Promise.all(Array.from({ length: 4 }, () => history.observe(owner, row, '2026-09-02T12:00:00Z')))
        row.stage = 'Listen & Consult'
        await history.observe(owner, row, '2026-09-03T12:00:00Z')
        row.stage = 'Empower & Achieve'
        const result = await history.observe(owner, row, '2026-09-04T12:00:00Z')
        expect(result.events.filter((event) => event.kind === 'stage-advanced')).toHaveLength(1)
        expect(result.events.filter((event) => event.kind === 'loopback')).toHaveLength(1)
    })
    it('never treats a date push or generic source edit as positive progress', async () => {
        const { history, owner } = setup()
        const row = createMomentumFixture().records[0]!
        await history.observe(owner, row, '2026-09-01T12:00:00Z')
        row.dueDate = '2027-01-31'
        row.sourceUpdatedAt = '2026-09-02T10:00:00Z'
        const result = await history.observe(owner, row, '2026-09-02T12:00:00Z')
        expect(result.events.map((event) => event.kind)).toEqual(['date-slipped'])
    })
    it('isolates tenant, principal, source and sample/live partitions without copying private data', async () => {
        const { history, owner } = setup()
        const row = createMomentumFixture().records[0]!
        await history.observe(owner, row, '2026-09-01T12:00:00Z')
        for (const changed of [{ principalId: 'b' }, { tenantId: 'other' }, { sourceId: 'https://other.example.test' }, { mode: 'sample' as const }]) {
            expect(await history.read({ ...owner, ...changed }, row.key, '2026-09-02T12:00:00Z')).toBeNull()
        }
        expect(await history.read(owner, row.key, '2026-09-02T12:00:00Z')).not.toBeNull()
    })
    it('expires retained observations after 180 days and does not backfill gaps', async () => {
        const { history, owner } = setup()
        const row = createMomentumFixture().records[0]!
        await history.observe(owner, row, '2026-01-01T12:00:00Z')
        expect(await history.read(owner, row.key, '2026-10-28T12:00:00Z')).toBeNull()
        const next = await history.observe(owner, row, '2026-10-28T12:00:00Z')
        expect(next.availableSince).toBe('2026-10-28T12:00:00Z')
        expect(next.events).toEqual([])
    })
    it('stores no customer names, notes, amounts, tokens or history outside the authorized record key', async () => {
        const { history, store, owner } = setup()
        const row = createMomentumFixture().records[0]!
        await history.observe(owner, row, '2026-09-01T12:00:00Z')
        const serialized = JSON.stringify(await store.read(history.partition(owner), history.documentKey(row.key)))
        expect(serialized).not.toContain(row.accountName!)
        expect(serialized).not.toContain(row.name)
        expect(serialized).not.toContain('amount')
    })
    it('bounds retained change documents to the secure store size and moves coverage forward when older changes are clipped', async () => {
        const { history, store, owner } = setup()
        const row = createMomentumFixture().records[0]!
        for (let index = 0; index < 140; index++) {
            const at = new Date(Date.UTC(2026, 0, index + 1, 12)).toISOString()
            row.dueDate = new Date(Date.UTC(2027, 0, index + 1, 12)).toISOString().slice(0, 10)
            await history.observe(owner, row, at)
        }
        const stored = await store.read(history.partition(owner), history.documentKey(row.key))
        expect(Buffer.byteLength(JSON.stringify(stored!.value))).toBeLessThan(48_000)
        const result = await history.read(owner, row.key, '2026-05-20T12:00:00Z')
        expect(result!.events.length).toBeLessThanOrEqual(96)
        expect(result!.availableSince).not.toBe('2026-01-01T12:00:00.000Z')
    })
})
