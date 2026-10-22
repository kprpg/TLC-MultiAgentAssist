import { describe, expect, it } from 'vitest'
import {
  cachePolicySchema, defaultCachePolicy, mutationReceiptSchema, mutationSyncRequestSchema
} from '../../packages/common/contracts/cache-sync.js'

describe('independently versioned cache and mutation synchronization', () => {
  it('keeps the approved safe defaults bounded and strict', () => {
    expect(defaultCachePolicy).toMatchObject({
      mutableFreshMs: 300_000, referenceFreshMs: 1_800_000, maxInactiveEntries: 100,
      maxSerializedBytes: 67_108_864, readRetries: 2, maxConcurrentWrites: 2,
      confirmedRetentionMs: 2_592_000_000
    })
    expect(() => cachePolicySchema.parse({ readRetries: 3 })).toThrow()
    expect(() => cachePolicySchema.parse({ maxConcurrentWrites: 3 })).toThrow()
    expect(() => cachePolicySchema.parse({ accessToken: 'rejected' })).toThrow()
  })
  it('requires an exact, explicitly confirmed reviewed submission without caller-controlled input or identity', () => {
    const submission = { contractVersion: '1.0', operation: 'submit', id: '00000000-0000-4000-8000-000000000001',
      digest: 'a'.repeat(64), reason: 'Reviewed exact changes', confirmed: true }
    expect(mutationSyncRequestSchema.parse(submission)).toEqual(submission)
    for (const invalid of [{ ...submission, confirmed: false }, { ...submission, input: {} },
      { ...submission, actor: 'another-user' }, { ...submission, contractVersion: '1.1' }]) {
      expect(() => mutationSyncRequestSchema.parse(invalid)).toThrow()
    }
    expect(() => mutationSyncRequestSchema.parse({ contractVersion: '1.0', operation: 'prepare', mutation: 'arbitraryTool', input: {} })).toThrow()
  })
  it('distinguishes admission and uncertainty from source acknowledgement', () => {
    const receipt = { contractVersion: '1.0', id: '00000000-0000-4000-8000-000000000001',
      operation: 'updateOpportunity', state: 'effect-unknown', acceptedAt: '2026-10-21T12:00:00.000Z',
      updatedAt: '2026-10-21T12:00:01.000Z', recordKeys: ['opportunity:synthetic'] }
    expect(mutationReceiptSchema.parse(receipt).state).toBe('effect-unknown')
    expect(mutationReceiptSchema.parse({ ...receipt, state: 'accepted' }).state).not.toBe('confirmed')
    expect(() => mutationReceiptSchema.parse({ ...receipt, state: 'saved-offline' })).toThrow()
    expect(() => mutationReceiptSchema.parse({ ...receipt, accessToken: 'rejected' })).toThrow()
  })
})
