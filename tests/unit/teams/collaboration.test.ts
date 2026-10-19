import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { CollaborationService, type ContextAuthority } from '../../../packages/orchestrator/collaboration/contexts.js'
import { NotificationOutbox } from '../../../packages/orchestrator/collaboration/notifications.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'

const user: ExecutionPrincipal = { key: 't:u', tenantId: 't', userId: 'u', environmentId: 'env', roles: ['TLC.Teams.User', 'TLC.Teams.ContextAdmin', 'TLC.Teams.Publisher'], mode: 'sample' }
const stores: SqliteDocumentStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture() {
  const store = new SqliteDocumentStore()
  stores.push(store)
  const verify = vi.fn<ContextAuthority['verify']>().mockResolvedValue({ revision: 'policy-v1', canConfigure: true, canPublish: true, audienceEligible: true })
  const readAccount = vi.fn().mockResolvedValue(undefined)
  const service = new CollaborationService(store, { verify }, readAccount)
  return { store, service, verify, readAccount }
}

describe('context binding and disclosure admission', () => {
  it('does not accept browser-provided authority or configure without both source and context access', async () => {
    const { service, verify, readAccount } = fixture()
    const input = { kind: 'channel', contextId: 'ctx', accountId: 'account' }
    await expect(service.bind(user, { ...input, isOwner: true })).rejects.toThrow()
    verify.mockResolvedValueOnce({ revision: 'v1', canConfigure: false, canPublish: false, audienceEligible: true })
    await expect(service.bind(user, input)).rejects.toThrow(/authorized/i)
    readAccount.mockRejectedValueOnce(new Error('Source permission denied'))
    await expect(service.bind(user, input)).rejects.toThrow(/permission/i)
  })
  it('rechecks every viewer and never grants source access through a shared binding', async () => {
    const { service, readAccount, verify } = fixture()
    const binding = await service.bind(user, { kind: 'channel', contextId: 'ctx', accountId: 'account' })
    expect(binding.id).not.toBe('ctx')
    const viewer = { ...user, key: 't:viewer', userId: 'viewer', roles: ['TLC.Teams.User'] }
    expect(await service.get(viewer, binding.id)).toMatchObject({ accountId: 'account' })
    readAccount.mockRejectedValueOnce(new Error('Source denied for viewer'))
    await expect(service.get(viewer, binding.id)).rejects.toThrow(/denied/i)
    verify.mockRejectedValueOnce(new Error('Not a context member'))
    await expect(service.get(viewer, binding.id)).rejects.toThrow(/member/i)
    await expect(service.get({ ...viewer, tenantId: 'other' }, binding.id)).rejects.toThrow(/unavailable/i)
  })
  it('blocks shared business content for unknown or ineligible audience and changed policy', async () => {
    const { service, verify } = fixture()
    const binding = await service.bind(user, { kind: 'meeting', contextId: 'meeting', accountId: 'account' })
    expect(await service.admitPublication(user, binding.id)).toMatchObject({ policyRevision: 'policy-v1' })
    verify.mockResolvedValueOnce({ revision: 'v2', canConfigure: true, canPublish: true, audienceEligible: false })
    await expect(service.admitPublication(user, binding.id)).rejects.toThrow(/audience/i)
    await expect(service.admitPublication({ ...user, roles: ['TLC.Teams.User'] }, binding.id)).rejects.toThrow(/authorized/i)
  })
})

describe('event-driven personal notification outbox', () => {
  it('deduplicates events, isolates users, and never retries an ambiguous send', async () => {
    const { store } = fixture()
    const outbox = new NotificationOutbox(store)
    await outbox.enqueue(user, 'event', 'Review ready', 'review-id')
    await outbox.enqueue(user, 'event', 'Review ready', 'review-id')
    const send = vi.fn().mockRejectedValue(new Error('Lost delivery response'))
    await outbox.deliver(user, send)
    await outbox.deliver(user, send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(await outbox.list(user)).toMatchObject([{ state: 'delivery-unknown', title: 'Review ready' }])
    expect(await outbox.list({ ...user, userId: 'other' })).toEqual([])
  })
})
