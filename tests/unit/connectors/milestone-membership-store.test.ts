import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  JsonFileMilestoneMembershipStore,
  MemoryMilestoneMembershipStore,
  type MilestoneMembershipStore
} from '../../../packages/connectors/common/index.js'

function suite(name: string, make: () => MilestoneMembershipStore | Promise<MilestoneMembershipStore>): void {
  describe(name, () => {
    it('adds, lists, and removes memberships idempotently and per-user', async () => {
      const store = await make()
      expect(await store.list('user-a')).toEqual([])

      expect(await store.add('user-a', { milestoneId: 'ms-1', opportunityId: 'opp-1' })).toEqual({ added: true })
      expect(await store.add('user-a', { milestoneId: 'ms-1', opportunityId: 'opp-1' })).toEqual({ added: false })
      await store.add('user-a', { milestoneId: 'ms-2', opportunityId: 'opp-1' })

      expect(await store.list('user-a')).toEqual([
        { milestoneId: 'ms-1', opportunityId: 'opp-1' },
        { milestoneId: 'ms-2', opportunityId: 'opp-1' }
      ])
      // Membership is scoped to the user key.
      expect(await store.list('user-b')).toEqual([])

      expect(await store.remove('user-a', 'ms-1')).toEqual({ removed: true })
      expect(await store.remove('user-a', 'ms-1')).toEqual({ removed: false })
      expect(await store.list('user-a')).toEqual([{ milestoneId: 'ms-2', opportunityId: 'opp-1' }])
    })
  })
}

suite('MemoryMilestoneMembershipStore', () => new MemoryMilestoneMembershipStore())

describe('JsonFileMilestoneMembershipStore', () => {
  let directory: string
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'tlc-ms-team-')) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('persists memberships across store instances', async () => {
    const filePath = join(directory, 'memberships.json')
    const first = new JsonFileMilestoneMembershipStore(filePath)
    await first.add('user-a', { milestoneId: 'ms-1', opportunityId: 'opp-1' })

    const second = new JsonFileMilestoneMembershipStore(filePath)
    expect(await second.list('user-a')).toEqual([{ milestoneId: 'ms-1', opportunityId: 'opp-1' }])
  })

  suite('behaves like the contract', () => new JsonFileMilestoneMembershipStore(join(directory, 'contract.json')))
})
