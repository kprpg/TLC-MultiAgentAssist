import { AzureCliCredential } from '@azure/identity'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { accountCandidateSchema } from '../../packages/common/index.js'
import { JsonFilePortfolioPreferenceStore } from '../../packages/connectors/common/index.js'
import { LiveMsxConnector, type MsxAccessTokenProvider } from '../../packages/connectors/msx/index.js'

const msxOrigin = 'https://microsoftsales.crm.dynamics.com'
const apiPath = '/api/data/v9.2/'
const tpidField = 'msp_mstopparentid'
const caseDefinitions = [
  { id: 'positive-name-01', matchBy: 'name', expected: 'found' },
  { id: 'positive-name-02', matchBy: 'name', expected: 'found' },
  { id: 'positive-name-03', matchBy: 'name', expected: 'found' },
  { id: 'positive-tpid-01', matchBy: 'tpid', expected: 'found' },
  { id: 'positive-tpid-02', matchBy: 'tpid', expected: 'found' },
  { id: 'negative-name-01', matchBy: 'name', expected: 'not-found' },
  { id: 'negative-name-02', matchBy: 'name', expected: 'not-found' },
  { id: 'negative-tpid-01', matchBy: 'tpid', expected: 'not-found' },
  { id: 'negative-tpid-02', matchBy: 'tpid', expected: 'not-found' }
] as const
const privateCasesSchema = z.object({
  version: z.literal(1),
  typoQuery: z.string().trim().min(2).max(120),
  queries: z.record(
    z.enum(caseDefinitions.map((item) => item.id)),
    z.string().trim().min(1).max(120)
  )
}).strict()
const accountReadbackSchema = z.object({
  accountid: z.guid(),
  name: z.string().min(1),
  statecode: z.literal(0),
  msp_mstopparentid: z.string().nullable()
})

function assertReadOnlyMsxRequest(input: Parameters<typeof fetch>[0], init?: RequestInit): void {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (url.origin !== msxOrigin || url.username || url.password || !url.pathname.startsWith(apiPath)) {
    throw new Error('Account Discovery tests only permit the trusted MSX API.')
  }
  if (method !== 'GET' && !(method === 'POST' && url.pathname === `${apiPath}searchquery`)) {
    throw new Error('Account Discovery tests forbid MSX record and membership writes.')
  }
}

describe('Account Discovery live-test safety', () => {
  it('accepts legacy Dataverse GUIDs without imposing RFC UUID version bits', () => {
    expect(z.guid().safeParse('00000000-0000-0000-0000-000000000321').success).toBe(true)
  })

  it.each([
    ['POST', 'accounts'],
    ['PATCH', 'accounts(test-account)'],
    ['DELETE', 'msp_dealteams(test-membership)'],
    ['POST', 'AddUserToRecordTeam'],
    ['POST', 'RemoveUserFromRecordTeam']
  ])('blocks %s %s before any request is sent', (method, path) => {
    expect(() => assertReadOnlyMsxRequest(`${msxOrigin}${apiPath}${path}`, { method })).toThrow(/forbid/)
  })

  it('checks the method carried by a Request object', () => {
    const request = new Request(`${msxOrigin}${apiPath}accounts(test-account)`, { method: 'DELETE' })
    expect(() => assertReadOnlyMsxRequest(request)).toThrow(/forbid/)
  })

  it.each([
    'https://example.test/api/data/v9.2/accounts',
    'http://microsoftsales.crm.dynamics.com/api/data/v9.2/accounts',
    'https://test-user:test-password@microsoftsales.crm.dynamics.com/api/data/v9.2/accounts',
    'https://microsoftsales.crm.dynamics.com/unapproved-api/accounts'
  ])('rejects an untrusted or credential-bearing URL %#', (url) => {
    expect(() => assertReadOnlyMsxRequest(url)).toThrow(/trusted MSX API/)
  })

  it('allows ordinary reads and only the documented read-only search action', () => {
    expect(() => assertReadOnlyMsxRequest(`${msxOrigin}${apiPath}accounts`)).not.toThrow()
    expect(() => assertReadOnlyMsxRequest(`${msxOrigin}${apiPath}searchquery`, { method: 'POST' })).not.toThrow()
  })
})

