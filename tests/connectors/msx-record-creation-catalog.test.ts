import { describe, expect, it, vi } from 'vitest'
import { contractVersion } from '../../packages/common/index.js'
import { LiveMsxConnector } from '../../packages/connectors/msx/index.js'
import { RecordCreationService } from '../../packages/orchestrator/record-creation/service.js'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('live record creation catalog (read only)', () => {
  it('resolves delegated lookup and choice metadata for a draft without writing to MSX', async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method ?? 'GET').toBe('GET')
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/systemusers(user-id)')) return json({ systemuserid: 'user-id', fullname: 'Sample Seller' })
      if (url.pathname.endsWith('/msp_dealteams')) return json({ value: [{ _msp_parentopportunityid_value: 'opp-1' }] })
      if (url.pathname.endsWith('/teamtemplates')) return json({ value: [] })
      if (url.pathname.endsWith('/opportunities')) return json({ value: [{
        opportunityid: 'opp-1', _parentaccountid_value: 'account-a', name: 'Existing authorized opportunity',
        statecode: 0, msp_activesalesstage: 2, estimatedvalue: 100_000, estimatedclosedate: '2027-03-31'
      }] })
      if (url.pathname.endsWith('/accounts')) return json({ value: [{ accountid: 'account-a', name: 'Synthetic account' }] })
      if (url.pathname.endsWith('/pricelevels')) return json({ value: [{ pricelevelid: 'price-1', name: 'Standard price' }] })
      if (url.pathname.endsWith('/transactioncurrencies')) return json({ value: [{ transactioncurrencyid: 'currency-1', currencyname: 'US Dollar', isocurrencycode: 'USD' }] })
      if (url.pathname.endsWith('/msp_workloads')) return json({ value: [{ msp_workloadid: 'workload-1', msp_name: 'Cloud Scale Analytics' }] })
      if (url.pathname.includes('/EntityDefinitions(')) {
        const attribute = /Attributes\(LogicalName='([^']+)'\)/.exec(url.pathname)?.[1]
        const options: Record<string, Array<[number, string]>> = {
          msp_opportunitytype: [[606820000, 'Billed'], [606820001, 'Consumption']],
          msp_milestonecategory: [[861980000, 'POC/Pilot']],
          msp_milestonestatus: [[861980000, 'On Track']],
          msp_commitmentrecommendation: [[861980000, 'Uncommitted']],
          msp_customerbudgetapproved: [[606820000, 'Yes']],
          msp_solutionarea: [[394380000, 'Cloud and AI Platforms']],
          msp_technicalcapability: [[861980077, 'Cloud Scale Analytics']]
        }
        if (!attribute || !options[attribute]) throw new Error(`Unexpected metadata: ${url}`)
        return json({ OptionSet: { Options: options[attribute].map(([value, label]) => ({
          Value: value, Label: { LocalizedLabels: [{ LanguageCode: 1033, Label: label }] }
        })) } })
      }
      throw new Error(`Unexpected MSX request: ${url}`)
    })
    const msx = new LiveMsxConnector({ getAccessToken: async () => 'test-token' }, request as typeof fetch)
    const service = new RecordCreationService(msx, msx)

    const catalog = await service.getCatalog({ contractVersion, accountId: 'account-a' })
    expect(catalog).toMatchObject({
      target: 'draft',
      account: { id: 'account-a', label: 'Synthetic account' },
      defaults: { owner: { id: 'user-id', label: 'Sample Seller' } }
    })
    expect(catalog.priceLists).toContainEqual({ id: 'price-1', label: 'Standard price' })
    expect(catalog.currencies).toContainEqual({ id: 'currency-1', label: 'US Dollar', isoCode: 'USD' })
    expect(catalog.workloads).toContainEqual({ id: 'workload-1', label: 'Cloud Scale Analytics' })
    expect(catalog.choices.intent).toContainEqual({ value: 606820001, label: 'Consumption' })
    expect(catalog.opportunities).toContainEqual({ id: 'opp-1', label: 'Existing authorized opportunity' })
    await expect(service.preview({
      contractVersion,
      target: 'live-msx',
      draft: {
        kind: 'existing-opportunity-milestone-batch',
        account: catalog.account,
        opportunity: { id: catalog.opportunities[0]!.id, label: catalog.opportunities[0]!.label },
        milestones: [{
          clientMilestoneKey: 'ms-1',
          name: 'Pilot',
          category: catalog.choices.category[0],
          milestoneDate: '2027-02-10',
          workload: catalog.workloads[0]
        }]
      }
    })).rejects.toThrow(/disabled/i)
    expect(request.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })
})
