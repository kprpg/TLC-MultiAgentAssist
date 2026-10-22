import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { MutationRuntime, SharedMutationHost, type MutationHostOptions } from '../../../packages/orchestrator/mutations/host.js'
import { MutationJournal } from '../../../packages/orchestrator/mutations/journal.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stores: SqliteDocumentStore[] = []
const roots: string[] = []
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
function setup(path?: string) {
  const store = new SqliteDocumentStore(path); stores.push(store)
  let current = true
  let now = Date.parse('2026-10-21T12:00:00.000Z')
  const execute = vi.fn(async () => ({ opportunityId: 'synthetic', onDealTeam: true, alreadyMember: false }))
  const authorize = vi.fn<MutationHostOptions['authorize']>(async () => ({ before: { membership: false }, revisionTokens: { row: 'W/"1"' }, recordKeys: ['opportunity:synthetic'] }))
  const runtime = new MutationRuntime()
  const options = { store, durable: true, operations: ['joinDealTeam'] as const, runtime,
    actor: { partition: 'tenant:source:sample:actor', assertCurrent: async () => { if (!current) throw new Error('Source session changed.') } },
    validate: (_operation: unknown, input: Record<string, unknown>) => input, authorize, execute, now: () => now }
  const host = new SharedMutationHost(options)
  const prepare = async () => {
    const response = await host.invoke({ contractVersion: '1.0', operation: 'prepare', mutation: 'joinDealTeam', input: { opportunityId: 'synthetic' } })
    if (response.kind !== 'review') throw new Error('Expected review')
    return { contractVersion: '1.0', operation: 'submit', id: response.review.id, digest: response.review.digest, confirmed: true, reason: 'Reviewed exact source action' }
  }
  return { host, options, store, runtime, execute, authorize, prepare,
    expire: () => { now += 300_001 }, switchActor: () => { current = false }, advance: (ms: number) => { now += ms } }
}

