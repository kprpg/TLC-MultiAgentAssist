import { describe, expect, it } from 'vitest'
import {
    sellerDashboardRequestSchema, sellerDashboardResponseSchema, sellerDashboardSnapshotSchema
} from '../../packages/common/contracts/seller-dashboard.js'
import { createSampleSellerDashboard } from '../../packages/common/fixtures/seller-dashboard.js'

const omittedMetricCases = createSampleSellerDashboard().report.accounts.flatMap((account) =>
    account.metrics.map((metric) => ({ account: account.name, tpid: account.tpid, metric: metric.metric }))
)

describe('Seller Dashboard contract v1', () => {
    it('accepts a strict, fully synthetic source-reported snapshot with signed and unknown actuals', () => {
        const snapshot = createSampleSellerDashboard()
        expect(sellerDashboardResponseSchema.parse(snapshot)).toEqual(snapshot)
        expect(snapshot.report.official.weightedAttainment).toBe(78)
        expect(snapshot.report.accounts.at(-1)?.metrics[0]?.actual).toBe(-30_000)
        expect(snapshot.report.accounts.at(-1)?.metrics[1]?.gap).toBeNull()
        expect(sellerDashboardSnapshotSchema.parse({ ...snapshot, supplement: null }).supplement).toBeNull()
    })

    it.each(omittedMetricCases)('rejects omission of $metric from $account', ({ tpid, metric }) => {
        const snapshot = createSampleSellerDashboard()
        const account = snapshot.report.accounts.find((row) => row.tpid === tpid)
        if (!account) throw new Error('Missing synthetic quota account.')
        account.metrics = account.metrics.filter((row) => row.metric !== metric)

        const result = sellerDashboardSnapshotSchema.safeParse(snapshot)

        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.error.issues).toContainEqual(expect.objectContaining({
                message: 'Account metrics must include the complete official metric set.'
            }))
        }
    })

    it('rejects an account with no metric rows instead of treating it as zero financial activity', () => {
        const snapshot = createSampleSellerDashboard()
        snapshot.report.accounts.at(-1)!.metrics = []
        expect(sellerDashboardSnapshotSchema.safeParse(snapshot).success).toBe(false)
    })

    it('accepts complete metric sets in any order and preserves unknown actuals', () => {
        const snapshot = createSampleSellerDashboard()
        for (const account of snapshot.report.accounts) account.metrics.reverse()
        const result = sellerDashboardSnapshotSchema.parse(snapshot)
        expect(result.report.official.weightedAttainment).toBe(78)
        expect(result.report.accounts.at(-1)?.metrics.find((row) => row.metric === 'Databases')).toMatchObject({
            actual: null, variance: null, gap: null
        })
    })

    it('version-checks every operation and requires explicit refresh confirmation', () => {
        expect(sellerDashboardRequestSchema.parse({ contractVersion: '1.0', operation: 'get' })).toEqual({ contractVersion: '1.0', operation: 'get' })
        expect(sellerDashboardRequestSchema.safeParse({ contractVersion: '1.0', operation: 'refresh' }).success).toBe(false)
        expect(sellerDashboardRequestSchema.safeParse({ contractVersion: '1.0', operation: 'refresh', confirmed: false }).success).toBe(false)
        expect(sellerDashboardRequestSchema.safeParse({ contractVersion: '2.0', operation: 'get' }).success).toBe(false)
        expect(sellerDashboardRequestSchema.safeParse({ contractVersion: '1.0', operation: 'get', profile: '../another-user' }).success).toBe(false)
        expect(sellerDashboardRequestSchema.safeParse({ contractVersion: '1.0', operation: 'refresh', confirmed: true, asOf: '2026-02-30' }).success).toBe(false)
    })

    it('rejects unsupported units, nonfinite money, duplicate records and extra private fields', () => {
        for (const mutate of [
            (snapshot: ReturnType<typeof createSampleSellerDashboard>) => { snapshot.report.official.weightedAttainment = Infinity },
            (snapshot: ReturnType<typeof createSampleSellerDashboard>) => { snapshot.report.opportunities.push(snapshot.report.opportunities[0]!) },
            (snapshot: ReturnType<typeof createSampleSellerDashboard>) => { snapshot.report.official.buckets[0]!.weight = 0.9 },
            (snapshot: ReturnType<typeof createSampleSellerDashboard>) => { snapshot.report.official.metrics[0]!.gap = 0 },
            (snapshot: ReturnType<typeof createSampleSellerDashboard>) => { snapshot.report.accounts.at(-1)!.metrics[1]!.actual = null; snapshot.report.accounts.at(-1)!.metrics[1]!.gap = 0 }
        ]) {
            const snapshot = createSampleSellerDashboard()
            mutate(snapshot)
            expect(sellerDashboardSnapshotSchema.safeParse(snapshot).success).toBe(false)
        }
        const snapshot = createSampleSellerDashboard()
        expect(sellerDashboardSnapshotSchema.safeParse({
            ...snapshot, report: { ...snapshot.report, plan: { ...snapshot.report.plan, currency: 'EUR' } }
        }).success).toBe(false)
        expect(sellerDashboardSnapshotSchema.safeParse({ ...snapshot, credentials: 'must-never-cross' }).success).toBe(false)
        expect(sellerDashboardSnapshotSchema.safeParse({ ...snapshot, report: { ...snapshot.report, rawSources: {} } }).success).toBe(false)
    })

    it('supports genuine zero calculated targets without manufacturing attainment', () => {
        const snapshot = createSampleSellerDashboard()
        const bucket = snapshot.report.official.buckets[0]!
        bucket.calcQuota = 0
        bucket.calcActual = -100
        bucket.gap = 100
        bucket.attainment = -12.5
        expect(sellerDashboardSnapshotSchema.parse(snapshot).report.official.buckets[0]).toMatchObject({
            calcQuota: 0, calcActual: -100, gap: 100, attainment: -12.5
        })
    })

    it('rejects outside-roster attribution and absent-pipeline claims on incomplete access', () => {
        const snapshot = createSampleSellerDashboard()
        snapshot.report.milestones[0]!.tpid = 'foreign-account'
        expect(sellerDashboardSnapshotSchema.safeParse(snapshot).success).toBe(false)
        const partial = createSampleSellerDashboard()
        partial.report.accounts.at(-1)!.pipeline.status = 'partial'
        expect(sellerDashboardSnapshotSchema.safeParse(partial).success).toBe(false)
        const period = createSampleSellerDashboard()
        period.report.period.end = '2027-07-01'
        expect(sellerDashboardSnapshotSchema.safeParse(period).success).toBe(false)
    })

    it('validates historical conversion baselines and source attribution without a live fallback', () => {
        const snapshot = createSampleSellerDashboard()
        snapshot.supplement!.conversion!.accounts[0]!.convertedCount = 999
        expect(sellerDashboardSnapshotSchema.safeParse(snapshot).success).toBe(false)
        const foreign = createSampleSellerDashboard()
        foreign.supplement!.consumption!.services[0]!.tpid = 'foreign-account'
        expect(sellerDashboardSnapshotSchema.safeParse(foreign).success).toBe(false)
        expect(sellerDashboardResponseSchema.parse({
            contractVersion: '1.0', kind: 'unavailable', mode: 'live',
            code: 'identity-mismatch', message: 'No private data was read.'
        })).toMatchObject({ kind: 'unavailable', mode: 'live' })
    })

    it('rejects unjustified complete supplements, forged timing and active consumption on lost parents', () => {
        const incomplete = createSampleSellerDashboard()
        incomplete.supplement!.consumption!.accounts.pop()
        expect(sellerDashboardSnapshotSchema.safeParse(incomplete).success).toBe(false)
        const timing = createSampleSellerDashboard()
        timing.report.milestones[0]!.timing = 'overdue'
        expect(sellerDashboardSnapshotSchema.safeParse(timing).success).toBe(false)
        const lost = createSampleSellerDashboard()
        lost.report.opportunities[0]!.state = 'Lost'
        expect(sellerDashboardSnapshotSchema.safeParse(lost).success).toBe(false)
    })
})
