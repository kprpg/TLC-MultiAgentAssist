import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../../packages/connectors/msx/index.js'

const accountId = '00000000-0000-4000-8000-000000000123'
const account = { accountid: accountId, name: 'Northwind Health', msp_mstopparentid: '001234' }

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function setup(options: { metadata?: unknown; metadataStatus?: number; field?: string } = {}) {
  const request = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.includes('EntityDefinitions(')) {
      return json(options.metadata ?? {
        LogicalName: options.field ?? 'msp_mstopparentid',
        AttributeType: 'String',
        IsValidForRead: true
      }, options.metadataStatus ?? 200)
    }
    if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'test-user' })
    if (url.pathname.endsWith('/accounts')) return json({ value: [account] })
    if (url.pathname.endsWith('/msp_dealteams') || url.pathname.endsWith('/teamtemplates')) return json({ value: [] })
    throw new Error('Unexpected account-discovery test request.')
  })
  const connector = new LiveMsxConnector(
    { getAccessToken: async () => 'test-token' }, request, undefined, undefined,
    options.field ? { accountTpidField: options.field } : {}
  )
  return { connector, request }
}

describe('MSX Account Discovery metadata', () => {
  it('verifies the known TPID field when no environment override is configured', async () => {
    const { connector, request } = setup()
    const candidates = await connector.searchAccounts({ query: '001234', matchBy: 'tpid' })
    expect(candidates).toEqual([expect.objectContaining({ id: accountId, tpid: '001234', state: 'not-added' })])
    const urls = request.mock.calls.map(([input]) => new URL(String(input)))
    expect(urls.some((url) => url.pathname.includes("Attributes(LogicalName='msp_mstopparentid')"))).toBe(true)
    expect(urls.find((url) => url.pathname.endsWith('/accounts'))?.searchParams.get('$filter'))
      .toBe("statecode eq 0 and msp_mstopparentid eq '001234'")
  })

  it('verifies an explicit tenant field rather than silently using another field', async () => {
    const { connector, request } = setup({ field: 'test_tpid' })
    await connector.searchAccounts({ query: '001234', matchBy: 'tpid' })
    const urls = request.mock.calls.map(([input]) => new URL(String(input)))
    expect(urls.some((url) => url.pathname.includes("Attributes(LogicalName='test_tpid')"))).toBe(true)
    expect(urls.find((url) => url.pathname.endsWith('/accounts'))?.searchParams.get('$filter'))
      .toBe("statecode eq 0 and test_tpid eq '001234'")
  })

  it.each([
    { LogicalName: 'msp_mstopparentid', AttributeType: 'Integer', IsValidForRead: true },
    { LogicalName: 'msp_mstopparentid', AttributeType: 'String', IsValidForRead: false },
    { LogicalName: 'different_field', AttributeType: 'String', IsValidForRead: true }
  ])('rejects unverified or incompatible TPID metadata %#', async (metadata) => {
    const { connector, request } = setup({ metadata })
    await expect(connector.searchAccounts({ query: '001234', matchBy: 'tpid' })).rejects.toThrow(/TPID.*readable String/i)
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith('/accounts'))).toBe(false)
  })

  it('preserves an authorization error instead of returning no matches', async () => {
    const { connector } = setup({ metadataStatus: 403 })
    await expect(connector.searchAccounts({ query: '001234', matchBy: 'tpid' })).rejects.toMatchObject({ status: 403 })
  })

  it('explains how to configure a missing TPID field', async () => {
    const { connector } = setup({ metadataStatus: 404 })
    await expect(connector.searchAccounts({ query: '001234', matchBy: 'tpid' }))
      .rejects.toThrow(/TLC_MSX_ACCOUNT_TPID_FIELD/)
  })

  it('caches verified metadata within the connector', async () => {
    const { connector, request } = setup()
    await connector.searchAccounts({ query: '001234', matchBy: 'tpid' })
    await connector.searchAccounts({ query: '001234', matchBy: 'tpid' })
    expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname.includes('EntityDefinitions('))).toHaveLength(1)
  })

  it('keeps name lookup available without requesting TPID metadata', async () => {
    const { connector, request } = setup({ metadataStatus: 403 })
    await expect(connector.searchAccounts({ query: 'Northwind', matchBy: 'name' })).resolves.toHaveLength(1)
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname.includes('EntityDefinitions('))).toBe(false)
  })
})

