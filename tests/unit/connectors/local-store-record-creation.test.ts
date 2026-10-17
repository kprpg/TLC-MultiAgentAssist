import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { recordCreationDraftSchema, type RecordCreationDraft } from '../../../packages/common/index.js'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { LocalStoreRecordCreation } from '../../../packages/connectors/local-store/record-creation.js'
import { defaultSeed, SAMPLE_USER_ID } from '../../../packages/connectors/local-store/seed.js'

function fixture(name: string): RecordCreationDraft {
  return recordCreationDraftSchema.parse(JSON.parse(readFileSync(resolve('tests', 'fixtures', 'record-creation', name, 'input.json'), 'utf8')))
}

const single = fixture('single-opportunity-multiple-milestones')
const multiple = fixture('multiple-opportunities-multiple-milestones')

function count(store: LocalStore, table: string): number {
  const allowed = ['opportunity', 'engagement_milestone', 'opportunity_dealteam', 'creation_batch', 'creation_batch_item']
  if (!allowed.includes(table)) throw new Error('Unexpected test table.')
  return Number(store.get(`SELECT COUNT(*) AS total FROM ${table}`)?.['total'])
}

describe('SQLite record creation', () => {
  it('exposes Account-scoped reference data and verified choice labels', async () => {
    const store = new LocalStore()
    try {
      const catalog = await new LocalStoreRecordCreation(store, SAMPLE_USER_ID).getCatalog('account-contoso')
      expect(catalog).toMatchObject({
        target: 'sqlite',
        account: { id: 'account-contoso', label: 'Contoso Energy' },
        defaults: { owner: { id: SAMPLE_USER_ID }, currency: { id: 'currency-usd' } }
      })
      expect(catalog.priceLists).toContainEqual({ id: 'price-list-usd-standard', label: 'USD Standard Price List' })
      expect(catalog.workloads).toContainEqual({ id: 'workload-cloud-scale-analytics', label: 'Cloud Scale Analytics' })
      expect(catalog.choices.intent).toContainEqual({ value: 606820001, label: 'Consumption' })
      expect(catalog.choices.category).toContainEqual({ value: 861980000, label: 'POC/Pilot' })
      expect(catalog.revision.length).toBeGreaterThan(0)
    } finally {
      store.close()
    }
  })

  it.each([
    { title: 'one Opportunity and three child Milestones', draft: single, opportunityCount: 1, milestoneCount: 3, mutationCount: 5 },
    { title: 'three Opportunities and six child Milestones', draft: multiple, opportunityCount: 3, milestoneCount: 6, mutationCount: 12 }
  ])('commits $title with creator Deal Team membership and reread', async ({ draft, opportunityCount, milestoneCount, mutationCount }) => {
    const store = new LocalStore()
    try {
      const writer = new LocalStoreRecordCreation(store, SAMPLE_USER_ID)
      const msx = new LocalStoreMsxConnector(store)
      const result = await writer.commit(draft, `batch-${opportunityCount}`, 'a'.repeat(64))
      expect(result).toMatchObject({ target: 'sqlite', state: 'committed', audit: { opportunityCount, milestoneCount } })
      expect(result.created).toHaveLength(mutationCount)
      expect(result.created.filter((item) => item.kind === 'deal-team')).toHaveLength(opportunityCount)
      expect(result.created.filter((item) => item.kind === 'milestone')).toHaveLength(milestoneCount)
      const createdOpportunities = result.created.filter((item) => item.kind === 'opportunity')
      expect(createdOpportunities).toHaveLength(opportunityCount)
      for (const created of createdOpportunities) {
        const opportunities = await msx.listOpportunities(draft.account.id)
        const record = opportunities.find((item) => item.id === created.recordId)
        expect(record?.name).toBeTruthy()
        const childCount = draft.kind === 'opportunity-batch'
          ? draft.opportunities.find((item) => item.opportunity.clientOpportunityKey === created.clientKey)?.milestones.length
          : 0
        if (childCount === undefined) throw new Error('Created Opportunity does not match the input.')
        expect(await msx.listMilestones(created.recordId!)).toHaveLength(childCount)
      }
    } finally {
      store.close()
    }
  })

  it('adds multiple Milestones to a verified existing Opportunity without copying the parent', async () => {
    const store = new LocalStore()
    try {
      if (single.kind !== 'opportunity-batch') throw new Error('Invalid fixture')
      const writer = new LocalStoreRecordCreation(store, SAMPLE_USER_ID)
      const existing = {
        kind: 'existing-opportunity-milestone-batch' as const,
        account: single.account,
        opportunity: { id: 'opp-grid-modernization', label: 'Grid operations modernization' },
        milestones: single.opportunities[0]!.milestones.slice(0, 2)
      }
      const beforeOpportunities = count(store, 'opportunity')
      const result = await writer.commit(existing, 'batch-existing', 'b'.repeat(64))
      expect(result.audit).toMatchObject({ opportunityCount: 0, milestoneCount: 2 })
      expect(count(store, 'opportunity')).toBe(beforeOpportunities)
      expect(result.created).toHaveLength(2)
      expect(result.created.every((item) => item.parentRecordId === 'opp-grid-modernization')).toBe(true)
      const msx = new LocalStoreMsxConnector(store)
      const milestones = await msx.listMilestones('opp-grid-modernization')
      expect(milestones.map((item) => item.name)).toEqual(expect.arrayContaining(['Grid telemetry pilot', 'Production telemetry rollout']))
    } finally {
      store.close()
    }
  })

  it('inherits the selected new Opportunity currency for child Milestones', async () => {
    const store = new LocalStore()
    try {
      if (single.kind !== 'opportunity-batch') throw new Error('Invalid fixture')
      store.run('INSERT INTO transaction_currency (id, name, iso_code) VALUES (?, ?, ?)', 'currency-eur', 'Euro', 'EUR')
      const bundle = single.opportunities[0]!
      const draft = {
        ...single,
        opportunities: [{ ...bundle, opportunity: { ...bundle.opportunity, currency: { id: 'currency-eur', label: 'Euro' } } }]
      }
      const result = await new LocalStoreRecordCreation(store, SAMPLE_USER_ID).commit(draft, 'batch-new-eur', 'a'.repeat(64))
      const created = result.created.find((item) => item.kind === 'opportunity')!
      expect(store.get('SELECT transaction_currency_id FROM opportunity WHERE id = ?', created.recordId!)?.['transaction_currency_id'])
        .toBe('currency-eur')
      for (const milestone of result.created.filter((item) => item.kind === 'milestone')) {
        expect(store.get('SELECT transaction_currency_id FROM engagement_milestone WHERE id = ?', milestone.recordId!)?.['transaction_currency_id'])
          .toBe('currency-eur')
      }
    } finally {
      store.close()
    }
  })

  it('derives existing-parent Milestone currency from its Opportunity, not the Account default', async () => {
    const store = new LocalStore()
    try {
      if (single.kind !== 'opportunity-batch') throw new Error('Invalid fixture')
      store.run('INSERT INTO transaction_currency (id, name, iso_code) VALUES (?, ?, ?)', 'currency-eur', 'Euro', 'EUR')
      store.run('UPDATE opportunity SET currency = ?, transaction_currency_id = ? WHERE id = ?',
        'EUR', 'currency-eur', 'opp-grid-modernization')
      const writer = new LocalStoreRecordCreation(store, SAMPLE_USER_ID)
      expect(writer.getCatalog('account-contoso').opportunities.find((item) => item.id === 'opp-grid-modernization'))
        .toMatchObject({ currency: { id: 'currency-eur', label: 'Euro', isoCode: 'EUR' } })
      const draft = {
        kind: 'existing-opportunity-milestone-batch' as const,
        account: single.account,
        opportunity: { id: 'opp-grid-modernization', label: 'Grid operations modernization' },
        milestones: [single.opportunities[0]!.milestones[0]!]
      }
      const result = await writer.commit(draft, 'batch-existing-eur', 'b'.repeat(64))
      expect(store.get('SELECT transaction_currency_id FROM engagement_milestone WHERE id = ?', result.created[0]!.recordId!)?.['transaction_currency_id'])
        .toBe('currency-eur')
    } finally {
      store.close()
    }
  })

  it('rolls back parent, Deal Team and receipt when a child insert fails', async () => {
    const store = new LocalStore()
    try {
      const writer = new LocalStoreRecordCreation(store, SAMPLE_USER_ID)
      const tables = ['opportunity', 'engagement_milestone', 'opportunity_dealteam', 'creation_batch', 'creation_batch_item']
      const baseline = tables.map((table) => count(store, table))
      store.exec("CREATE TRIGGER reject_production_milestone BEFORE INSERT ON engagement_milestone WHEN NEW.name = 'Production telemetry rollout' BEGIN SELECT RAISE(ABORT, 'injected child failure'); END")

      await expect(writer.commit(single, 'batch-fail', 'c'.repeat(64))).rejects.toThrow('injected child failure')
      expect(tables.map((table) => count(store, table))).toEqual(baseline)
    } finally {
      store.close()
    }
  })

  it.each(['opportunity_dealteam', 'creation_batch', 'creation_batch_item'] as const)(
    'rolls back every mutation when %s insertion fails', async (table) => {
      const store = new LocalStore()
      try {
        const baseline = ['opportunity', 'engagement_milestone', 'opportunity_dealteam', 'creation_batch', 'creation_batch_item']
          .map((name) => count(store, name))
        store.exec(`CREATE TRIGGER reject_${table} BEFORE INSERT ON ${table}
          BEGIN SELECT RAISE(ABORT, 'injected ${table} failure'); END`)
        await expect(new LocalStoreRecordCreation(store, SAMPLE_USER_ID).commit(single, `batch-${table}`, 'c'.repeat(64)))
          .rejects.toThrow(`injected ${table} failure`)
        expect(['opportunity', 'engagement_milestone', 'opportunity_dealteam', 'creation_batch', 'creation_batch_item']
          .map((name) => count(store, name))).toEqual(baseline)
      } finally {
        store.close()
      }
    }
  )

  it('commits concurrent identical replays once', async () => {
    const store = new LocalStore()
    try {
      const writer = new LocalStoreRecordCreation(store, SAMPLE_USER_ID)
      const receipts = await Promise.all([
        writer.commit(single, 'batch-concurrent', 'f'.repeat(64)),
        writer.commit(single, 'batch-concurrent', 'f'.repeat(64))
      ])
      expect(receipts[0]).toEqual(receipts[1])
      expect(count(store, 'creation_batch')).toBe(1)
      expect(count(store, 'creation_batch_item')).toBe(5)
    } finally {
      store.close()
    }
  })

  it('returns the existing receipt for identical replay and rejects changed content', async () => {
    const store = new LocalStore()
    try {
      const writer = new LocalStoreRecordCreation(store, SAMPLE_USER_ID)
      const first = await writer.commit(single, 'batch-repeat', 'd'.repeat(64))
      const second = await writer.commit(single, 'batch-repeat', 'd'.repeat(64))
      expect(second).toEqual(first)
      expect(count(store, 'creation_batch')).toBe(1)
      await expect(writer.commit(single, 'batch-repeat', 'e'.repeat(64))).rejects.toThrow(/different|already/i)
      expect(count(store, 'creation_batch')).toBe(1)
    } finally {
      store.close()
    }
  })

  it('rejects hidden or mismatched parents before inserting any child', async () => {
    const store = new LocalStore()
    try {
      if (single.kind !== 'opportunity-batch') throw new Error('Invalid fixture')
      const writer = new LocalStoreRecordCreation(store, SAMPLE_USER_ID)
      const before = count(store, 'engagement_milestone')
      const draft = {
        kind: 'existing-opportunity-milestone-batch' as const,
        account: single.account,
        opportunity: { id: 'opp-ai-service', label: 'AI-assisted customer service' },
        milestones: single.opportunities[0]!.milestones.slice(0, 1)
      }
      await expect(writer.commit(draft, 'batch-wrong-parent', 'f'.repeat(64))).rejects.toThrow(/parent|account/i)
      store.run('UPDATE account SET visibility = ? WHERE id = ?', 'hidden', 'account-contoso')
      await expect(writer.commit(single, 'batch-hidden', '1'.repeat(64))).rejects.toThrow(/hidden|unavailable/i)
      expect(count(store, 'engagement_milestone')).toBe(before)
    } finally {
      store.close()
    }
  })

  it('reopens a file-backed store without reseeding and refuses a newer schema', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-record-create-'))
    const path = join(directory, 'portfolio.sqlite')
    let activeStore: LocalStore | undefined
    try {
      const store = new LocalStore({ path })
      activeStore = store
      const writer = new LocalStoreRecordCreation(store, SAMPLE_USER_ID)
      const result = await writer.commit(single, 'batch-persisted', '2'.repeat(64))
      store.close()
      activeStore = undefined

      const reopened = new LocalStore({ path })
      activeStore = reopened
      const created = result.created.find((item) => item.kind === 'opportunity')!
      expect((await new LocalStoreMsxConnector(reopened).listOpportunities('account-contoso')).some((item) => item.id === created.recordId)).toBe(true)
      expect(count(reopened, 'creation_batch')).toBe(1)
      reopened.exec('PRAGMA user_version = 999')
      reopened.close()
      activeStore = undefined
      expect(() => new LocalStore({ path })).toThrow(/newer|unsupported/i)
    } finally {
      activeStore?.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('migrates an existing version-zero SQLite store without replacing its records', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-record-legacy-'))
    const path = join(directory, 'legacy.sqlite')
    let reopened: LocalStore | undefined
    try {
      const legacy = new DatabaseSync(path)
      legacy.exec(`
        CREATE TABLE account (id TEXT PRIMARY KEY, name TEXT NOT NULL, visibility TEXT NOT NULL);
        CREATE TABLE systemuser (id TEXT PRIMARY KEY, fullname TEXT NOT NULL);
        CREATE TABLE opportunity (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD');
        CREATE TABLE engagement_milestone (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, name TEXT NOT NULL);
        CREATE TABLE opportunity_dealteam (opportunity_id TEXT NOT NULL, systemuser_id TEXT NOT NULL);
        CREATE TABLE milestone_team_member (milestone_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, systemuser_id TEXT NOT NULL);
        CREATE TABLE option_value (option_set TEXT NOT NULL, code INTEGER NOT NULL, label TEXT NOT NULL, PRIMARY KEY (option_set, code));
        INSERT INTO account VALUES ('account-contoso', 'Legacy sample Account', 'visible');
        INSERT INTO systemuser VALUES ('user-girish', 'Sample Seller');
        INSERT INTO opportunity (id, account_id, name) VALUES ('legacy-opp', 'account-contoso', 'Legacy sample Opportunity');
        INSERT INTO opportunity_dealteam VALUES ('legacy-opp', 'user-girish');
      `)
      legacy.close()

      reopened = new LocalStore({ path })
      expect(count(reopened, 'opportunity')).toBe(1)
      expect(reopened.get('SELECT name FROM opportunity WHERE id = ?', 'legacy-opp')?.['name']).toBe('Legacy sample Opportunity')
      expect(Number(reopened.get('PRAGMA user_version')?.['user_version'])).toBe(1)
      const catalog = new LocalStoreRecordCreation(reopened, SAMPLE_USER_ID).getCatalog('account-contoso')
      expect(catalog.priceLists).toContainEqual({ id: 'price-list-usd-standard', label: 'USD Standard Price List' })
      expect(catalog.opportunities).toContainEqual({
        id: 'legacy-opp', label: 'Legacy sample Opportunity',
        currency: { id: 'currency-usd', label: 'US Dollar', isoCode: 'USD' }
      })
    } finally {
      reopened?.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('leaves a new file reusable when a seed fails during initial schema creation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-record-init-failure-'))
    const path = join(directory, 'initialization.sqlite')
    try {
      expect(() => new LocalStore({
        path,
        seed: {
          ...defaultSeed,
          accounts: [{
            id: 'account-invalid',
            name: 'Invalid sample account',
            visibility: 'visible',
            default_price_level_id: 'not-a-price-list',
            default_currency_id: 'currency-usd'
          }]
        }
      })).toThrow()
      const restored = new LocalStore({ path })
      try {
        expect(count(restored, 'opportunity')).toBeGreaterThan(0)
        expect(Number(restored.get('PRAGMA user_version')?.['user_version'])).toBe(1)
      } finally {
        restored.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
