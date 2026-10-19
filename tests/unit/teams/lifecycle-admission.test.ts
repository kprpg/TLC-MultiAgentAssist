import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { CollaborationLifecycle } from '../../../packages/orchestrator/collaboration/lifecycle.js'
import { NotificationOutbox } from '../../../packages/orchestrator/collaboration/notifications.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import { ActionDispatchPreventedError, ReviewedActionService } from '../../../packages/orchestrator/collaboration/reviewed-actions.js'
import { loadTeamsAdmission } from '../../../apps/teams/src/configuration.js'
import type { Acquisition } from '../../../packages/common/contracts/collaboration.js'

const principal: ExecutionPrincipal = {
  key: 'tenant:user', tenantId: 'tenant', environmentId: 'env', userId: 'user',
  mode: 'live', roles: ['TLC.Teams.User']
}
const stores: SqliteDocumentStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture() {
  const store = new SqliteDocumentStore()
  stores.push(store)
  return { store, lifecycle: new CollaborationLifecycle(store) }
}

describe('durable collaboration admission and retirement', () => {
  it('deduplicates meeting notifications by evidence version without letting a waiting hint suppress the ready notice', async () => {
    const { store } = fixture()
    const outbox = new NotificationOutbox(store)
    const status: Acquisition = {
      contractVersion: '1.0', id: 'acquisition', meetingId: 'meeting', state: 'waiting',
      transcriptIds: [], attribution: 'unknown', detail: 'Waiting', checkedAt: new Date().toISOString()
    }
    await outbox.enqueueAcquisition(principal, { status })
    expect(await outbox.list(principal)).toEqual([])
    const ready = { ...status, state: 'ready' as const, transcriptIds: ['transcript'] }
    await outbox.enqueueAcquisition(principal, { status: ready, evidenceVersion: 'a'.repeat(64) })
    await outbox.enqueueAcquisition(principal, { status: ready, evidenceVersion: 'a'.repeat(64) })
    await outbox.enqueueAcquisition(principal, { status: ready, evidenceVersion: 'b'.repeat(64) })
    expect(await outbox.list(principal)).toHaveLength(2)
    const send = vi.fn().mockResolvedValue(undefined)
    await outbox.deliver(principal, send)
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('parses operator admission explicitly and rejects mistyped configuration', () => {
    expect(loadTeamsAdmission({})).toBe(true)
    expect(loadTeamsAdmission({ TLC_TEAMS_ADMISSION: 'read-only' })).toBe(false)
    expect(() => loadTeamsAdmission({ TLC_TEAMS_ADMISSION: 'mistyped' })).toThrow()
  })

  it('records known pre-dispatch prevention separately from an ambiguous external effect', async () => {
    const { store } = fixture()
    const writer = { ...principal, roles: [...principal.roles, 'TLC.Teams.Writer'] }
    const execute = vi.fn().mockRejectedValue(new ActionDispatchPreventedError())
    const actions = new ReviewedActionService(store, { authorize: async () => ({ revision: 'trusted-version' }), execute })
    const preview = await actions.prepare(writer, 'updateOpportunity', { opportunityId: 'opportunity' })
    const approval = { contractVersion: '1.0', id: preview.id, digest: preview.digest, reason: 'Reviewed exact intent' }
    expect(await actions.commit(writer, approval)).toMatchObject({ state: 'failed-before-send' })
    expect(await actions.commit(writer, approval)).toMatchObject({ state: 'failed-before-send' })
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('starts active, persists pause across service instances, and isolates users and environments', async () => {
    const { store, lifecycle } = fixture()
    expect(await lifecycle.assertActive(principal)).toMatchObject({ state: 'active', generation: 0, acceptingNewWork: true })
    await lifecycle.set(principal, 'pause')
    await expect(new CollaborationLifecycle(store).assertActive(principal)).rejects.toMatchObject({ code: 'collaboration_paused' })
    expect((await lifecycle.status({ ...principal, userId: 'other' })).state).toBe('active')
    expect((await lifecycle.status({ ...principal, environmentId: 'other' })).state).toBe('active')
    expect((await lifecycle.status(principal)).generation).toBe(1)
  })

  it('requires FTE admission to resume and advances the fence so pre-pause approvals cannot be reused', async () => {
    const { lifecycle } = fixture()
    await lifecycle.set(principal, 'pause')
    await expect(lifecycle.set({ ...principal, roles: [] }, 'resume')).rejects.toThrow(/authorized/i)
    const resumed = await lifecycle.set(principal, 'resume')
    expect(resumed).toMatchObject({ state: 'active', generation: 2, acceptingNewWork: true })
    expect(await lifecycle.assertActive(principal)).toEqual(resumed)
  })

  it('lets verified removal metadata revoke admission without inventing an authorized principal', async () => {
    const { lifecycle } = fixture()
    await lifecycle.deactivate({ tenantId: principal.tenantId, environmentId: principal.environmentId, userId: principal.userId })
    expect(await lifecycle.status(principal)).toMatchObject({ state: 'retired', generation: 1, acceptingNewWork: false })
    await expect(lifecycle.assertReadable(principal)).rejects.toMatchObject({ code: 'collaboration_retired' })
    await lifecycle.set(principal, 'resume')
    expect((await lifecycle.assertActive(principal)).generation).toBe(2)
  })

  it('keeps operator read-only admission disabled even when a user resumes', async () => {
    const { store } = fixture()
    const lifecycle = new CollaborationLifecycle(store, false)
    await lifecycle.set(principal, 'pause')
    await lifecycle.set(principal, 'resume')
    expect(await lifecycle.status(principal)).toMatchObject({ state: 'active', acceptingNewWork: false })
    await expect(lifecycle.assertActive(principal)).rejects.toMatchObject({ code: 'new_work_disabled' })
    await expect(lifecycle.assertReadable(principal)).resolves.toBeUndefined()
  })

  it('fences old delegated resource contexts across pause and resume, including an otherwise valid token', async () => {
    const { lifecycle } = fixture()
    await expect(lifecycle.assertGeneration(principal, 0)).resolves.toBeUndefined()
    await lifecycle.set(principal, 'pause')
    await expect(lifecycle.assertGeneration(principal, 0)).rejects.toMatchObject({ code: 'collaboration_context_changed' })
    await expect(lifecycle.assertGeneration(principal, 1)).resolves.toBeUndefined()
    await lifecycle.set(principal, 'resume')
    await expect(lifecycle.assertGeneration(principal, 1)).rejects.toMatchObject({ code: 'collaboration_context_changed' })
    await expect(lifecycle.assertGeneration(principal, 2)).resolves.toBeUndefined()
    await lifecycle.deactivate(principal)
    await expect(lifecycle.assertGeneration(principal, 2)).rejects.toMatchObject({ code: 'collaboration_retired' })
  })

  it('invalidates unsent notifications durably without replaying old messages after resume', async () => {
    const { store, lifecycle } = fixture()
    const outbox = new NotificationOutbox(store)
    const send = vi.fn().mockResolvedValue(undefined)
    await outbox.enqueue(principal, 'old-event', 'Review ready', 'private-reference')
    await lifecycle.set(principal, 'pause')
    expect(await outbox.list(principal)).toEqual([expect.objectContaining({ id: 'old-event', state: 'cancelled' })])
    await outbox.deliver(principal, send)
    expect(send).not.toHaveBeenCalled()
    await lifecycle.set(principal, 'resume')
    await outbox.enqueue(principal, 'new-event', 'New review ready', 'new-private-reference')
    await outbox.deliver(principal, send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toMatchObject({ id: 'new-event' })
    expect(await outbox.list(principal)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'old-event', state: 'cancelled' }),
      expect.objectContaining({ id: 'new-event', state: 'delivered' })
    ]))
  })
})
