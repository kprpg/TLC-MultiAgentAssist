import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FixtureMsxConnector
} from '../../packages/connectors/msx/index.js'
import {
  JsonFilePortfolioPreferenceStore,
  MemoryPortfolioPreferenceStore
} from '../../packages/connectors/common/index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('portfolio account curation', () => {
  it('keeps a manually added account as an empty tree node until Deal Team membership changes', async () => {
    const connector = new FixtureMsxConnector()

    expect((await connector.listAccounts()).map((account) => account.id)).toEqual([
      'account-contoso',
      'account-fabrikam',
      'account-zava',
      'account-adventureworks'
    ])

    const candidates = await connector.searchAccounts({ matchBy: 'name', query: 'Northwind' })
    expect(candidates).toEqual([
      expect.objectContaining({ id: 'account-northwind', state: 'not-added', tpid: '1000003' })
    ])

    const added = await connector.addAccount('account-northwind')
    expect(added).toEqual(expect.objectContaining({
      id: 'account-northwind',
      provenance: 'manual',
      visibility: 'visible'
    }))
    await expect(connector.listOpportunities('account-northwind')).resolves.toEqual([])
    await expect(connector.discoverOpportunities('data')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'opp-discover-northwind-data', onDealTeam: false })
    ]))

    await expect(connector.joinDealTeam('opp-discover-northwind-data')).resolves.toEqual({
      opportunityId: 'opp-discover-northwind-data',
      onDealTeam: true,
      alreadyMember: false
    })
    await expect(connector.listOpportunities('account-northwind')).resolves.toEqual([
      expect.objectContaining({ id: 'opp-discover-northwind-data' })
    ])

    await expect(connector.leaveDealTeam('opp-discover-northwind-data')).resolves.toEqual({
      opportunityId: 'opp-discover-northwind-data',
      onDealTeam: false,
      alreadyAbsent: false
    })
    await expect(connector.listOpportunities('account-northwind')).resolves.toEqual([])
    expect((await connector.listAccounts()).map((account) => account.id)).toContain('account-northwind')
  })

  it('hides and restores accounts without changing Deal Team membership', async () => {
    const connector = new FixtureMsxConnector()
    const before = await connector.listOpportunities('account-contoso')

    await connector.setAccountVisibility('account-contoso', 'hidden')
    expect((await connector.listAccounts()).map((account) => account.id)).not.toContain('account-contoso')
    expect(await connector.listAccounts({ includeHidden: true })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'account-contoso', visibility: 'hidden' })
    ]))
    await expect(connector.listOpportunities('account-contoso')).resolves.toEqual([])

    await connector.setAccountVisibility('account-contoso', 'visible')
    expect((await connector.listAccounts()).map((account) => account.id)).toContain('account-contoso')
    await expect(connector.listOpportunities('account-contoso')).resolves.toEqual(before)
  })
})

describe('portfolio preference stores', () => {
  it('keeps memory mutations idempotent', async () => {
    const store = new MemoryPortfolioPreferenceStore()

    expect((await store.addAccount('user', 'account')).revision).toBe(1)
    expect((await store.addAccount('user', 'account')).revision).toBe(1)
    expect((await store.setVisibility('user', 'account', 'hidden')).revision).toBe(2)
    expect((await store.setVisibility('user', 'account', 'hidden')).revision).toBe(2)
    expect((await store.setVisibility('user', 'account', 'visible')).revision).toBe(3)
  })

  it('persists user-partitioned preferences to a JSON file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-portfolio-preferences-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'preferences.json')
    const first = new JsonFilePortfolioPreferenceStore(filePath)

    await first.addAccount('user-a', 'account-a')
    await first.setVisibility('user-a', 'account-a', 'hidden')
    await first.addAccount('user-b', 'account-b')

    const second = new JsonFilePortfolioPreferenceStore(filePath)
    await expect(second.read('user-a')).resolves.toEqual({
      manualAccountIds: ['account-a'],
      hiddenAccountIds: ['account-a'],
      revision: 2
    })
    await expect(second.read('user-b')).resolves.toEqual({
      manualAccountIds: ['account-b'],
      hiddenAccountIds: [],
      revision: 1
    })
  })
})