describe.skipIf(process.env['TLC_RUN_LIVE_SMOKE'] !== '1')('Account Discovery live acceptance', () => {
  let setup: {
    root: string
    queries: z.infer<typeof privateCasesSchema>['queries']
    typoQuery: string
    tokenProvider: MsxAccessTokenProvider
    request: typeof fetch
  } | undefined

  beforeAll(async () => {
    const casesPath = resolve(process.env['TLC_ACCOUNT_DISCOVERY_CASES_PATH']?.trim() || 'config/account-discovery.cases.local.json')
    const parsed = privateCasesSchema.safeParse(JSON.parse(await readFile(casesPath, 'utf8')))
    if (!parsed.success) {
      throw new Error('Private Account Discovery cases must supply version 1, a typoQuery, and all nine named string queries.')
    }
    const credential = new AzureCliCredential({ processTimeoutInMs: 30_000 })
    const tokenProvider: MsxAccessTokenProvider = {
      getAccessToken: async () => (await credential.getToken(`${msxOrigin}/.default`)).token
    }
    const request: typeof fetch = async (input, init) => {
      assertReadOnlyMsxRequest(input, init)
      const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(init?.signal ? [init.signal] : [])])
      return fetch(input, { ...init, redirect: 'error', signal })
    }
    const metadataUrl = new URL(`${apiPath}EntityDefinitions(LogicalName='account')/Attributes(LogicalName='${tpidField}')`, msxOrigin)
    metadataUrl.searchParams.set('$select', 'LogicalName,AttributeType,IsValidForRead')
    const metadataResponse = await request(metadataUrl, {
      headers: { Authorization: `Bearer ${await tokenProvider.getAccessToken()}`, Accept: 'application/json' }
    })
    if (!metadataResponse.ok) {
      throw new Error(`MSX TPID metadata verification failed with HTTP ${metadataResponse.status}.`)
    }
    const metadata = z.object({
      LogicalName: z.literal(tpidField),
      AttributeType: z.literal('String'),
      IsValidForRead: z.literal(true)
    }).safeParse(await metadataResponse.json())
    if (!metadata.success) throw new Error('The MSX TPID field is not the verified readable String attribute.')
    setup = {
      root: await mkdtemp(join(tmpdir(), 'tlc-account-discovery-')),
      queries: parsed.data.queries,
      typoQuery: parsed.data.typoQuery,
      tokenProvider,
      request
    }
  }, 60_000)

  afterAll(async () => {
    if (setup) await rm(setup.root, { recursive: true, force: true })
  })

  it.each(caseDefinitions)('$id: $matchBy lookup is $expected and only test Portfolio state may change', async ({ id, matchBy, expected }) => {
    if (!setup) throw new Error('Account Discovery live-test setup did not complete.')
    const { root, queries, tokenProvider, request: baseRequest } = setup
    const signal = AbortSignal.timeout(150_000)
    const request: typeof fetch = (input, init) => baseRequest(input, { ...init, signal })
    const query = queries[id]
    const preferencePath = join(root, id, 'portfolio-preferences.json')
    const preferences = new JsonFilePortfolioPreferenceStore(preferencePath)
    const connector = new LiveMsxConnector(tokenProvider, request, undefined, undefined, {}, preferences)
    const userId = await connector.getCurrentUserId()
    const candidates = await connector.searchAccounts({ query, matchBy })

    expect(accountCandidateSchema.array().safeParse(candidates).success, `${id}: invalid candidate contract`).toBe(true)
    expect(candidates.every((item) => z.guid().safeParse(item.id).success), `${id}: invalid account GUID`).toBe(true)
    expect(new Set(candidates.map((item) => item.id)).size, `${id}: duplicate candidate GUIDs`).toBe(candidates.length)
    expect(candidates.length, `${id}: candidate limit exceeded`).toBeLessThanOrEqual(25)
    expect((await preferences.read(userId)).manualAccountIds.length, `${id}: search changed preferences`).toBe(0)
    expect(existsSync(preferencePath), `${id}: search wrote a preference file`).toBe(false)

    if (expected === 'not-found') {
      expect(candidates.length, `${id}: a negative input returned accounts`).toBe(0)
      return
    }

    expect(candidates.length, `${id}: an expected positive lookup returned no accounts`).toBeGreaterThan(0)
    if (matchBy === 'tpid') {
      expect(candidates.every((item) => item.tpid === query), `${id}: TPID lookup returned a non-exact match`).toBe(true)
    } else {
      expect(candidates.some((item) => item.name.toLowerCase().includes(query.toLowerCase())), `${id}: the intended name is missing`).toBe(true)
    }
    for (const candidate of candidates) {
      const readbackUrl = new URL(`${apiPath}accounts(${candidate.id})`, msxOrigin)
      readbackUrl.searchParams.set('$select', `accountid,name,statecode,${tpidField}`)
      const readbackResponse = await request(readbackUrl, {
        headers: { Authorization: `Bearer ${await tokenProvider.getAccessToken()}`, Accept: 'application/json' }
      })
      expect(readbackResponse.status, `${id}: selected account read-back failed`).toBe(200)
      const readback = accountReadbackSchema.safeParse(await readbackResponse.json())
      expect(readback.success, `${id}: selected account is not active/readable`).toBe(true)
      if (!readback.success) throw new Error(`${id}: account read-back did not match its contract.`)
      expect(readback.data.accountid.toLowerCase() === candidate.id.toLowerCase(), `${id}: selected GUID changed`).toBe(true)
      expect(readback.data.name === candidate.name, `${id}: canonical name changed`).toBe(true)
      if (matchBy === 'tpid') {
        expect(readback.data.msp_mstopparentid === query, `${id}: selected TPID changed`).toBe(true)
      }

      // Exercise every returned candidate in disposable state, never select one for the user.
      const added = await connector.addAccount(candidate.id)
      expect(added.id === candidate.id, `${id}: a different account was added`).toBe(true)
      expect(added.visibility, `${id}: added account is not visible`).toBe('visible')
      expect(added.provenance === 'manual' || added.provenance === 'both', `${id}: manual provenance is missing`).toBe(true)
    }

    const saved = await preferences.read(userId)
    expect(saved.manualAccountIds.length, `${id}: not every selected account was persisted`).toBe(candidates.length)
    expect(candidates.every((item) => saved.manualAccountIds.includes(item.id)), `${id}: saved account references differ`).toBe(true)
    const repeated = candidates[0]
    if (!repeated) throw new Error(`${id}: no previously selected account is available for the replay check.`)
    await connector.addAccount(repeated.id)
    expect((await preferences.read(userId)).revision, `${id}: adding the same account was not idempotent`).toBe(saved.revision)

    const reopenedPreferences = new JsonFilePortfolioPreferenceStore(preferencePath)
    const reopened = new LiveMsxConnector(tokenProvider, request, undefined, undefined, {}, reopenedPreferences)
    const visibleIds = new Set((await reopened.listAccounts()).filter((item) => item.visibility === 'visible').map((item) => item.id))
    expect(candidates.every((item) => visibleIds.has(item.id)), `${id}: saved accounts did not survive reopening`).toBe(true)
    expect((await reopenedPreferences.read('isolated-test-other-user')).manualAccountIds.length, `${id}: preferences leaked to another user`).toBe(0)
  }, 180_000)

  it('positive-typo-01: the misspelled known name resolves without adding any account', async () => {
    if (!setup) throw new Error('Account Discovery live-test setup did not complete.')
    const { root, queries, typoQuery, tokenProvider, request } = setup
    const preferencePath = join(root, 'positive-typo-01', 'portfolio-preferences.json')
    const connector = new LiveMsxConnector(
      tokenProvider, request, undefined, undefined, {}, new JsonFilePortfolioPreferenceStore(preferencePath)
    )
    const candidates = await connector.searchAccounts({ query: typoQuery, matchBy: 'name' })
    expect(candidates.some((item) => item.name.toLowerCase() === queries['positive-name-01'].toLowerCase()),
      'positive-typo-01: the intended known account was not suggested').toBe(true)
    expect(existsSync(preferencePath), 'positive-typo-01: lookup persisted a preference').toBe(false)
  }, 180_000)
})
