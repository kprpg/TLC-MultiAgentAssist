import { describe, expect, it } from 'vitest'
import { LocalStore } from '../../../packages/connectors/local-store/index.js'
import { LocalStoreRecordCreation } from '../../../packages/connectors/local-store/record-creation.js'
import { SAMPLE_USER_ID } from '../../../packages/connectors/local-store/seed.js'
import {
  buildOpportunityDraft,
  buildExistingMilestoneDraft,
  newOpportunityRow,
  newMilestoneRow
} from '../../../apps/shared/record-creation/draft-model.js'

describe('shared creation entry model', () => {
  it('normalizes a single Opportunity with two intents and a child Milestone', () => {
    const store = new LocalStore()
    try {
      const catalog = new LocalStoreRecordCreation(store, SAMPLE_USER_ID).getCatalog('account-contoso')
      const milestone = {
        ...newMilestoneRow('ms-form', catalog),
        name: 'Pilot',
        categoryValue: '861980000',
        milestoneDate: '2027-02-15',
        workloadId: 'workload-cloud-scale-analytics'
      }
      const row = {
        ...newOpportunityRow('opp-form', catalog),
        name: 'Grid observability',
        intentValues: ['606820000', '606820001'],
        estimatedValue: '1450000',
        estimatedCloseDate: '2027-06-30',
        milestones: [milestone]
      }
      expect(buildOpportunityDraft(catalog, [row])).toMatchObject({
        kind: 'opportunity-batch',
        account: catalog.account,
        opportunities: [{
          opportunity: {
            name: 'Grid observability',
            intent: [{ value: 606820000, label: 'Billed' }, { value: 606820001, label: 'Consumption' }],
            estimatedValue: 1450000,
            priceList: { id: 'price-list-usd-standard' }
          },
          milestones: [{ name: 'Pilot', workload: { id: 'workload-cloud-scale-analytics' } }]
        }]
      })
    } finally {
      store.close()
    }
  })

  it('rejects missing required entry fields and builds an existing-parent Milestone batch', () => {
    const store = new LocalStore()
    try {
      const catalog = new LocalStoreRecordCreation(store, SAMPLE_USER_ID).getCatalog('account-contoso')
      expect(() => buildOpportunityDraft(catalog, [newOpportunityRow('opp-blank', catalog)])).toThrow()
      const parent = catalog.opportunities.find((item) => item.id === 'opp-grid-modernization')!
      const milestone = {
        ...newMilestoneRow('ms-existing', catalog),
        name: 'Review',
        categoryValue: '861980002',
        milestoneDate: '2027-02-16',
        workloadId: 'workload-cloud-scale-analytics'
      }
      expect(buildExistingMilestoneDraft(catalog, parent, [milestone])).toMatchObject({
        kind: 'existing-opportunity-milestone-batch',
        opportunity: { id: parent.id, label: parent.label },
        milestones: [{ name: 'Review', category: { value: 861980002 } }]
      })
    } finally {
      store.close()
    }
  })
})