describe('trusted immediate background mutations', () => {
  it('fails closed without durable storage and never dispatches before confirmation', async () => {
    const data = setup()
    const disabled = new SharedMutationHost({ ...data.options, durable: false })
    expect(await disabled.invoke({ contractVersion: '1.0', operation: 'capabilities' })).toMatchObject({ kind: 'capabilities', capabilities: { available: false } })
    const input = await data.prepare()
    expect(data.execute).not.toHaveBeenCalled()
    await expect(data.host.invoke({ ...input, confirmed: false })).rejects.toThrow()
    expect(data.execute).not.toHaveBeenCalled()
  })
  it('returns durable admission while the source is pending and dispatches once across instances', async () => {
    const data = setup()
    let release!: (value: { opportunityId: string; onDealTeam: boolean; alreadyMember: boolean }) => void
    data.execute.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const input = await data.prepare()
    const second = new SharedMutationHost({ ...data.options, runtime: new MutationRuntime() })
    const submitted = await Promise.all([data.host.invoke(input), second.invoke(input)])
    expect(submitted.every((value) => value.kind === 'receipt')).toBe(true)
    expect((await new MutationJournal(data.store).read(data.options.actor.partition, input.id)).record.approval?.reason).toBe(input.reason)
    await vi.waitFor(() => expect(data.execute).toHaveBeenCalledOnce())
    expect(await data.host.invoke({ contractVersion: '1.0', operation: 'status', id: input.id })).toMatchObject({ receipt: { state: 'dispatching' } })
    release({ opportunityId: 'synthetic', onDealTeam: true, alreadyMember: false })
    await Promise.all([...data.runtime.jobs.values()])
    expect(await data.host.invoke({ contractVersion: '1.0', operation: 'status', id: input.id })).toMatchObject({ receipt: { state: 'confirmed' } })
    await second.invoke(input)
    expect(data.execute).toHaveBeenCalledOnce()
  })
  it('preserves uncertain effects across restart and never repeats a lost-response POST', async () => {
    const data = setup()
    data.execute.mockRejectedValue(new Error('Response lost after dispatch'))
    const input = await data.prepare()
    await data.host.invoke(input)
    await Promise.all([...data.runtime.jobs.values()])
    const restarted = new SharedMutationHost({ ...data.options, runtime: new MutationRuntime() })
    expect(await restarted.invoke(input)).toMatchObject({ receipt: { state: 'effect-unknown' } })
    expect(data.execute).toHaveBeenCalledOnce()
    expect(await restarted.invoke({ contractVersion: '1.0', operation: 'pending' })).toMatchObject({ receipts: [expect.objectContaining({ state: 'effect-unknown' })] })
  })
  it('rejects changed/expired reviews and another actor before dispatch', async () => {
    const data = setup()
    const input = await data.prepare()
    await expect(data.host.invoke({ ...input, digest: 'b'.repeat(64) })).rejects.toThrow('digest')
    data.authorize.mockResolvedValue({ before: { membership: true }, revisionTokens: { row: 'W/"2"' }, recordKeys: ['opportunity:synthetic'] })
    await expect(data.host.invoke(input)).rejects.toThrow('Source state changed')
    data.expire()
    await expect(data.host.invoke(input)).rejects.toThrow('expired')
    const other = new SharedMutationHost({ ...data.options, actor: { partition: 'different-actor', assertCurrent: async () => {} } })
    await expect(other.invoke(input)).rejects.toThrow('unavailable')
    expect(data.execute).not.toHaveBeenCalled()
  })
  it('passes the originally reviewed native versions and exposes a source conflict without retry', async () => {
    const data = setup()
    data.execute.mockRejectedValue(Object.assign(new Error('Source changed'), { status: 412 }))
    const input = await data.prepare()
    await data.host.invoke(input)
    await Promise.all([...data.runtime.jobs.values()])
    expect(data.execute).toHaveBeenCalledWith('joinDealTeam', { opportunityId: 'synthetic' }, { revisionTokens: { row: 'W/"1"' } })
    expect(await data.host.invoke({ contractVersion: '1.0', operation: 'status', id: input.id })).toMatchObject({ receipt: { state: 'conflict' } })
    expect(data.execute).toHaveBeenCalledOnce()
  })
  it('withholds a transient source result after row access is revoked', async () => {
    const data = setup()
    const input = await data.prepare()
    await data.host.invoke(input)
    await Promise.all([...data.runtime.jobs.values()])
    data.authorize.mockRejectedValue(Object.assign(new Error('Row access revoked'), { status: 403 }))
    const status = await data.host.invoke({ contractVersion: '1.0', operation: 'status', id: input.id })
    expect(status).toMatchObject({ receipt: { state: 'confirmed', code: 'access-denied' } })
    if (status.kind !== 'receipt') throw new Error('Expected private receipt metadata')
    expect(status.receipt.result).toBeUndefined()
    expect(data.execute).toHaveBeenCalledOnce()
  })
  it('marks a hung execution uncertain at the deadline without dispatching it again', async () => {
    const data = setup()
    let release!: (value: { opportunityId: string; onDealTeam: boolean; alreadyMember: boolean }) => void
    data.execute.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const input = await data.prepare()
    await data.host.invoke(input)
    await vi.waitFor(() => expect(data.execute).toHaveBeenCalledOnce())
    data.advance(120_001)
    expect(await data.host.invoke({ contractVersion: '1.0', operation: 'status', id: input.id })).toMatchObject({ receipt: { state: 'effect-unknown' } })
    await data.host.invoke(input)
    expect(data.execute).toHaveBeenCalledOnce()
    release({ opportunityId: 'synthetic', onDealTeam: true, alreadyMember: false })
    await Promise.all([...data.runtime.jobs.values()])
    expect(await data.host.invoke({ contractVersion: '1.0', operation: 'status', id: input.id })).toMatchObject({ receipt: { state: 'confirmed' } })
  })
  it('prunes expired terminal receipts and empty retention metadata but preserves uncertain effects', async () => {
    const data = setup()
    const confirmed = await data.prepare()
    await data.host.invoke(confirmed)
    await Promise.all([...data.runtime.jobs.values()])
    data.advance(1000)
    data.execute.mockRejectedValue(new Error('Lost source acknowledgement'))
    const unknown = await data.prepare()
    await data.host.invoke(unknown)
    await Promise.all([...data.runtime.jobs.values()])
    data.advance(31 * 24 * 60 * 60_000)
    const journal = new MutationJournal(data.store, data.options.now)
    await journal.prune(data.options.actor.partition)
    await expect(journal.read(data.options.actor.partition, confirmed.id)).rejects.toThrow('expired')
    expect((await journal.read(data.options.actor.partition, unknown.id)).record.receipt?.state).toBe('effect-unknown')
    expect(await journal.pending(data.options.actor.partition)).toHaveLength(1)
  })
  it('compacts an expired unsubmitted-review day so the day manifest cannot grow forever', async () => {
    const data = setup()
    const input = await data.prepare()
    data.advance(2 * 24 * 60 * 60_000)
    const journal = new MutationJournal(data.store, data.options.now)
    await journal.prune(data.options.actor.partition)
    expect((await data.store.read(data.options.actor.partition, 'mutation:expiry-days'))?.value).toEqual([])
    expect(await data.store.read(data.options.actor.partition, 'mutation:expiry-count:2026-10-21')).toBeUndefined()
    await expect(journal.read(data.options.actor.partition, input.id)).rejects.toThrow('expired')
  })
  it('claims once across independent SQLite connections, not just two wrappers of one store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tlc-mutation-sync-')); roots.push(root)
    const path = join(root, 'receipts.sqlite')
    const data = setup(path)
    const otherStore = new SqliteDocumentStore(path); stores.push(otherStore)
    const other = new SharedMutationHost({ ...data.options, store: otherStore, runtime: new MutationRuntime() })
    const input = await data.prepare()
    await Promise.all([data.host.invoke(input), other.invoke(input)])
    await vi.waitFor(() => expect(data.execute).toHaveBeenCalledOnce())
    await Promise.all([...data.runtime.jobs.values()])
    expect(await other.invoke(input)).toMatchObject({ receipt: { state: 'confirmed' } })
    expect(data.execute).toHaveBeenCalledOnce()
  })
  it('admits at most two independent writes and gives a definite unsent outcome to a third', async () => {
    const data = setup()
    const releases: Array<() => void> = []
    data.authorize.mockImplementation(async (_operation, input) => ({ before: { membership: false },
      revisionTokens: { row: 'W/"1"' }, recordKeys: [`opportunity:${String(input['opportunityId'])}`] }))
    data.execute.mockImplementation(() => new Promise((resolve) => {
      releases.push(() => resolve({ opportunityId: 'synthetic', onDealTeam: true, alreadyMember: false }))
    }))
    for (const id of ['one', 'two', 'three']) {
      const review = await data.host.invoke({ contractVersion: '1.0', operation: 'prepare', mutation: 'joinDealTeam', input: { opportunityId: id } })
      if (review.kind !== 'review') throw new Error('Missing source review')
      const result = await data.host.invoke({ contractVersion: '1.0', operation: 'submit', id: review.review.id,
        digest: review.review.digest, confirmed: true, reason: 'Confirmed synthetic membership' })
      expect(result).toMatchObject({ receipt: id === 'three' ? { state: 'failed-before-send', code: 'capacity' } : { state: 'accepted' } })
    }
    expect(data.execute).toHaveBeenCalledTimes(2)
    for (const release of releases) release()
    await Promise.all([...data.runtime.jobs.values()])
  })
  it('never dispatches if persisting dispatch intent fails, and retains response-loss uncertainty after a successful source call', async () => {
    const data = setup()
    const original = data.store.replace.bind(data.store)
    const replace = vi.spyOn(data.store, 'replace')
    let failState = 'dispatching'
    replace.mockImplementation(async (partition, key, revision, value) => {
      if (typeof value === 'object' && value !== null && 'receipt' in value
        && typeof value.receipt === 'object' && value.receipt !== null && 'state' in value.receipt && value.receipt.state === failState) {
        failState = ''
        throw new Error('Injected durable state failure')
      }
      return original(partition, key, revision, value)
    })
    const first = await data.prepare()
    await data.host.invoke(first)
    await Promise.all([...data.runtime.jobs.values()])
    expect(data.execute).not.toHaveBeenCalled()
    expect(await data.host.invoke({ contractVersion: '1.0', operation: 'status', id: first.id })).toMatchObject({ receipt: { state: 'failed-before-send' } })
    failState = 'confirmed'
    const second = await data.prepare()
    await data.host.invoke(second)
    await Promise.all([...data.runtime.jobs.values()])
    expect(await data.host.invoke({ contractVersion: '1.0', operation: 'status', id: second.id })).toMatchObject({ receipt: { state: 'effect-unknown' } })
    await data.host.invoke(second)
    expect(data.execute).toHaveBeenCalledOnce()
  })
  it('maintains bounded day metadata beyond the 400-day manifest ceiling', async () => {
    const data = setup()
    for (let day = 0; day < 401; day++) { await data.prepare(); data.advance(24 * 60 * 60_000) }
    await new MutationJournal(data.store, data.options.now).prune(data.options.actor.partition)
    expect((await data.store.read(data.options.actor.partition, 'mutation:expiry-days'))?.value).toEqual([])
    expect(await new MutationJournal(data.store).pending(data.options.actor.partition)).toEqual([])
  })
  it('distinguishes native preflight rejection from a response lost after actual dispatch', async () => {
    const data = setup()
    const execute = vi.fn<MutationHostOptions['execute']>(async () => { throw new Error('Unmapped native field; no request sent') })
    const host = new SharedMutationHost({ ...data.options, tracksDispatch: ['joinDealTeam'], execute })
    const first = await data.prepare()
    await host.invoke(first)
    await Promise.all([...data.runtime.jobs.values()])
    expect(await host.invoke({ contractVersion: '1.0', operation: 'status', id: first.id })).toMatchObject({ receipt: { state: 'failed-before-send' } })
    execute.mockImplementation(async (...args) => { args[2].onDispatch?.(); throw new Error('Source acknowledgement lost') })
    const second = await data.prepare()
    await host.invoke(second)
    await Promise.all([...data.runtime.jobs.values()])
    expect(await host.invoke({ contractVersion: '1.0', operation: 'status', id: second.id })).toMatchObject({ receipt: { state: 'effect-unknown' } })
  })
})
