import { describe, expect, it } from 'vitest'
import {
    momentumFocusContractVersion, momentumFocusRequestSchema, momentumFocusResponseSchema, momentumRecordSchema
} from '../../packages/common/contracts/momentum-focus.js'
import { createMomentumFixture, momentumSampleNow } from '../../packages/common/fixtures/momentum-focus.js'
import { buildMomentumSnapshot } from '../../packages/orchestrator/momentum-focus/analytics.js'

describe('Momentum & Focus v1 contract (MF-006, MF-008, MF-009)', () => {
    const request = { contractVersion: momentumFocusContractVersion, operation: 'get' }
    it('versions the load-once contract and rejects older hosts and clients', () => {
        expect(momentumFocusContractVersion).toBe('1.2')
        for (const contractVersion of ['1.0', '1.1']) {
            expect(momentumFocusRequestSchema.safeParse({ ...request, contractVersion }).success).toBe(false)
        }
    })
    it('loads one complete scoped dataset and permits history capture only on an explicit load refresh', () => {
        expect(momentumFocusRequestSchema.parse({ ...request, operation: 'load' }).operation).toBe('load')
        expect(momentumFocusRequestSchema.parse({ ...request, operation: 'load', refresh: true }).refresh).toBe(true)
        expect(momentumFocusRequestSchema.safeParse({ ...request, refresh: true }).success).toBe(false)
        expect(momentumFocusRequestSchema.safeParse({ ...request, operation: 'load', recordKey: 'opportunity:moving' }).success).toBe(false)
    })
    it('defaults the two clocks independently and never accepts a caller identity', () => {
        expect(momentumFocusRequestSchema.parse(request).query).toMatchObject({
            focus: 'week', lookbackDays: 30, scope: 'portfolio', role: 'SSP', page: 1, customerIndustry: 'hls'
        })
        for (const extra of [{ principalId: 'other' }, { tenantId: 'other' }, { userId: 'other' }, { mode: 'live' }]) {
            expect(momentumFocusRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false)
        }
    })
    it('does not accept an unrecognized industry scope', () => {
        expect(momentumFocusRequestSchema.safeParse({ ...request, query: { customerIndustry: 'anything' } }).success).toBe(false)
        expect(momentumFocusRequestSchema.parse({ ...request, query: { customerIndustry: 'all' } }).query.customerIndustry).toBe('all')
    })
    it.each([
        { timezone: 'not/a-timezone' }, { focus: 'custom' },
        { focus: 'custom', from: '2026-10-30', to: '2026-10-01' },
        { lookbackDays: 0 }, { page: 0 }, { pageSize: 501 },
        { minValue: 20, maxValue: 10 }, { dateFrom: '2026-11-01', dateTo: '2026-10-01' },
        { currency: 'usd' }, { authorization: 'manager' }
    ])('rejects invalid filters %j', (query) => {
        expect(momentumFocusRequestSchema.safeParse({ ...request, query }).success).toBe(false)
    })
    it('does not apply numeric value ranges to incomparable currencies or financial bases', () => {
        expect(momentumFocusRequestSchema.safeParse({ ...request, query: { minValue: 1_000 } }).success).toBe(false)
        expect(momentumFocusRequestSchema.safeParse({ ...request, query: { minValue: 1_000, basis: 'pipeline', currency: 'USD' } }).success).toBe(true)
    })
    it('requires an exact record and snapshot identity for detail reads', () => {
        expect(momentumFocusRequestSchema.safeParse({ ...request, operation: 'detail' }).success).toBe(false)
        expect(momentumFocusRequestSchema.parse({ ...request, operation: 'detail', recordKey: 'opportunity:moving', snapshotId: 'snapshot' }).operation).toBe('detail')
    })
    it('round-trips the complete synthetic read model without replacing unknowns with zero', () => {
        const fixture = createMomentumFixture()
        const unknown = fixture.records.find((row) => row.id === 'unknown')!
        expect(unknown.value.amount).toBeNull()
        expect(unknown.dueDate).toBeNull()
        expect(momentumRecordSchema.parse(unknown)).toEqual(unknown)
        expect(momentumRecordSchema.safeParse({ ...unknown, value: { ...unknown.value, amount: Number.NaN } }).success).toBe(false)
        const snapshot = buildMomentumSnapshot(fixture, momentumFocusRequestSchema.parse(request).query, new Date(momentumSampleNow))
        expect(momentumFocusResponseSchema.parse(snapshot)).toEqual(snapshot)
        expect(momentumFocusResponseSchema.safeParse({ ...snapshot, privateToken: 'not-allowed' }).success).toBe(false)
    })
    it('bounds a loaded record to 1,000 source references plus 96 retained history observations', () => {
        const row = createMomentumFixture().records[0]!
        row.events = Array.from({ length: 1_096 }, (_, index) => ({ ...row.events[0]!, id: `synthetic-event-${index}` }))
        expect(momentumRecordSchema.safeParse(row).success).toBe(true)
        expect(momentumRecordSchema.safeParse({ ...row, events: [...row.events, row.events[0]!] }).success).toBe(false)
    })
    it('rejects unsafe evidence links and monetary aggregation without a validated unit', () => {
        const row = createMomentumFixture().records[0]!
        expect(momentumRecordSchema.safeParse({ ...row, sourceUrl: 'javascript:alert(1)' }).success).toBe(false)
        expect(momentumFocusRequestSchema.safeParse({ ...request, query: { heatmap: 'value' } }).success).toBe(false)
    })
})
