import { describe, expect, it } from 'vitest'
import {
    stagePipelineReviewContractVersion, stagePipelineRequestSchema, stagePipelineResponseSchema, stagePipelineSnapshotSchema
} from '../../packages/common/contracts/stage-pipeline-review.js'
import { createSampleStagePipelineReview } from '../../packages/common/fixtures/stage-pipeline-review.js'

describe('Stage and Pipeline Review contract v1', () => {
    it('accepts the strict, fully synthetic sample snapshot', () => {
        const snapshot = createSampleStagePipelineReview()
        expect(stagePipelineResponseSchema.parse(snapshot)).toEqual(snapshot)
        expect(snapshot.contractVersion).toBe(stagePipelineReviewContractVersion)
        expect(snapshot.mode).toBe('sample')
        expect(snapshot.acr.accounts).toHaveLength(5)
        expect(snapshot.acr.accounts.every((account) => account.months.length === 12)).toBe(true)
    })

    it('rejects unknown fields, other contract versions and bad requests', () => {
        const snapshot = createSampleStagePipelineReview()
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, extra: true }).success).toBe(false)
        expect(stagePipelineSnapshotSchema.safeParse({ ...snapshot, contractVersion: '2.0' }).success).toBe(false)
        expect(stagePipelineRequestSchema.safeParse({ contractVersion: '1.0', operation: 'refresh' }).success).toBe(false)
        expect(stagePipelineRequestSchema.safeParse({ contractVersion: '1.0', operation: 'get' }).success).toBe(true)
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
})
