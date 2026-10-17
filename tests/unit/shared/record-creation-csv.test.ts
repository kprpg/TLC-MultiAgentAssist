import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recordCreationDraftSchema } from '../../../packages/common/index.js'
import { LocalStore } from '../../../packages/connectors/local-store/index.js'
import { LocalStoreRecordCreation } from '../../../packages/connectors/local-store/record-creation.js'
import { SAMPLE_USER_ID } from '../../../packages/connectors/local-store/seed.js'
import { importCreationCsv, importExistingMilestoneCsv } from '../../../apps/shared/record-creation/csv.js'

function files(name: string) {
  const folder = resolve('tests', 'fixtures', 'record-creation', name)
  return {
    expected: recordCreationDraftSchema.parse(JSON.parse(readFileSync(resolve(folder, 'input.json'), 'utf8'))),
    opportunities: readFileSync(resolve(folder, 'opportunities.csv'), 'utf8'),
    milestones: readFileSync(resolve(folder, 'milestones.csv'), 'utf8')
  }
}

describe('record creation CSV', () => {
  it.each([
    'single-opportunity-multiple-milestones',
    'multiple-opportunities-multiple-milestones'
  ])('imports %s into the same canonical draft as JSON', (scenario) => {
    const store = new LocalStore()
    try {
      const { expected, opportunities, milestones } = files(scenario)
      const catalog = new LocalStoreRecordCreation(store, SAMPLE_USER_ID).getCatalog(expected.account.id)
      expect(importCreationCsv(catalog, opportunities, milestones)).toEqual(expected)
    } finally {
      store.close()
    }
  })

  it('imports Milestones for an existing authorized parent without an Opportunity CSV', () => {
    const store = new LocalStore()
    try {
      const { milestones } = files('single-opportunity-multiple-milestones')
      const catalog = new LocalStoreRecordCreation(store, SAMPLE_USER_ID).getCatalog('account-contoso')
      const parent = catalog.opportunities.find((item) => item.id === 'opp-grid-modernization')!
      const withoutParentColumn = milestones.split(/\r?\n/).map((line) => line.replace(/^([^,]*),[^,]*,/, '$1,')).join('\n')
      expect(importExistingMilestoneCsv(catalog, parent, withoutParentColumn)).toMatchObject({
        kind: 'existing-opportunity-milestone-batch',
        account: catalog.account,
        opportunity: { id: parent.id, label: parent.label },
        milestones: [{ name: 'Grid telemetry pilot' }, { name: 'Production telemetry rollout' }, { name: 'Telemetry cost optimization' }]
      })
    } finally {
      store.close()
    }
  })

  it('reports duplicate/unknown headers, orphaned parents and malformed quoting explicitly', () => {
    const store = new LocalStore()
    try {
      const catalog = new LocalStoreRecordCreation(store, SAMPLE_USER_ID).getCatalog('account-contoso')
      const { opportunities, milestones } = files('single-opportunity-multiple-milestones')
      const duplicateHeader = opportunities.replace('clientOpportunityKey,name,', 'clientOpportunityKey,clientOpportunityKey,')
      expect(() => importCreationCsv(catalog, duplicateHeader, milestones)).toThrow(/duplicate|header/i)
      expect(() => importCreationCsv(catalog, opportunities, milestones.replace('opp-grid-observability', 'unknown-parent')))
        .toThrow(/parentOpportunityKey|parent|orphan/i)
      expect(() => importCreationCsv(catalog, opportunities, milestones.replace('Grid telemetry pilot', '"unclosed quote')))
        .toThrow(/quote|CSV/i)
    } finally {
      store.close()
    }
  })
})
