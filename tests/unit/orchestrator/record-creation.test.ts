import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contractVersion,
  recordCreationDraftSchema,
  type RecordCreationDraft
} from '../../../packages/common/index.js'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { LocalStoreRecordCreation } from '../../../packages/connectors/local-store/record-creation.js'
import { SAMPLE_USER_ID } from '../../../packages/connectors/local-store/seed.js'
import { RecordCreationService } from '../../../packages/orchestrator/record-creation/service.js'

function fixture(name: string): RecordCreationDraft {
  return recordCreationDraftSchema.parse(JSON.parse(readFileSync(resolve('tests', 'fixtures', 'record-creation', name, 'input.json'), 'utf8')))
}

const single = fixture('single-opportunity-multiple-milestones')
const multiple = fixture('multiple-opportunities-multiple-milestones')
const now = () => new Date('2026-10-16T15:00:00.000Z')

function setup() {
  const store = new LocalStore()
  const source = new LocalStoreRecordCreation(store, SAMPLE_USER_ID)
  const service = new RecordCreationService(new LocalStoreMsxConnector(store), source, { writer: source, now })
  return { store, source, service }
}

describe('RecordCreationService', () => {
  it('previews and commits one new Opportunity with child Milestones after explicit review', async () => {
    const { store, service } = setup()
    try {
      const catalog = await service.getCatalog({ contractVersion, accountId: 'account-contoso' })
      expect(catalog.account).toEqual(single.account)
      const preview = await service.preview({ contractVersion, target: 'sqlite', draft: single })
      expect(preview).toMatchObject({
        target: 'sqlite',
        mutationCount: 5,
        normalizedDraft: single
      })
      expect(preview.digest).toMatch(/^[a-f0-9]{64}$/)
      expect(store.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(0)

      const request = { contractVersion, preview, expectedDigest: preview.digest, confirmed: true as const }
      const result = await service.commit(request)
      expect(result).toMatchObject({ state: 'committed', target: 'sqlite', audit: { opportunityCount: 1, milestoneCount: 3 } })
      await expect(service.commit(request)).resolves.toEqual(result)
    } finally {
      store.close()
    }
  })

  it('previews and commits several Opportunities using one all-or-nothing transaction', async () => {
    const { store, service } = setup()
    try {
      const preview = await service.preview({ contractVersion, target: 'sqlite', draft: multiple })
      expect(preview.mutationCount).toBe(12)
      const result = await service.commit({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true })
      expect(result.created.filter((item) => item.kind === 'milestone')).toHaveLength(6)
    } finally {
      store.close()
    }
  })

  it('rejects a forged or expired preview without touching SQLite', async () => {
    const { store, service } = setup()
    try {
      const preview = await service.preview({ contractVersion, target: 'sqlite', draft: single })
      await expect(service.commit({
        contractVersion,
        preview: { ...preview, normalizedDraft: multiple },
        expectedDigest: preview.digest,
        confirmed: true
      })).rejects.toThrow(/preview|digest|changed/i)
      await expect(service.commit({
        contractVersion,
        preview: { ...preview, expiresAt: '2020-01-01T00:00:00.000Z' },
        expectedDigest: preview.digest,
        confirmed: true
      })).rejects.toThrow(/preview|expired/i)
      await expect(service.commit({
        contractVersion,
        preview: { ...preview, expiresAt: '2030-01-01T00:00:00.000Z' },
        expectedDigest: preview.digest,
        confirmed: true
      })).rejects.toThrow(/preview|digest|changed/i)
      await expect(service.commit({
        contractVersion,
        preview: { ...preview, mutationCount: 1 },
        expectedDigest: preview.digest,
        confirmed: true
      })).rejects.toThrow(/preview|digest|changed/i)
      await expect(service.commit({
        contractVersion,
        preview: { ...preview, warnings: ['This was not in the reviewed preview.'] },
        expectedDigest: preview.digest,
        confirmed: true
      })).rejects.toThrow(/preview|digest|changed/i)
      expect(store.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(0)
    } finally {
      store.close()
    }
  })

  it('rejects stale catalog labels, a lost parent, and batches beyond the mutation cap', async () => {
    const { store, service } = setup()
    try {
      const preview = await service.preview({ contractVersion, target: 'sqlite', draft: single })
      store.run('UPDATE option_value SET label = ? WHERE option_set = ? AND code = ?', 'Changed label', 'msp_opportunitytype', 606820001)
      await expect(service.commit({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true }))
        .rejects.toThrow(/catalog|changed/i)

      store.run('UPDATE option_value SET label = ? WHERE option_set = ? AND code = ?', 'Consumption', 'msp_opportunitytype', 606820001)
      const next = await service.preview({ contractVersion, target: 'sqlite', draft: single })
      store.run('UPDATE account SET visibility = ? WHERE id = ?', 'hidden', 'account-contoso')
      await expect(service.commit({ contractVersion, preview: next, expectedDigest: next.digest, confirmed: true }))
        .rejects.toThrow(/account|unavailable|hidden/i)
      expect(store.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(0)

      store.run('UPDATE account SET visibility = ? WHERE id = ?', 'visible', 'account-contoso')
      if (multiple.kind !== 'opportunity-batch') throw new Error('Invalid fixture')
      const bundles = Array.from({ length: 13 }, (_, i) => multiple.opportunities.map((bundle) => ({
        opportunity: { ...bundle.opportunity, clientOpportunityKey: `${bundle.opportunity.clientOpportunityKey}-${i}` },
        milestones: bundle.milestones.map((milestone) => ({ ...milestone, clientMilestoneKey: `${milestone.clientMilestoneKey}-${i}` }))
      }))).flat()
      await expect(service.preview({
        contractVersion, target: 'sqlite', draft: { ...multiple, opportunities: bundles }
      })).rejects.toThrow(/batch|limit|mutations/i)
    } finally {
      store.close()
    }
  })

  it('requires a resolved existing-parent currency and rechecks it before commit', async () => {
    const { store, service } = setup()
    try {
      if (single.kind !== 'opportunity-batch') throw new Error('Invalid fixture')
      const existing = {
        kind: 'existing-opportunity-milestone-batch' as const,
        account: single.account,
        opportunity: { id: 'opp-grid-modernization', label: 'Grid operations modernization' },
        milestones: [single.opportunities[0]!.milestones[0]!]
      }
      const preview = await service.preview({ contractVersion, target: 'sqlite', draft: existing })
      store.run('INSERT INTO transaction_currency (id, name, iso_code) VALUES (?, ?, ?)', 'currency-eur', 'Euro', 'EUR')
      store.run('UPDATE opportunity SET currency = ?, transaction_currency_id = ? WHERE id = ?',
        'EUR', 'currency-eur', 'opp-grid-modernization')
      await expect(service.commit({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true }))
        .rejects.toThrow(/catalog|changed/i)
      expect(store.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(0)
      store.run('UPDATE opportunity SET currency = ?, transaction_currency_id = NULL WHERE id = ?', 'GBP', 'opp-grid-modernization')
      await expect(service.preview({ contractVersion, target: 'sqlite', draft: existing }))
        .rejects.toThrow(/currency|reference/i)
    } finally {
      store.close()
    }
  })

  it('rejects live creation by default and exports a no-write draft with safe CSV', async () => {
    const { store, service } = setup()
    try {
      await expect(service.preview({ contractVersion, target: 'live-msx', draft: single }))
        .rejects.toThrow(/disabled|unavailable|live/i)

      const draft = await service.preview({ contractVersion, target: 'draft', draft: multiple })
      const exported = await service.exportDraft({ contractVersion, preview: draft, expectedDigest: draft.digest, confirmed: true })
      expect(exported.result).toMatchObject({ state: 'drafted', target: 'draft', created: [] })
      expect(exported.result.message).toContain('MSX')
      expect(exported.files.map((file) => file.name)).toEqual(expect.arrayContaining([
        'creation-manifest.json', 'creation-review.md', 'opportunities.csv', 'milestones.csv'
      ]))
      expect(exported.files.find((file) => file.name === 'milestones.csv')?.content).toContain('ms-commerce-production')
      expect(store.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(0)
      await expect(service.commit({ contractVersion, preview: draft, expectedDigest: draft.digest, confirmed: true }))
        .rejects.toThrow(/draft|target/i)
    } finally {
      store.close()
    }
  })

  it('neutralizes spreadsheet formulas after leading whitespace in untrusted Milestone comments', async () => {
    const { store, service } = setup()
    try {
      if (single.kind !== 'opportunity-batch') throw new Error('Invalid fixture')
      const bundle = single.opportunities[0]!
      const edited = {
        ...single,
        opportunities: [{
          ...bundle,
          milestones: [{
            ...bundle.milestones[0]!,
            comments: '\t=HYPERLINK("https://example.test","unsafe")'
          }]
        }]
      }
      const preview = await service.preview({ contractVersion, target: 'draft', draft: edited })
      const exported = await service.exportDraft({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true })
      const csv = exported.files.find((file) => file.name === 'milestones.csv')?.content
      expect(csv).toContain(`"'\t=HYPERLINK`)
      expect(store.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(0)
    } finally {
      store.close()
    }
  })
})
