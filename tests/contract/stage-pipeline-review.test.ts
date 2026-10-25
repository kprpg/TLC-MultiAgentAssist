import { describe, expect, it } from 'vitest'
import {
    stagePipelineReviewContractVersion, stagePipelineRequestSchema, stagePipelineResponseSchema, stagePipelineSnapshotSchema,
    stagePipelineUnavailableSchema
} from '../../packages/common/contracts/stage-pipeline-review.js'
import { createSampleStagePipelineReview } from '../../packages/common/fixtures/stage-pipeline-review.js'

const unavailableAcr = (snapshot: ReturnType<typeof createSampleStagePipelineReview>) => ({
    source: 'derived-pipeline-only' as const, syncedAt: null, lastActualMonth: null,
    accounts: snapshot.acr.accounts.map((account) => ({
        customer: account.customer,
        months: account.months.map((month) => ({ ...month, actual: null, baseline: null, target: null }))
    }))
})

describe('Stage and Pipeline Review contract v1.1', () => {
    it('accepts the strict, fully synthetic sample snapshot', () => {
        const snapshot = createSampleStagePipelineReview()
        expect(stagePipelineResponseSchema.parse(snapshot)).toEqual(snapshot)
        expect(snapshot.contractVersion).toBe(stagePipelineReviewContractVersion)
        expect(stagePipelineReviewContractVersion).toBe('1.1')
        expect(snapshot.mode).toBe('sample')
        expect(snapshot.scope).toBe('mine')
        expect(snapshot.reports).toEqual([])
        expect(snapshot.acr.source).toBe('sample')
        expect(snapshot.acr.accounts).toHaveLength(5)
        expect(snapshot.acr.accounts.every((account) => account.months.length === 12)).toBe(true)
        expect(snapshot.sources.map((source) => source.source)).toEqual(expect.arrayContaining(['opportunities', 'milestones', 'acr']))
        expect(snapshot.opportunities.every((row) => row.owner.length > 0 && row.editable)).toBe(true)
    })

    it('has no manager forecast-commit capability: managers may not edit through this dashboard', () => {
        const snapshot = createSampleStagePipelineReview()
        expect(snapshot).not.toHaveProperty('capabilities')
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, capabilities: { forecastCommit: true } }).success).toBe(false)
    })

    it('rejects unknown fields, other contract versions and bad requests', () => {
        const snapshot = createSampleStagePipelineReview()
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, extra: true }).success).toBe(false)
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, contractVersion: '1.0' }).success).toBe(false)
        expect(stagePipelineRequestSchema.safeParse({ contractVersion: '1.0', operation: 'get' }).success).toBe(false)
        expect(stagePipelineRequestSchema.safeParse({ contractVersion: '1.1', operation: 'delete' }).success).toBe(false)
        expect(stagePipelineRequestSchema.safeParse({ contractVersion: '1.1', operation: 'get', extra: 1 }).success).toBe(false)
    })

    it('defaults requests to the seller portfolio and accepts get and refresh', () => {
        expect(stagePipelineRequestSchema.parse({ contractVersion: '1.1', operation: 'get' })).toEqual({
            contractVersion: '1.1', operation: 'get', scope: 'mine'
        })
        expect(stagePipelineRequestSchema.parse({ contractVersion: '1.1', operation: 'refresh', scope: 'both' }))
            .toMatchObject({ operation: 'refresh', scope: 'both' })
    })

    it('limits and scopes the direct-report selection', () => {
        const ids = Array.from({ length: 50 }, (_, index) => `user-${index}`)
        expect(stagePipelineRequestSchema.safeParse({ contractVersion: '1.1', operation: 'get', scope: 'reports', reportIds: ids }).success).toBe(true)
        expect(stagePipelineRequestSchema.safeParse({ contractVersion: '1.1', operation: 'get', scope: 'reports', reportIds: [...ids, 'extra'] }).success).toBe(false)
        expect(stagePipelineRequestSchema.safeParse({ contractVersion: '1.1', operation: 'get', scope: 'mine', reportIds: ['user-1'] }).success).toBe(false)
        expect(stagePipelineRequestSchema.safeParse({ contractVersion: '1.1', operation: 'get', scope: 'both', reportIds: [''] }).success).toBe(false)
    })

    it('rejects duplicate ids and orphan milestones', () => {
        const snapshot = createSampleStagePipelineReview()
        const [first] = snapshot.opportunities
        if (!first) throw new Error('missing sample opportunity')
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, opportunities: [...snapshot.opportunities, first] }).success).toBe(false)
        const orphan = { ...snapshot.milestones[0]!, id: 'orphan', opportunityId: 'missing' }
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, milestones: [...snapshot.milestones, orphan] }).success).toBe(false)
    })

    it('rejects an ACR account without twelve months', () => {
        const snapshot = createSampleStagePipelineReview()
        const [account] = snapshot.acr.accounts
        if (!account) throw new Error('missing sample account')
        const acr = { ...snapshot.acr, accounts: [{ ...account, months: account.months.slice(0, 11) }] }
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, acr }).success).toBe(false)
    })

    it('represents an unconnected ACR source with nulls and never fabricated zeros', () => {
        const snapshot = createSampleStagePipelineReview()
        const acr = unavailableAcr(snapshot)
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, acr }).success).toBe(true)
        const zeroed = { ...acr, accounts: acr.accounts.map((account) => ({ ...account, months: account.months.map((month) => ({ ...month, actual: 0 })) })) }
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, acr: zeroed }).success).toBe(false)
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, acr: { ...acr, syncedAt: '2026-09-30' } }).success).toBe(false)
        const nullActual = { ...snapshot.acr, accounts: [{ ...snapshot.acr.accounts[0]!, months: snapshot.acr.accounts[0]!.months.map((month) => ({ ...month, actual: null })) }] }
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, acr: nullActual }).success).toBe(false)
    })

    it('keeps the report scope consistent with the discovered direct reports', () => {
        const snapshot = createSampleStagePipelineReview()
        const reports = [{ id: 'user-1', displayName: 'Report One' }]
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, scope: 'reports', reports }).success).toBe(true)
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, scope: 'mine', reports }).success).toBe(false)
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, scope: 'both', reports: [...reports, ...reports] }).success).toBe(false)
    })

    it('validates per-source health and rejects duplicates', () => {
        const snapshot = createSampleStagePipelineReview()
        const source = { source: 'macc' as const, state: 'partial' as const, detail: 'MACC rows were not readable.' }
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, sources: [...snapshot.sources.filter((row) => row.source !== 'macc'), source] }).success).toBe(true)
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, sources: [source, source] }).success).toBe(false)
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, sources: [{ ...source, source: 'unknown' }] }).success).toBe(false)
    })

    it('reports forbidden and throttled sources explicitly', () => {
        for (const code of ['forbidden', 'throttled', 'source-unavailable', 'unauthorized', 'invalid-snapshot']) {
            expect(stagePipelineUnavailableSchema.safeParse({ contractVersion: '1.1', kind: 'unavailable', code, message: 'x' }).success).toBe(true)
        }
        expect(stagePipelineUnavailableSchema.safeParse({ contractVersion: '1.1', kind: 'unavailable', code: 'other', message: 'x' }).success).toBe(false)
    })
})
