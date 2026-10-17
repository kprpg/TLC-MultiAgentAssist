import { createHash } from 'node:crypto'
import {
  contractVersion,
  recordCreationCatalogSchema,
  recordCreationMaxMutations,
  type ChoiceRef,
  type LookupRef,
  type RecordCreationCatalog
} from '../../common/index.js'
import type { MsxConnector } from '../common/index.js'
import { defaultSeed, SAMPLE_USER_ID } from './seed.js'

function reference(row: Record<string, string | number | null>): LookupRef {
  return { id: String(row['id']), label: String(row['name']) }
}

function choices(optionSet: string): ChoiceRef[] {
  return defaultSeed.optionValues.filter((row) => row['option_set'] === optionSet).map((row) => ({
    value: Number(row['code']),
    label: String(row['label'])
  })).sort((left, right) => left.value - right.value)
}

export class SampleRecordCreationCatalog {
  constructor(private readonly msx: Pick<MsxConnector, 'listAccounts' | 'listOpportunities'>) {}

  async getCatalog(accountId: string): Promise<RecordCreationCatalog> {
    const account = (await this.msx.listAccounts()).find((item) => item.id === accountId && item.visibility !== 'hidden')
    if (!account) throw new Error('The selected Account is unavailable or hidden.')
    const owner = defaultSeed.systemUsers.find((item) => item['id'] === SAMPLE_USER_ID)
    if (!owner) throw new Error('The sample creator is not seeded.')
    const priceLists = defaultSeed.priceLevels.map(reference)
    const currencies = defaultSeed.currencies.map((row) => ({ ...reference(row), isoCode: String(row['iso_code']) }))
    const data = {
      account: { id: account.id, label: account.name },
      opportunities: (await this.msx.listOpportunities(account.id)).map((item) => {
        const matching = currencies.filter((currency) => currency.isoCode === item.currency)
        return {
          id: item.id,
          label: item.name,
          ...(matching.length === 1 ? { currency: matching[0] } : {})
        }
      }),
      priceLists,
      currencies,
      workloads: defaultSeed.workloads.map(reference),
      owners: defaultSeed.systemUsers.map((row) => ({ id: String(row['id']), label: String(row['fullname']) })),
      defaults: {
        owner: { id: SAMPLE_USER_ID, label: String(owner['fullname']) },
        priceList: priceLists[0],
        currency: currencies[0]
      },
      choices: {
        intent: choices('msp_opportunitytype'),
        category: choices('msp_milestonecategory'),
        status: choices('msp_milestonestatus'),
        commitment: choices('msp_commitmentrecommendation'),
        customerBudgetApproved: choices('msp_customerbudgetapproved'),
        solutionArea: choices('msp_solutionarea'),
        technicalCapability: choices('msp_technicalcapability')
      }
    }
    return recordCreationCatalogSchema.parse({
      contractVersion,
      target: 'draft',
      revision: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
      ...data,
      maxMutations: recordCreationMaxMutations
    })
  }
}