function nameSearch(options: {
  exact?: typeof account[]
  partial?: typeof account[]
  indexedIds?: string[]
  readback?: Array<typeof account & { statecode: number }>
  searchStatus?: string
  indexStatus?: number
  malformedIndex?: boolean
  nextLink?: string
} = {}) {
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.endsWith('/searchstatus()')) {
      return json({ response: JSON.stringify({ value: {
        status: options.searchStatus ?? 'provisioned',
        entitystatusresults: [{
          entitylogicalname: 'account', entitystatus: 'EntitySyncComplete',
          searchableindexedfieldinfomap: { name: { indexfieldname: 'name' } }
        }]
      } }) })
    }
    if (url.pathname.endsWith('/searchquery')) {
      expect(init?.method).toBe('POST')
      return json(options.malformedIndex ? { response: '{}' } : {
        response: JSON.stringify({ Error: null, Value: (options.indexedIds ?? []).map((id) => ({ Id: id, EntityName: 'account' })) })
      }, options.indexStatus ?? 200)
    }
    if (url.pathname.endsWith('/accounts')) {
      const filter = url.searchParams.get('$filter') ?? ''
      if (filter.includes('contains(name,')) return json({
        value: options.partial ?? [],
        ...(options.nextLink ? { '@odata.nextLink': options.nextLink } : {})
      })
      if (filter.includes('name eq ')) return json({ value: options.exact ?? [] })
      return json({ value: (options.readback ?? [{ ...account, statecode: 0 }]).filter((row) => filter.includes(row.accountid)) })
    }
    if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'test-user' })
    if (url.pathname.endsWith('/msp_dealteams') || url.pathname.endsWith('/teamtemplates')) return json({ value: [] })
    throw new Error('Unexpected name-search test request.')
  })
  return { connector: new LiveMsxConnector({ getAccessToken: async () => 'test-token' }, request), request }
}

