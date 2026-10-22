import { describe, expect, it, vi } from 'vitest'
import { MutationSyncClient, type MutationInvoker } from '../../../apps/shared/mutation-sync.js'
import { mutationReceiptSchema, mutationReviewSchema, type MutationSyncResponse } from '../../../packages/common/contracts/cache-sync.js'

const review = mutationReviewSchema.parse({
  contractVersion: '1.0', id: '00000000-0000-4000-8000-000000000001',
  operation: 'updateOpportunity', input: { opportunityId: 'one', update: { comments: 'draft' } },
  digest: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z',
  before: { comments: 'original' }, recordKeys: ['opportunity:one']
})
const receipt = (state: 'accepted' | 'confirmed') => mutationReceiptSchema.parse({
  contractVersion: '1.0', id: review.id, operation: review.operation, state,
  acceptedAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z',
  recordKeys: review.recordKeys, ...(state === 'confirmed' ? { result: { comments: 'canonical' } } : {})
})
function invoker(available = true) {
  return vi.fn<MutationInvoker>(async (request): Promise<MutationSyncResponse> => {
    if (request.operation === 'capabilities') return { contractVersion: '1.0', kind: 'capabilities', capabilities: {
      contractVersion: '1.0', available, readCacheOwner: 'client', operations: available ? ['updateOpportunity'] : []
    } }
    if (request.operation === 'pending') return { contractVersion: '1.0', kind: 'pending', receipts: [] }
    if (request.operation === 'prepare') return { contractVersion: '1.0', kind: 'review', review }
    return { contractVersion: '1.0', kind: 'receipt', receipt: receipt(request.operation === 'submit' ? 'accepted' : 'confirmed') }
  })
}

describe('shared pending mutation client', () => {
  it('never auto-confirms a review whose operation or fields differ from the requested change', async () => {
    const call = invoker()
    const original = call.getMockImplementation()!
    call.mockImplementation(async (request) => request.operation === 'prepare'
      ? { contractVersion: '1.0', kind: 'review', review: { ...review, input: { ...review.input, update: { comments: 'Different intent' } } } }
      : original(request))
    const client = new MutationSyncClient(call)
    await expect(client.run('updateOpportunity', review.input, vi.fn(), (value) => value)).rejects.toThrow('exact requested change')
    expect(call.mock.calls.some(([request]) => request.operation === 'submit')).toBe(false)
    expect(client.hasPending()).toBe(false)
    client.dispose()
  })
  it('keeps confirmed and pending values separate until the canonical source result returns', async () => {
    const call = invoker()
    const onConfirmed = vi.fn()
    const client = new MutationSyncClient(call, { onConfirmed, pollMs: 1 })
    const result = client.run('updateOpportunity', review.input, vi.fn(), (value) => value)
    await vi.waitFor(() => expect(client.getSnapshot().jobs.some((job) => job.state === 'accepted' || job.state === 'confirmed')).toBe(true))
    expect(await result).toEqual({ comments: 'canonical' })
    expect(onConfirmed).toHaveBeenCalledOnce()
    expect(client.hasPending()).toBe(false)
    expect(call.mock.calls.filter(([request]) => request.operation === 'submit')).toHaveLength(1)
    client.dispose()
  })
  it('exposes an admission response loss as uncertain, not a forever-submitting or successful save', async () => {
    const call = invoker()
    call.mockImplementationOnce(async () => { throw new Error('Submission response lost') })
    const client = new MutationSyncClient(call)
    await expect(client.submitReviewed(review, 'Confirmed exact fields')).rejects.toThrow('response lost')
    expect(client.getSnapshot().jobs).toMatchObject([{ state: 'effect-unknown', error: 'Submission response lost' }])
    expect(client.hasPending()).toBe(true)
    client.dispose()
  })
  it('rejects a late admitted result after an actor or source reset', async () => {
    let release!: (value: MutationSyncResponse) => void
    const onConfirmed = vi.fn()
    const call = vi.fn<MutationInvoker>(() => new Promise((resolve) => { release = resolve }))
    const client = new MutationSyncClient(call, { onConfirmed })
    const admitted = client.submitReviewed(review, 'Confirmed exact fields')
    const rejected = expect(admitted).rejects.toMatchObject({ name: 'AbortError' })
    client.reset()
    release({ contractVersion: '1.0', kind: 'receipt', receipt: receipt('confirmed') })
    await rejected
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(client.getSnapshot().jobs).toEqual([])
    client.dispose()
  })
  it('does not patch a replacement source session with a late acknowledged-mode write', async () => {
    const onConfirmed = vi.fn()
    const call = invoker(false)
    let release!: (value: string) => void
    const fallback = vi.fn(() => new Promise<string>((resolve) => { release = resolve }))
    const client = new MutationSyncClient(call, { onConfirmed })
    const result = client.run('updateOpportunity', review.input, fallback, String)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(fallback).toHaveBeenCalledOnce())
    client.reset(); release('old actor result')
    await rejected
    expect(onConfirmed).not.toHaveBeenCalled()
    client.dispose()
  })
  it('can explicitly retry a failed initialization instead of memoizing its failure forever', async () => {
    const call = invoker(false)
    call.mockRejectedValueOnce(new Error('Receipt service unavailable'))
    const client = new MutationSyncClient(call)
    await expect(client.initialize()).rejects.toThrow('Receipt service unavailable')
    expect(client.getSnapshot()).toMatchObject({ initializationFailed: true, notice: 'Receipt service unavailable' })
    await client.retryInitialization()
    expect(client.getSnapshot().initializationFailed).toBeUndefined()
    client.dispose()
  })
  it('recovers admitted work independently of the pane that started it, without replay', async () => {
    const call = invoker()
    const original = call.getMockImplementation()!
    call.mockImplementation(async (request) => request.operation === 'pending'
      ? { contractVersion: '1.0', kind: 'pending', receipts: [receipt('accepted')] }
      : original(request))
    const onRecovered = vi.fn()
    const client = new MutationSyncClient(call, { onRecovered, pollMs: 1 })
    await client.initialize()
    await vi.waitFor(() => expect(onRecovered).toHaveBeenCalledOnce())
    expect(call.mock.calls.some(([request]) => request.operation === 'submit')).toBe(false)
    expect(client.hasPending()).toBe(false)
    client.dispose()
  })
  it('recovers receipts after admission is disabled and fences fallback writes on unresolved records', async () => {
    const call = invoker(false)
    const original = call.getMockImplementation()!
    call.mockImplementation(async (request) => {
      if (request.operation === 'capabilities') return { contractVersion: '1.0', kind: 'capabilities', capabilities: {
        contractVersion: '1.0', available: false, recoveryAvailable: true, readCacheOwner: 'client', operations: []
      } }
      if (request.operation === 'pending') return { contractVersion: '1.0', kind: 'pending',
        receipts: [{ ...receipt('accepted'), state: 'effect-unknown' }] }
      return original(request)
    })
    const fallback = vi.fn(async () => 'must not run')
    const client = new MutationSyncClient(call)
    await client.initialize()
    expect(client.hasPending()).toBe(true)
    await expect(client.run('updateOpportunity', review.input, fallback, String)).rejects.toThrow('uncertain source change')
    expect(fallback).not.toHaveBeenCalled()
    client.dispose()
  })
})
