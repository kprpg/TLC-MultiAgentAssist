import { afterEach, describe, expect, it, vi } from 'vitest'
import { updateVerifiedTeamsInstallation } from '../../../apps/teams/src/installation-lifecycle.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { CollaborationLifecycle } from '../../../packages/orchestrator/collaboration/lifecycle.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'

const tenantId = '11111111-1111-4111-8111-111111111111'
const userId = '55555555-5555-4555-8555-555555555555'
const scope = { tenantId, environmentId: 'test' }
const principal: ExecutionPrincipal = { ...scope, userId, key: 'test-user', mode: 'live', roles: ['TLC.Teams.User'] }
const stores: SqliteDocumentStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture() {
  const store = new SqliteDocumentStore(); stores.push(store)
  const onDeactivate = vi.fn().mockResolvedValue(undefined)
  return { store, onDeactivate, options: { store, scope, onDeactivate }, lifecycle: new CollaborationLifecycle(store) }
}
const personal = { tenantId, userId, conversationType: 'personal', conversationId: 'personal-conversation', timestamp: '2026-10-17T20:00:00.000Z' }

describe('verified Teams installation lifecycle mapping', () => {
  it('retires the exact personal owner and disables delivery without manufacturing FTE claims', async () => {
    const { store, options, lifecycle, onDeactivate } = fixture()
    await updateVerifiedTeamsInstallation(options, personal, 'remove')
    expect((await lifecycle.status(principal)).state).toBe('retired')
    expect(onDeactivate).toHaveBeenCalledWith({ ...scope, userId })
    expect((await store.read(`${tenantId}:test:delivery`, `personal:${userId}`))?.value).toMatchObject({ disabled: true })
    expect((await lifecycle.status({ ...principal, userId: 'other' })).state).toBe('active')
  })
  it('rejects a foreign tenant before changing any private admission or delivery state', async () => {
    const { options, lifecycle, onDeactivate } = fixture()
    await expect(updateVerifiedTeamsInstallation(options, { ...personal, tenantId: '66666666-6666-4666-8666-666666666666' }, 'remove')).rejects.toThrow(/tenant/i)
    expect((await lifecycle.status(principal)).state).toBe('active')
    expect(onDeactivate).not.toHaveBeenCalled()
  })
  it('disables a removed team context without retiring the remover or other personal users', async () => {
    const { options, store, lifecycle, onDeactivate } = fixture()
    await updateVerifiedTeamsInstallation(options, { ...personal, conversationType: 'channel', teamId: 'team-a', channelId: 'channel-a' }, 'remove')
    expect((await store.read(`${tenantId}:test:delivery`, 'team:team-a'))?.value).toMatchObject({ disabled: true })
    expect((await lifecycle.status(principal)).state).toBe('active')
    expect(onDeactivate).not.toHaveBeenCalled()
  })
  it('does not let a late older installation event re-enable removed delivery', async () => {
    const { options, store } = fixture()
    await updateVerifiedTeamsInstallation(options, personal, 'remove')
    await updateVerifiedTeamsInstallation(options, { ...personal, timestamp: '2026-10-17T19:00:00.000Z' }, 'add')
    expect((await store.read(`${tenantId}:test:delivery`, `personal:${userId}`))?.value).toMatchObject({ disabled: true })
  })
  it('orders equivalent valid timestamps numerically and lets removal win a same-time tie', async () => {
    const { options, store, lifecycle } = fixture()
    await updateVerifiedTeamsInstallation(options, { ...personal, timestamp: '2026-10-17T20:00:00Z' }, 'add')
    await updateVerifiedTeamsInstallation(options, personal, 'remove')
    expect((await store.read(`${tenantId}:test:delivery`, `personal:${userId}`))?.value).toMatchObject({ disabled: true })
    expect((await lifecycle.status(principal)).state).toBe('retired')
  })
  it('uses the previously authenticated conversation owner when removal metadata omits the AAD id', async () => {
    const { options, store, lifecycle } = fixture()
    await store.insert(`${tenantId}:test:delivery`, `conversation-owner:${personal.conversationId}`, { userId })
    await updateVerifiedTeamsInstallation(options, { ...personal, userId: undefined }, 'remove')
    expect((await lifecycle.status(principal)).state).toBe('retired')
  })
  it('does not treat reinstall metadata as a grant to resume private data work', async () => {
    const { options, lifecycle } = fixture()
    await updateVerifiedTeamsInstallation(options, personal, 'remove')
    await updateVerifiedTeamsInstallation(options, { ...personal, timestamp: '2026-10-17T21:00:00.000Z' }, 'add')
    expect((await lifecycle.status(principal)).state).toBe('retired')
  })
})
