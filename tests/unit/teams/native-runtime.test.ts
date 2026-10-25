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
  it('lists the signed-in user\'s recent Teams meetings with a separate Graph token and verifies a handle before resolving it', async () => {
    const teams = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d'
    const getToken = vi.fn(async (resource: 'msx' | 'mcp' | 'graph') => `${resource}-token`)
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input))
      expect(init?.method ?? 'GET').toBe('GET')
      if (url.hostname !== 'graph.microsoft.com') return Response.json({ value: [] })
      expect(new Headers(init?.headers).get('authorization')).toContain('graph-token')
      if (url.pathname === '/v1.0/me/calendarView') {
        return Response.json({ value: [{
          id: 'event-1', subject: 'Arc review', isOnlineMeeting: true, isCancelled: false,
          start: { dateTime: '2026-10-23T14:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-23T15:00:00.0000000', timeZone: 'UTC' },
          onlineMeeting: { joinUrl: teams }, attendees: []
        }] })
      }
      if (url.pathname === '/v1.0/me') return Response.json({ mail: 'me@contoso.com' })
      if (url.pathname === '/v1.0/me/onlineMeetings') return Response.json({ value: [{ id: 'online-1' }] })
      return Response.json({ error: { code: 'NotFound' } }, { status: 404 })
    })
    const services = await createLiveApplicationServices({
      environment: {}, msxResource: 'https://microsoftsales.crm.dynamics.com', guidanceMode: 'deterministic',
      getToken, preferences: new MemoryPortfolioPreferenceStore(), fetchImplementation: transport
    })
    try {
      const listed = await services.listRecentMeetings()
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({ subject: 'Arc review', occurredAt: '2026-10-23T14:00:00.000Z', meetingType: 'internal', source: 'teams' })
      expect(listed[0]!.id).toMatch(/^gm_[A-Za-z0-9_-]{32}$/)
      expect(JSON.stringify(listed)).not.toContain('teams.microsoft.com')
      expect(getToken).toHaveBeenCalledWith('graph')
      await expect(services.resolveRecentMeeting(listed[0]!.id)).resolves.toEqual({ meetingId: 'online-1', meetingType: 'internal' })
      await expect(services.resolveRecentMeeting(`gm_${'z'.repeat(32)}`)).rejects.toMatchObject({ code: 'meeting_not_in_recent_calendar' })
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
