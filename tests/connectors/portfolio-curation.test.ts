import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FixtureMsxConnector,
  LiveMsxConnector
} from '../../packages/connectors/msx/index.js'
import {
  JsonFilePortfolioPreferenceStore,
  MemoryPortfolioPreferenceStore
} from '../../packages/connectors/common/index.js'
import { LocalStore, LocalStoreMsxConnector } from '../../packages/connectors/local-store/index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('portfolio account curation', () => {
  it('searches and persists a live customer without any existing team memberships', async () => {
    const accountId = '00000000-0000-4000-8000-000000000abc'
    const opportunityId = '00000000-0000-4000-8000-000000000def'
    const store = new MemoryPortfolioPreferenceStore()
    const requests: URL[] = []
    const request = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input))
      requests.push(url)
      expect(init?.method ?? 'GET').toBe('GET')
      let body: unknown
      if (url.pathname.endsWith('/WhoAmI')) body = { UserId: 'user-with-no-memberships' }
      else if (url.pathname.endsWith('/msp_dealteams')) body = { value: [] }
      else if (url.pathname.endsWith('/accounts')) body = {
        value: url.searchParams.get('$filter') === "statecode eq 0 and name eq 'Northwind'"
          ? []
          : [{ accountid: accountId, name: 'Northwind Health' }]
      }
      else if (url.pathname.endsWith('/opportunities')) {
        expect(url.searchParams.get('$filter')).toContain(`_parentaccountid_value eq ${accountId}`)
        body = { value: [{ opportunityid: opportunityId, _parentaccountid_value: accountId, name: 'Clinical data platform modernization' }] }
      } else throw new Error(`Unexpected request: ${url}`)
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    }
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'test-token' }, request, undefined, undefined, {}, store)

    await expect(connector.listAccounts()).resolves.toEqual([])
    await expect(connector.searchAccounts({ query: 'Northwind', matchBy: 'name' })).resolves.toEqual([
      expect.objectContaining({ id: accountId, state: 'not-added' })
    ])
    const search = requests.find((url) => url.searchParams.get('$filter')?.includes('contains(name,'))
    expect(search?.searchParams.get('$filter')).toBe("statecode eq 0 and contains(name,'Northwind')")
    await expect(connector.addAccount(accountId)).resolves.toEqual(expect.objectContaining({
      id: accountId, provenance: 'manual', visibility: 'visible'
    }))
    await expect(connector.listOpportunities(accountId)).resolves.toEqual([])

    const reloaded = new LiveMsxConnector({ getAccessToken: async () => 'test-token' }, request, undefined, undefined, {}, store)
    await expect(reloaded.listAccounts()).resolves.toEqual([
      expect.objectContaining({ id: accountId, provenance: 'manual', visibility: 'visible' })
    ])
    await expect(reloaded.discoverOpportunities('data')).resolves.toEqual([
      expect.objectContaining({ id: opportunityId, accountId, accountName: 'Northwind Health', onDealTeam: false })
    ])
    await expect(reloaded.listOpportunities(accountId)).resolves.toEqual([])

    await reloaded.setAccountVisibility(accountId, 'hidden')
    const removedReload = new LiveMsxConnector({ getAccessToken: async () => 'test-token' }, request, undefined, undefined, {}, store)
    await expect(removedReload.listAccounts()).resolves.toEqual([])
    await expect(removedReload.discoverOpportunities('data')).resolves.toEqual([])
    await expect(removedReload.searchAccounts({ query: 'Northwind', matchBy: 'name' })).resolves.toEqual([
      expect.objectContaining({ id: accountId, state: 'hidden' })
    ])
    await removedReload.setAccountVisibility(accountId, 'visible')
    await expect(removedReload.listAccounts()).resolves.toEqual([
      expect.objectContaining({ id: accountId, provenance: 'manual', visibility: 'visible' })
    ])
    await expect(removedReload.listOpportunities(accountId)).resolves.toEqual([])
  })

  it('keeps a manually added account as an empty tree node until Deal Team membership changes', async () => {
    const connector = new FixtureMsxConnector()

    expect((await connector.listAccounts()).map((account) => account.id)).toEqual([
      'account-contoso',
      'account-fabrikam',
      'account-zava',
      'account-adventureworks',
      'account-fourth-coffee',
      'account-tailspin-toys',
      'account-wide-world-importers',
      'account-woodgrove-bank'
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

  it('persists SQLite removal across reopen without deleting the account or its memberships', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-removal-store-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'portfolio.sqlite')
    let store = new LocalStore({ path })
    try {
      const connector = new LocalStoreMsxConnector(store)
      const before = await connector.listOpportunities('account-contoso')
      const dealTeams = store.get('SELECT COUNT(*) AS count FROM opportunity_dealteam')?.['count']
      const milestoneTeams = store.get('SELECT COUNT(*) AS count FROM milestone_team_member')?.['count']
      await connector.setAccountVisibility('account-contoso', 'hidden')
      store.close()
      store = new LocalStore({ path })
      const reloaded = new LocalStoreMsxConnector(store)
      expect((await reloaded.listAccounts()).some((account) => account.id === 'account-contoso')).toBe(false)
      await expect(reloaded.listOpportunities('account-contoso')).resolves.toEqual([])
      expect(store.get('SELECT name FROM account WHERE id = ?', 'account-contoso')?.['name']).toBe('Contoso Energy')
      expect(store.get('SELECT COUNT(*) AS count FROM opportunity_dealteam')?.['count']).toBe(dealTeams)
      expect(store.get('SELECT COUNT(*) AS count FROM milestone_team_member')?.['count']).toBe(milestoneTeams)
      await reloaded.setAccountVisibility('account-contoso', 'visible')
      await expect(reloaded.listOpportunities('account-contoso')).resolves.toEqual(before)
    } finally {
      store.close()
    }
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
