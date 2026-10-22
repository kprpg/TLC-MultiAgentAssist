import { describe, expect, it, vi } from 'vitest'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { createMutationSession } from '../../../packages/orchestrator/mutations/composition.js'
import { bindSourceToken, delegatedMutationActor } from '../../../packages/orchestrator/mutations/core-adapter.js'
import type { MutationSyncRequest } from '../../../packages/common/contracts/cache-sync.js'

describe('private recovery and delegated source identity', () => {
  it('disables new admission without disabling private reconciliation or requiring current write permission', async () => {
    const services = await createSampleApplicationServices()
    const store = new SqliteDocumentStore()
    const core = services.orchestrator
    const update = core.updateOpportunity.bind(core)
    const execute = vi.spyOn(core, 'updateOpportunity').mockImplementation(async (id, input) => {
      await update(id, input)
      throw new Error('Source result lost after commit')
    })
    let writing = true
    const options = { core, mode: 'sample' as const, source: 'recovery-test',
      state: { store, durable: true, close() {} }, enabled: true, readCacheOwner: 'client' as const,
      assertAllowed: async () => { if (!writing) throw new Error('Write permission is no longer available') } }
    const first = createMutationSession(options)
    const recovery = createMutationSession({ ...options, enabled: false })
    try {
      const prepared = await first.invoke({ contractVersion: '1.0', operation: 'prepare', mutation: 'updateOpportunity',
        input: { opportunityId: 'opp-grid-modernization', update: { comments: 'Synthetic confirmed intent' } } })
      if (prepared.kind !== 'review') throw new Error('Expected review')
      const submit: MutationSyncRequest = { contractVersion: '1.0', operation: 'submit', id: prepared.review.id,
        digest: prepared.review.digest, reason: 'Confirmed exact synthetic fields', confirmed: true }
      await first.invoke(submit)
      await first.drain()
      writing = false
      expect(await recovery.invoke({ contractVersion: '1.0', operation: 'capabilities' })).toMatchObject({
        capabilities: { available: false, recoveryAvailable: true }
      })
      expect(await recovery.invoke({ contractVersion: '1.0', operation: 'pending' })).toMatchObject({
        receipts: [expect.objectContaining({ state: 'effect-unknown' })]
      })
      expect(await recovery.invoke({ contractVersion: '1.0', operation: 'reconcile', id: prepared.review.id })).toMatchObject({
        receipt: { state: 'reconciled-current-state' }
      })
      await expect(recovery.invoke({ contractVersion: '1.0', operation: 'prepare', mutation: 'updateOpportunity',
        input: prepared.review.input })).rejects.toThrow('does not support')
      expect(execute).toHaveBeenCalledOnce()
    } finally { await recovery.drain(); store.close(); await services.dispose() }
  })
  it('binds the actual delegated subject across renewals and rejects an actor swap or app-only token', async () => {
    const token = (oid: string, delegated = true) => `synthetic.${Buffer.from(JSON.stringify({
      tid: '11111111-1111-4111-8111-111111111111', oid, ...(delegated ? { scp: 'user_impersonation' } : { roles: ['Application.Access'] })
    })).toString('base64url')}.synthetic`
    let current = token('22222222-2222-4222-8222-222222222222')
    const changed = vi.fn()
    const bound = bindSourceToken(async () => current, 'synthetic-source', changed)
    await bound()
    await bound()
    current = token('33333333-3333-4333-8333-333333333333')
    await expect(bound()).rejects.toMatchObject({ code: 'session-changed', status: 401 })
    expect(changed).toHaveBeenCalledOnce()
    const appOnly = delegatedMutationActor('synthetic-source', async () => token('22222222-2222-4222-8222-222222222222', false))
    await expect(appOnly.resolve()).rejects.toMatchObject({ code: 'auth-required', status: 401 })
  })
})