describe('MSX bounded name and typo lookup', () => {
  it('uses an exact-name fast path without invoking indexed search', async () => {
    const { connector, request } = nameSearch({ exact: [account] })
    await expect(connector.searchAccounts({ query: account.name, matchBy: 'name' })).resolves.toHaveLength(1)
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname.includes('searchquery'))).toBe(false)
    const queries = request.mock.calls.map(([input]) => new URL(String(input)).searchParams.get('$filter') ?? '')
    expect(queries).toContain("statecode eq 0 and name eq 'Northwind Health'")
    expect(queries.some((filter) => filter.includes('contains(name,'))).toBe(false)
  })

  it('tries substring matching before requiring indexed-search capability', async () => {
    const { connector, request } = nameSearch({ partial: [account], searchStatus: 'notprovisioned' })
    await expect(connector.searchAccounts({ query: 'Northwind', matchBy: 'name' })).resolves.toHaveLength(1)
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname.includes('searchstatus'))).toBe(false)
  })

  it('rehydrates fuzzy hits through delegated active-account reads and deduplicates GUIDs', async () => {
    const { connector, request } = nameSearch({ indexedIds: [accountId, accountId] })
    await expect(connector.searchAccounts({ query: 'Nortwind Helth', matchBy: 'name' }))
      .resolves.toEqual([expect.objectContaining({ id: accountId, name: account.name })])
    const search = request.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith('/searchquery'))
    const body = JSON.parse(String(search?.[1]?.body))
    expect(body.search).toBe('nortwind~1 helth~1')
    expect(JSON.parse(body.options)).toMatchObject({ querytype: 'lucene', searchmode: 'all', besteffortsearchenabled: 'false' })
    expect(JSON.parse(body.entities)).toEqual([{ name: 'account', selectcolumns: ['name'], searchcolumns: ['name'], filter: 'statecode eq 0' }])
    expect(body.top).toBe(25)
  })

  it('does not initialize the user Portfolio for an empty lookup', async () => {
    const { connector, request } = nameSearch()
    await expect(connector.searchAccounts({ query: 'NoSuchSampleCustomer', matchBy: 'name' })).resolves.toEqual([])
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith('/WhoAmI'))).toBe(false)
  })

  it('does not expose inactive or inaccessible indexed records as candidates', async () => {
    const { connector } = nameSearch({ indexedIds: [accountId], readback: [{ ...account, statecode: 1 }] })
    await expect(connector.searchAccounts({ query: 'Nortwind Helth', matchBy: 'name' })).resolves.toEqual([])
  })

  it('surfaces unavailable typo search instead of claiming that no accounts exist', async () => {
    const { connector } = nameSearch({ searchStatus: 'notprovisioned' })
    await expect(connector.searchAccounts({ query: 'Nortwind Helth', matchBy: 'name' })).rejects.toThrow(/close-name search.*unavailable/i)
  })

  it('preserves indexed-search authorization errors', async () => {
    const { connector } = nameSearch({ indexStatus: 403 })
    await expect(connector.searchAccounts({ query: 'Nortwind Helth', matchBy: 'name' })).rejects.toMatchObject({ status: 403 })
  })

  it('rejects malformed indexed responses rather than returning an empty result', async () => {
    const { connector } = nameSearch({ malformedIndex: true })
    await expect(connector.searchAccounts({ query: 'Nortwind Helth', matchBy: 'name' })).rejects.toThrow(/search.*response/i)
  })

  it('escapes apostrophes and does not forward caller Lucene operators', async () => {
    const { connector, request } = nameSearch()
    await connector.searchAccounts({ query: "Northwind's OR *", matchBy: 'name' })
    const urls = request.mock.calls.map(([input]) => new URL(String(input)))
    expect(urls.some((url) => url.searchParams.get('$filter') === "statecode eq 0 and name eq 'Northwind''s OR *'")).toBe(true)
    const search = request.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith('/searchquery'))
    expect(JSON.parse(String(search?.[1]?.body)).search).toBe('northwind~1 or')
  })

  it('does not repeatedly reload remote team membership when curating selected accounts', async () => {
    const { connector, request } = nameSearch({ exact: [account] })
    await connector.searchAccounts({ query: account.name, matchBy: 'name' })
    await connector.addAccount(accountId)
    await connector.addAccount(accountId)
    expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/msp_dealteams'))).toHaveLength(1)
    await expect(connector.listAccounts()).resolves.toEqual([expect.objectContaining({ id: accountId, provenance: 'manual' })])
  })

  it('enforces the candidate cap without following additional pages', async () => {
    const rows = Array.from({ length: 26 }, (_, index) => ({
      ...account, accountid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    }))
    const { connector, request } = nameSearch({ partial: rows, nextLink: 'https://example.test/extra-page' })
    await expect(connector.searchAccounts({ query: 'Northwind', matchBy: 'name' })).resolves.toHaveLength(25)
    expect(request.mock.calls.some(([input]) => new URL(String(input)).origin === 'https://example.test')).toBe(false)
  })

  it('rejects an untrusted continuation before requesting it', async () => {
    const { connector, request } = nameSearch({ partial: [account], nextLink: 'https://example.test/extra-page' })
    await expect(connector.searchAccounts({ query: 'Northwind', matchBy: 'name' })).rejects.toThrow(/untrusted/)
    expect(request.mock.calls.some(([input]) => new URL(String(input)).origin === 'https://example.test')).toBe(false)
  })

  it('rejects indexed non-GUIDs before using them in a read-back query', async () => {
    const { connector } = nameSearch({ indexedIds: ['not-an-account-guid'] })
    await expect(connector.searchAccounts({ query: 'Nortwind Helth', matchBy: 'name' })).rejects.toThrow(/search.*response/i)
  })

  it('keeps concurrently curated accounts in the cached Portfolio', async () => {
    const second = { ...account, accountid: '00000000-0000-4000-8000-000000000124', name: 'Northwind Research' }
    const { connector, request } = nameSearch({
      indexedIds: [accountId, second.accountid],
      readback: [{ ...account, statecode: 0 }, { ...second, statecode: 0 }]
    })
    await connector.searchAccounts({ query: 'Nortwind', matchBy: 'name' })
    await Promise.all([connector.addAccount(accountId), connector.addAccount(second.accountid)])
    expect((await connector.listAccounts()).map((item) => item.id).sort()).toEqual([accountId, second.accountid])
    expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/msp_dealteams'))).toHaveLength(1)
  })
})
