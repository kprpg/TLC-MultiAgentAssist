import { describe, expect, it } from 'vitest'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { SampleRecordCreationCatalog } from '../../../packages/connectors/local-store/sample-record-creation-catalog.js'

describe('read-only sample creation catalog', () => {
  it('provides verified reference choices for drafts without requiring SQLite', async () => {
    const catalog = await new SampleRecordCreationCatalog(new FixtureMsxConnector()).getCatalog('account-contoso')
    expect(catalog).toMatchObject({
      target: 'draft',
      account: { id: 'account-contoso', label: 'Contoso Energy' },
      defaults: {
        owner: { id: 'user-girish' },
        currency: { id: 'currency-usd', isoCode: 'USD' },
        priceList: { id: 'price-list-usd-standard' }
      }
    })
    expect(catalog.choices.intent).toEqual(expect.arrayContaining([
      { value: 606820000, label: 'Billed' }, { value: 606820001, label: 'Consumption' }
    ]))
    expect(catalog.opportunities.some((item) => item.id === 'opp-grid-modernization')).toBe(true)
  })

  it('does not offer hidden or unavailable Accounts as creation parents', async () => {
    const msx = new FixtureMsxConnector()
    await msx.setAccountVisibility('account-contoso', 'hidden')
    await expect(new SampleRecordCreationCatalog(msx).getCatalog('account-contoso')).rejects.toThrow(/hidden|unavailable/i)
    await expect(new SampleRecordCreationCatalog(msx).getCatalog('not-an-account')).rejects.toThrow(/hidden|unavailable/i)
  })
})
