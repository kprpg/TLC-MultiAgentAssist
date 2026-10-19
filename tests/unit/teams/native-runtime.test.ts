import { describe, expect, it, vi } from 'vitest'
import { createLiveApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { MemoryPortfolioPreferenceStore } from '../../../packages/connectors/common/portfolio-preferences.js'
import { workflowContractVersion } from '../../../packages/common/contracts/workflows.js'
import { sellerDashboardContractVersion } from '../../../packages/common/contracts/seller-dashboard.js'

describe('live source bootstrap without hosted optional dependencies', () => {
  it('automatically loads only the current Dataverse user deal-team accounts without a supplied user/account ID or source writes', async () => {
    const sourceUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const opportunityId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.method ?? 'GET').toBe('GET')
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return Response.json({ UserId: sourceUserId })
      if (url.pathname.endsWith('/msp_dealteams')) {
        expect(url.searchParams.get('$filter')).toBe(`statecode eq 0 and _msp_dealteamuserid_value eq ${sourceUserId}`)
        return Response.json({ value: [{ _msp_parentopportunityid_value: opportunityId }, { _msp_parentopportunityid_value: opportunityId }] })
      }
      if (url.pathname.endsWith('/opportunities')) {
        expect(url.searchParams.get('$filter')).toContain(opportunityId)
        return Response.json({ value: [{ opportunityid: opportunityId, _parentaccountid_value: accountId, name: 'Sanitized own opportunity', statecode: 0 }] })
      }
      if (url.pathname.endsWith('/accounts')) {
        expect(url.searchParams.get('$filter')).toBe(`statecode eq 0 and (accountid eq ${accountId})`)
        return Response.json({ value: [{ accountid: accountId, name: 'Sanitized own deal-team account' }] })
      }
      return Response.json({ value: [] })
    })
    const services = await createLiveApplicationServices({
      environment: {}, msxResource: 'https://microsoftsales.crm.dynamics.com', guidanceMode: 'deterministic',
      getToken: async () => 'mock-current-user-delegated-token', preferences: new MemoryPortfolioPreferenceStore(), fetchImplementation: transport
    })
    try {
      expect(await services.orchestrator.listAccounts()).toEqual([expect.objectContaining({
        id: accountId, name: 'Sanitized own deal-team account', segment: 'Live MSX', provenance: 'deal-team', visibility: 'visible'
      })])
      expect(transport).toHaveBeenCalled()
    } finally { await services.dispose() }
  })
  it('requires an explicit deterministic choice instead of falling back from broken Foundry', async () => {
    await expect(createLiveApplicationServices({
      environment: {}, msxResource: 'https://microsoftsales.crm.dynamics.com',
      getToken: async () => 'native-token', preferences: new MemoryPortfolioPreferenceStore()
    })).rejects.toThrow(/Foundry.*credential/)
  })
  it('reuses the real connector/core without Foundry, bot identities or sample services', async () => {
    const getToken = vi.fn(async () => 'native-private-token')
    const transport = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('WhoAmI')) return Response.json({ UserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
      return Response.json({ value: [] })
    })
    const services = await createLiveApplicationServices({
      environment: {}, msxResource: 'https://microsoftsales.crm.dynamics.com', guidanceMode: 'deterministic',
      getToken, preferences: new MemoryPortfolioPreferenceStore(), fetchImplementation: transport
    })
    try {
      expect(getToken).not.toHaveBeenCalled()
      expect(await services.orchestrator.listAccounts()).toEqual([])
      expect(getToken).toHaveBeenCalledWith('msx')
      expect(transport).toHaveBeenCalled()
      expect(services.workflows.listDefinitions({ contractVersion: workflowContractVersion }).length).toBeGreaterThan(0)
      expect(await services.sellerDashboard.invoke({ contractVersion: sellerDashboardContractVersion, operation: 'get' })).toMatchObject({ kind: 'unavailable', code: 'hosted-profile-denied' })
    } finally { await services.dispose() }
  })
})
