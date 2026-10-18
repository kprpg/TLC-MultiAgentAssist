import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { ReviewedActionService } from '../../../packages/orchestrator/collaboration/reviewed-actions.js'
import { collaborationVersion } from '../../../packages/common/contracts/collaboration.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'

const principal: ExecutionPrincipal = { key: 'tenant:user', tenantId: 'tenant', userId: 'user', environmentId: 'env', roles: ['TLC.Teams.User', 'TLC.Teams.Writer'], mode: 'sample' }
const other = { ...principal, userId: 'other', key: 'tenant:other' }
const folders: string[] = []
const stores: SqliteDocumentStore[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})
async function storePair() {
  const folder = await mkdtemp(join(tmpdir(), 'tlc-teams-state-'))
  folders.push(folder)
  const a = new SqliteDocumentStore(join(folder, 'state.sqlite'))
  const b = new SqliteDocumentStore(join(folder, 'state.sqlite'))
  stores.push(a, b)
  return [a, b] as const
}

describe('isolated conditional-write state', () => {
  it('persists across connections and admits one winner without exposing another partition', async () => {
    const [a, b] = await storePair()
    expect(await a.insert('user', 'action', { value: 1 })).toBe(true)
    expect(await b.insert('user', 'action', { value: 2 })).toBe(false)
    expect(await b.read('user', 'action')).toEqual({ revision: 1, value: { value: 1 } })
    expect(await a.read('other', 'action')).toBeUndefined()
    expect(await b.replace('user', 'action', 1, { value: 3 })).toBe(true)
    expect(await a.replace('user', 'action', 1, { value: 4 })).toBe(false)
    expect(await a.list('user', 'act', 10)).toHaveLength(1)
    expect(await a.list('other', '', 10)).toEqual([])
  })
})

describe('reviewed source effects', () => {
  it('requires exact review, rejects another actor and dispatches once across two instances', async () => {
    const [a, b] = await storePair()
    const execute = vi.fn().mockResolvedValue({ id: 'source-receipt' })
    const authorize = vi.fn().mockResolvedValue({ before: 'old' })
    const first = new ReviewedActionService(a, { authorize, execute })
    const second = new ReviewedActionService(b, { authorize, execute })
    const preview = await first.prepare(principal, 'updateOpportunity', { opportunityId: 'opp', update: { comments: 'new' } })
    expect(execute).not.toHaveBeenCalled()
    const approval = { contractVersion: collaborationVersion, id: preview.id, digest: preview.digest, reason: 'Reviewed target and evidence' }
    await expect(second.commit(other, approval)).rejects.toThrow(/unavailable|authorized/i)
    await expect(first.commit(principal, { ...approval, digest: 'b'.repeat(64) })).rejects.toThrow(/review|digest/i)
    const results = await Promise.allSettled([first.commit(principal, approval), second.commit(principal, approval)])
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(await second.commit(principal, approval)).toMatchObject({ state: 'confirmed', result: { id: 'source-receipt' } })
    expect((await a.read('tenant:env:user', `action:${preview.id}`))?.value).toMatchObject({
      approval: { reason: 'Reviewed target and evidence' }
    })
  })
  it('rechecks permissions and before state, expires approvals, and never accepts a caller payload', async () => {
    const [store] = await storePair()
    let now = Date.parse('2026-10-17T20:00:00Z')
    const authorize = vi.fn().mockResolvedValue({ value: 1 })
    const execute = vi.fn()
    const service = new ReviewedActionService(store, { authorize, execute, now: () => now })
    const preview = await service.prepare(principal, 'updateOpportunity', { opportunityId: 'opp' })
    const approval = { contractVersion: collaborationVersion, id: preview.id, digest: preview.digest, reason: 'Reviewed' }
    await expect(service.commit(principal, { ...approval, input: { opportunityId: 'different' } })).rejects.toThrow()
    authorize.mockResolvedValue({ value: 2 })
    await expect(service.commit(principal, approval)).rejects.toThrow(/changed|refresh/i)
    authorize.mockRejectedValue(new Error('Source permission revoked'))
    await expect(service.commit(principal, approval)).rejects.toThrow(/permission/i)
    now += 300_001
    await expect(service.commit(principal, approval)).rejects.toThrow(/expired/i)
    expect(execute).not.toHaveBeenCalled()
  })
  it('retains an unknown outcome after a lost response and never repeats the write', async () => {
    const [store] = await storePair()
    const execute = vi.fn().mockRejectedValue(new Error('Lost response after dispatch'))
    const service = new ReviewedActionService(store, { authorize: async () => ({}), execute })
    const preview = await service.prepare(principal, 'createMilestoneActivity', { opportunityId: 'opp' })
    const approval = { contractVersion: collaborationVersion, id: preview.id, digest: preview.digest, reason: 'Reviewed' }
    expect(await service.commit(principal, approval)).toMatchObject({ state: 'effect-unknown' })
    expect(await service.commit(principal, approval)).toMatchObject({ state: 'effect-unknown' })
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('denies writes without an FTE writer role before creating intent or calling the source', async () => {
    const [store] = await storePair()
    const execute = vi.fn()
    const authorize = vi.fn()
    const service = new ReviewedActionService(store, { authorize, execute })
    await expect(service.prepare({ ...principal, roles: ['TLC.Teams.User'] }, 'updateOpportunity', {})).rejects.toThrow(/authorized/i)
    expect(authorize).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
  it('never reports a legacy best-effort rollback as a confirmed business outcome', async () => {
    const [store] = await storePair()
    const service = new ReviewedActionService(store, { authorize: async () => ({}), execute: async () => ({ state: 'rolled-back', auditNote: 'Best effort' }) })
    const preview = await service.prepare(principal, 'applyMeetingChangeSet', {})
    expect(await service.commit(principal, { contractVersion: collaborationVersion, id: preview.id, digest: preview.digest, reason: 'Reviewed' }))
      .toMatchObject({ state: 'effect-unknown' })
  })
  it('rechecks native source access before returning a saved receipt', async () => {
    const [store] = await storePair()
    const authorize = vi.fn().mockResolvedValue({})
    const service = new ReviewedActionService(store, { authorize, execute: async () => ({ privateValue: 'authorized-once' }) })
    const preview = await service.prepare(principal, 'updateOpportunity', {})
    const approval = { contractVersion: collaborationVersion, id: preview.id, digest: preview.digest, reason: 'Reviewed' }
    await service.commit(principal, approval)
    authorize.mockRejectedValue(new Error('Native source permission revoked'))
    await expect(service.commit(principal, approval)).rejects.toThrow(/permission revoked/i)
  })
})
