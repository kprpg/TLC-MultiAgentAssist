import { describe, expect, it, vi } from 'vitest'
import { FixtureMsxConnector, LiveMsxConnector } from '../../packages/connectors/msx/index.js'

const validGuid = '00000000-0000-4000-8000-000000000abc'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('LiveMsxConnector.discoverOpportunities', () => {
  it('queries open opportunities by domain and flags existing deal-team membership', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('secret-token')
    let discoverFilter = ''
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_dealteams')) return json({ value: [{ _msp_parentopportunityid_value: 'opp-existing' }] })
      if (url.pathname.endsWith('/opportunities')) {
        const filter = url.searchParams.get('$filter') ?? ''
        if (filter.includes('msp_technicalcapability')) {
          discoverFilter = filter
          return json({
            value: [
              { opportunityid: 'opp-existing', _parentaccountid_value: 'account-a', '_parentaccountid_value@OData.Community.Display.V1.FormattedValue': 'Alpha', name: 'Already mine', msp_activesalesstage: 2, estimatedvalue: 1000, 'msp_solutionarea@OData.Community.Display.V1.FormattedValue': 'Cloud and AI Platforms', 'msp_technicalcapability@OData.Community.Display.V1.FormattedValue': 'Advanced Networking' },
              { opportunityid: 'opp-new', _parentaccountid_value: 'account-b', '_parentaccountid_value@OData.Community.Display.V1.FormattedValue': 'Beta', name: 'New infra deal', msp_activesalesstage: 1, estimatedvalue: 2000, 'msp_technicalcapability@OData.Community.Display.V1.FormattedValue': 'Azure Arc' },
              { opportunityid: 'opp-unassigned', _parentaccountid_value: 'account-z', name: 'Not my account', msp_activesalesstage: 1, estimatedvalue: 500, 'msp_technicalcapability@OData.Community.Display.V1.FormattedValue': 'Azure Arc' }
            ]
          })
        }
        // portfolio opportunities-by-id lookup
        return json({ value: [{ opportunityid: 'opp-existing', _parentaccountid_value: 'account-a', name: 'Already mine' }] })
      }
      if (url.pathname.endsWith('/accounts')) return json({ value: [{ accountid: 'account-a', name: 'Alpha' }, { accountid: 'account-b', name: 'Beta' }] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken }, request as typeof fetch)

    const results = await connector.discoverOpportunities('infra')

    expect(discoverFilter).toContain('statecode eq 0')
    expect(discoverFilter).toContain('_parentaccountid_value eq account-a')
    expect(discoverFilter).toContain('msp_technicalcapability eq 861980000')
    // Scoped to assigned accounts: an opportunity in an unassigned account is excluded.
    expect(results.map((item) => item.id)).toEqual(['opp-existing', 'opp-new'])
    expect(results).toEqual([
      expect.objectContaining({ id: 'opp-existing', domain: 'infra', onDealTeam: true, accountName: 'Alpha', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Advanced Networking' }),
      expect.objectContaining({ id: 'opp-new', domain: 'infra', onDealTeam: false, accountName: 'Beta', technicalCapability: 'Azure Arc' })
    ])
  })

  it('includes a conversation fallback for specialist domains so they are not capability-only', async () => {
    let discoverFilter = ''
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_dealteams')) return json({ value: [{ _msp_parentopportunityid_value: 'opp-existing' }] })
      if (url.pathname.endsWith('/opportunities')) {
        const filter = url.searchParams.get('$filter') ?? ''
        if (filter.includes('msp_technicalcapability')) { discoverFilter = filter; return json({ value: [] }) }
        return json({ value: [{ opportunityid: 'opp-existing', _parentaccountid_value: 'account-a', name: 'Mine' }] })
      }
      if (url.pathname.endsWith('/accounts')) return json({ value: [{ accountid: 'account-a', name: 'Alpha' }] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

    await connector.discoverOpportunities('security')

    expect(discoverFilter).toContain('msp_technicalcapability eq 861980063') // Cloud Security
    expect(discoverFilter).toContain('msp_conversation eq 884800003') // Establish a trusted and secure platform for AI
  })

  it('follows Dataverse pagination instead of truncating discovery results', async () => {
    let firstDiscoverUrl: URL | undefined
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_dealteams')) return json({ value: [{ _msp_parentopportunityid_value: 'opp-existing' }] })
      if (url.pathname.endsWith('/opportunities')) {
        if (url.searchParams.has('$skiptoken')) {
          return json({ value: [{ opportunityid: 'opp-after-first-page', _parentaccountid_value: 'account-a', name: 'TGH WAF' }] })
        }
        const filter = url.searchParams.get('$filter') ?? ''
        if (filter.includes('msp_technicalcapability')) {
          firstDiscoverUrl = url
          return json({
            value: [{ opportunityid: 'opp-first-page', _parentaccountid_value: 'account-a', name: 'First page' }],
            '@odata.nextLink': `${url.origin}${url.pathname}?$skiptoken=next`
          })
        }
        return json({ value: [{ opportunityid: 'opp-existing', _parentaccountid_value: 'account-a', name: 'Mine' }] })
      }
      if (url.pathname.endsWith('/accounts')) return json({ value: [{ accountid: 'account-a', name: 'Alpha' }] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

    const results = await connector.discoverOpportunities('infra')

    expect(firstDiscoverUrl?.searchParams.has('$top')).toBe(false)
    expect(results.map((item) => item.id)).toEqual(['opp-first-page', 'opp-after-first-page'])
  })

  it('returns no discovery results when the user has no assigned accounts', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_dealteams')) return json({ value: [] })
      if (url.pathname.endsWith('/opportunities')) return json({ value: [] })
      if (url.pathname.endsWith('/accounts')) return json({ value: [] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

    await expect(connector.discoverOpportunities('data')).resolves.toEqual([])
  })
})

describe('LiveMsxConnector.joinDealTeam', () => {
  it('rejects a non-GUID opportunity id', async () => {
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, (async () => json({})) as unknown as typeof fetch)
    await expect(connector.joinDealTeam('not-a-guid')).rejects.toThrow(/GUID/)
  })

  describe('LiveMsxConnector.leaveDealTeam', () => {
    it('deletes only the signed-in user membership for the selected opportunity', async () => {
      const membershipId = '00000000-0000-4000-8000-000000000def'
      const deleted: string[] = []
      const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
        if (url.pathname.endsWith('/msp_dealteams') && (init?.method ?? 'GET') === 'GET') {
          expect(url.searchParams.get('$filter')).toContain(`_msp_parentopportunityid_value eq ${validGuid}`)
          expect(url.searchParams.get('$filter')).toContain('_msp_dealteamuserid_value eq user-id')
          return json({ value: [{ msp_dealteamid: membershipId }] })
        }
        if (url.pathname.endsWith(`/msp_dealteams(${membershipId})`) && init?.method === 'DELETE') {
          deleted.push(url.pathname)
          return new Response(null, { status: 204 })
        }
        throw new Error(`Unexpected request: ${url} ${init?.method}`)
      })
      const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

      await expect(connector.leaveDealTeam(validGuid)).resolves.toEqual({
        opportunityId: validGuid,
        onDealTeam: false,
        alreadyAbsent: false
      })
      expect(deleted).toHaveLength(1)
    })

    it('is idempotent when the signed-in user has no matching membership', async () => {
      const request = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
        if (url.pathname.endsWith('/msp_dealteams')) return json({ value: [] })
        throw new Error(`Unexpected request: ${url}`)
      })
      const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

      await expect(connector.leaveDealTeam(validGuid)).resolves.toEqual({
        opportunityId: validGuid,
        onDealTeam: false,
        alreadyAbsent: true
      })
    })

    it('refuses to guess when duplicate active memberships exist', async () => {
      const request = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
        if (url.pathname.endsWith('/msp_dealteams')) {
          return json({
            value: [
              { msp_dealteamid: '00000000-0000-4000-8000-000000000def' },
              { msp_dealteamid: '00000000-0000-4000-8000-000000000fed' }
            ]
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
      const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

      await expect(connector.leaveDealTeam(validGuid)).rejects.toThrow(/duplicate active Deal Team memberships/)
    })
  })

  it('discovers navigation-property names from relationship metadata for the odata bind', async () => {
    const posted: Array<Record<string, unknown>> = []
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.includes('ManyToOneRelationships')) {
        return json({
          value: [
            { ReferencingAttribute: 'msp_dealteamuserid', ReferencingEntityNavigationPropertyName: 'msp_DealTeamUserId' },
            { ReferencingAttribute: 'msp_parentopportunityid', ReferencingEntityNavigationPropertyName: 'msp_ParentOpportunityId' }
          ]
        })
      }
      if (url.pathname.endsWith('/msp_dealteams') && (init?.method ?? 'GET') === 'GET') return json({ value: [] })
      if (url.pathname.endsWith('/msp_dealteams') && init?.method === 'POST') {
        posted.push(JSON.parse(String(init?.body)))
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${url} ${init?.method}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

    const result = await connector.joinDealTeam(validGuid)

    expect(result).toEqual({ opportunityId: validGuid, onDealTeam: true, alreadyMember: false })
    expect(posted[0]).toEqual({
      'msp_DealTeamUserId@odata.bind': '/systemusers(user-id)',
      'msp_ParentOpportunityId@odata.bind': `/opportunities(${validGuid})`
    })
  })

  it('falls back to conventional navigation names when metadata is unavailable', async () => {
    const posted: Array<Record<string, unknown>> = []
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.includes('ManyToOneRelationships')) return new Response(JSON.stringify({ error: { message: 'no access' } }), { status: 403 })
      if (url.pathname.endsWith('/msp_dealteams') && (init?.method ?? 'GET') === 'GET') return json({ value: [] })
      if (url.pathname.endsWith('/msp_dealteams') && init?.method === 'POST') {
        posted.push(JSON.parse(String(init?.body)))
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${url} ${init?.method}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

    await connector.joinDealTeam(validGuid)

    expect(posted[0]).toEqual({
      'msp_dealteamuserid@odata.bind': '/systemusers(user-id)',
      'msp_parentopportunityid@odata.bind': `/opportunities(${validGuid})`
    })
  })

  it('uses explicitly configured navigation properties without reading metadata', async () => {
    const posted: Array<Record<string, unknown>> = []
    let metadataReads = 0
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.includes('ManyToOneRelationships')) { metadataReads += 1; return json({ value: [] }) }
      if (url.pathname.endsWith('/msp_dealteams') && (init?.method ?? 'GET') === 'GET') return json({ value: [] })
      if (url.pathname.endsWith('/msp_dealteams') && init?.method === 'POST') {
        posted.push(JSON.parse(String(init?.body)))
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${url} ${init?.method}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch, undefined, undefined, {
      dealTeam: { userNavigationProperty: 'msp_ConfiguredUser', opportunityNavigationProperty: 'msp_ConfiguredOpp' }
    })

    await connector.joinDealTeam(validGuid)

    expect(metadataReads).toBe(0)
    expect(posted[0]).toEqual({
      'msp_ConfiguredUser@odata.bind': '/systemusers(user-id)',
      'msp_ConfiguredOpp@odata.bind': `/opportunities(${validGuid})`
    })
  })

  it('does not create a duplicate row when the user is already a member', async () => {
    let postCount = 0
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_dealteams') && (init?.method ?? 'GET') === 'GET') return json({ value: [{ msp_dealteamid: 'row-1' }] })
      if (url.pathname.endsWith('/msp_dealteams') && init?.method === 'POST') { postCount += 1; return new Response(null, { status: 204 }) }
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

    const result = await connector.joinDealTeam(validGuid)

    expect(result).toEqual({ opportunityId: validGuid, onDealTeam: true, alreadyMember: true })
    expect(postCount).toBe(0)
  })
})

describe('FixtureMsxConnector discovery', () => {
  it('returns domain-filtered opportunities and joins one into the portfolio', async () => {
    const connector = new FixtureMsxConnector()

    const infra = await connector.discoverOpportunities('infra')
    expect(infra.length).toBeGreaterThan(0)
    expect(infra.every((item) => item.domain === 'infra')).toBe(true)
    expect(infra.every((item) => item.onDealTeam === false)).toBe(true)

    const target = infra[0]!
    const join = await connector.joinDealTeam(target.id)
    expect(join).toEqual({ opportunityId: target.id, onDealTeam: true, alreadyMember: false })

    const afterJoin = await connector.discoverOpportunities('infra')
    expect(afterJoin.find((item) => item.id === target.id)?.onDealTeam).toBe(true)

    const portfolio = await connector.listOpportunities(target.accountId)
    expect(portfolio.some((item) => item.id === target.id)).toBe(true)

    const secondJoin = await connector.joinDealTeam(target.id)
    expect(secondJoin.alreadyMember).toBe(true)
  })

  it('separates opportunities across domains', async () => {
    const connector = new FixtureMsxConnector()
    const data = await connector.discoverOpportunities('data')
    const aiApps = await connector.discoverOpportunities('ai-apps')
    expect(data.every((item) => item.domain === 'data')).toBe(true)
    expect(aiApps.every((item) => item.domain === 'ai-apps')).toBe(true)
  })

  it('surfaces the specialist domains beyond the three core buckets', async () => {
    const connector = new FixtureMsxConnector()
    for (const domain of ['security', 'modern-work', 'biz-apps', 'devices', 'services'] as const) {
      const results = await connector.discoverOpportunities(domain)
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((item) => item.domain === domain)).toBe(true)
    }
  })
})

describe('FixtureMsxConnector milestone team membership', () => {
  const opportunityId = 'opp-grid-modernization'

  it('toggles onMilestoneTeam independently and idempotently', async () => {
    const connector = new FixtureMsxConnector()
    const milestone = (await connector.listMilestones(opportunityId))[0]!

    // Normalize to a known-member starting state, then leave and rejoin.
    await connector.joinMilestoneTeam(opportunityId, milestone.id)
    expect((await connector.listMilestones(opportunityId)).find((item) => item.id === milestone.id)?.onMilestoneTeam).toBe(true)

    const left = await connector.leaveMilestoneTeam(opportunityId, milestone.id)
    expect(left).toEqual({ opportunityId, milestoneId: milestone.id, onMilestoneTeam: false, alreadyAbsent: false })
    expect((await connector.listMilestones(opportunityId)).find((item) => item.id === milestone.id)?.onMilestoneTeam).toBe(false)
    // Leaving again is idempotent.
    expect((await connector.leaveMilestoneTeam(opportunityId, milestone.id)).alreadyAbsent).toBe(true)

    const joined = await connector.joinMilestoneTeam(opportunityId, milestone.id)
    expect(joined).toEqual({ opportunityId, milestoneId: milestone.id, onMilestoneTeam: true, alreadyMember: false })
  })

  it('rejects joining an unknown milestone', async () => {
    const connector = new FixtureMsxConnector()
    await expect(connector.joinMilestoneTeam(opportunityId, 'nope')).rejects.toThrow(/Unknown sample milestone/)
  })

  it('keeps a milestone-only opportunity in the portfolio after leaving the deal team', async () => {
    const connector = new FixtureMsxConnector()
    const milestone = (await connector.listMilestones(opportunityId))[0]!
    await connector.joinMilestoneTeam(opportunityId, milestone.id)

    await connector.leaveDealTeam(opportunityId)
    // Retained via milestone-team membership even though the user left the Deal Team.
    expect((await connector.listOpportunities('account-contoso')).some((item) => item.id === opportunityId)).toBe(true)

    // Removing the last milestone membership removes the opportunity from the portfolio.
    for (const item of await connector.listMilestones(opportunityId)) {
      await connector.leaveMilestoneTeam(opportunityId, item.id)
    }
    expect((await connector.listOpportunities('account-contoso')).some((item) => item.id === opportunityId)).toBe(false)
  })

  it('joins a milestone for a discoverable opportunity (greenfield) without joining the Deal Team', async () => {
    const connector = new FixtureMsxConnector()
    const discovered = (await connector.discoverOpportunities('infra'))[0]!
    expect(discovered.onDealTeam).toBe(false)

    const milestones = await connector.listDiscoverableMilestones(discovered.id)
    expect(milestones.length).toBeGreaterThan(0)
    expect(milestones.every((item) => item.onMilestoneTeam === false)).toBe(true)

    const target = milestones[0]!
    const result = await connector.joinMilestoneTeam(discovered.id, target.id)
    expect(result).toEqual({ opportunityId: discovered.id, milestoneId: target.id, onMilestoneTeam: true, alreadyMember: false })

    // The opportunity enters the portfolio via milestone membership, but the user is NOT on its Deal Team.
    expect((await connector.listOpportunities(discovered.accountId)).some((item) => item.id === discovered.id)).toBe(true)
    expect((await connector.discoverOpportunities('infra')).find((item) => item.id === discovered.id)?.onDealTeam).toBe(false)
    expect((await connector.listDiscoverableMilestones(discovered.id)).find((item) => item.id === target.id)?.onMilestoneTeam).toBe(true)
  })
})

describe('LiveMsxConnector milestone team membership (Dataverse access team)', () => {
  const opportunityGuid = validGuid
  const milestoneGuid = '00000000-0000-4000-8000-000000000a01'
  const templateGuid = '00000000-0000-4000-8000-000000000c03'

  it('adds the signed-in user to the milestone access team on join (AddUserToRecordTeam) and is idempotent', async () => {
    const posted: Array<{ path: string; body: Record<string, unknown> }> = []
    let isMember = false
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_engagementmilestones')) return json({ value: [{ msp_engagementmilestoneid: milestoneGuid, msp_name: 'Pilot' }] })
      if (url.pathname.endsWith('/teamtemplates')) return json({ value: [{ teamtemplateid: templateGuid }] })
      if (url.pathname.endsWith('/teams') && method === 'GET') return json({ value: isMember ? [{ _regardingobjectid_value: milestoneGuid }] : [] })
      if (url.pathname.endsWith('/Microsoft.Dynamics.CRM.AddUserToRecordTeam') && method === 'POST') {
        posted.push({ path: url.pathname, body: JSON.parse(String(init?.body)) })
        isMember = true
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${url} ${method}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

    const joined = await connector.joinMilestoneTeam(opportunityGuid, milestoneGuid)
    expect(joined).toEqual({ opportunityId: opportunityGuid, milestoneId: milestoneGuid, onMilestoneTeam: true, alreadyMember: false })
    expect(posted[0]!.path).toContain('/systemusers(user-id)/Microsoft.Dynamics.CRM.AddUserToRecordTeam')
    expect(posted[0]!.body).toEqual({
      Record: { '@odata.type': 'Microsoft.Dynamics.CRM.msp_engagementmilestone', msp_engagementmilestoneid: milestoneGuid },
      TeamTemplate: { '@odata.type': 'Microsoft.Dynamics.CRM.teamtemplate', teamtemplateid: templateGuid }
    })

    // Second join finds the user already on the access team → alreadyMember, no duplicate action.
    expect((await connector.joinMilestoneTeam(opportunityGuid, milestoneGuid)).alreadyMember).toBe(true)
    expect(posted).toHaveLength(1)
  })

  it('removes the signed-in user from the milestone access team on leave (RemoveUserFromRecordTeam) and is idempotent', async () => {
    const posted: string[] = []
    let isMember = true
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/teamtemplates')) return json({ value: [{ teamtemplateid: templateGuid }] })
      if (url.pathname.endsWith('/teams') && method === 'GET') {
        const filter = url.searchParams.get('$filter') ?? ''
        expect(filter).toContain(`_teamtemplateid_value eq ${templateGuid}`)
        expect(filter).toContain('systemuserid eq user-id')
        // Membership is read via the all-teams query, never a per-record regardingobjectid filter
        // (Dataverse does not reliably support filtering the polymorphic team.regardingobjectid).
        expect(filter).not.toContain('_regardingobjectid_value eq')
        return json({ value: isMember ? [{ _regardingobjectid_value: milestoneGuid }] : [] })
      }
      if (url.pathname.endsWith('/Microsoft.Dynamics.CRM.RemoveUserFromRecordTeam') && method === 'POST') {
        posted.push(url.pathname)
        isMember = false
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${url} ${method}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

    const left = await connector.leaveMilestoneTeam(opportunityGuid, milestoneGuid)
    expect(left).toEqual({ opportunityId: opportunityGuid, milestoneId: milestoneGuid, onMilestoneTeam: false, alreadyAbsent: false })
    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain('/systemusers(user-id)/Microsoft.Dynamics.CRM.RemoveUserFromRecordTeam')
    // Idempotent when the user is already off the team.
    expect((await connector.leaveMilestoneTeam(opportunityGuid, milestoneGuid)).alreadyAbsent).toBe(true)
  })

  it('throws an actionable error when the Milestone Team access team is not set up (no silent success)', async () => {
    const actionPosts: string[] = []
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_engagementmilestones')) return json({ value: [{ msp_engagementmilestoneid: milestoneGuid, msp_name: 'Pilot' }] })
      if (url.pathname.endsWith('/teamtemplates')) return json({ value: [] })
      if (method === 'POST') { actionPosts.push(url.pathname); return new Response(null, { status: 204 }) }
      throw new Error(`Unexpected request: ${url} ${method}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)
    await expect(connector.joinMilestoneTeam(opportunityGuid, milestoneGuid)).rejects.toThrow(/not set up in this MSX environment/)
    await expect(connector.leaveMilestoneTeam(opportunityGuid, milestoneGuid)).rejects.toThrow(/not set up in this MSX environment/)
    // Nothing was written to MSX.
    expect(actionPosts).toHaveLength(0)
  })

  it('rejects non-GUID ids and milestones not in the opportunity', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_engagementmilestones')) return json({ value: [] })
      if (url.pathname.endsWith('/teamtemplates')) return json({ value: [{ teamtemplateid: templateGuid }] })
      if (url.pathname.endsWith('/teams')) return json({ value: [] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)
    await expect(connector.joinMilestoneTeam('not-a-guid', milestoneGuid)).rejects.toThrow(/GUID/)
    await expect(connector.joinMilestoneTeam(opportunityGuid, 'not-a-guid')).rejects.toThrow(/GUID/)
    await expect(connector.joinMilestoneTeam(opportunityGuid, milestoneGuid)).rejects.toThrow(/not in the selected opportunity/)
  })

  it('reflects access-team membership in onMilestoneTeam and lists discoverable milestones without a portfolio gate', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_engagementmilestones')) return json({ value: [{ msp_engagementmilestoneid: milestoneGuid, msp_name: 'Pilot' }] })
      if (url.pathname.endsWith('/teamtemplates')) return json({ value: [{ teamtemplateid: templateGuid }] })
      if (url.pathname.endsWith('/teams')) return json({ value: [{ _regardingobjectid_value: milestoneGuid }] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)
    const milestones = await connector.listDiscoverableMilestones(opportunityGuid)
    expect(milestones.map((item) => item.id)).toEqual([milestoneGuid])
    expect(milestones[0]!.onMilestoneTeam).toBe(true)
    await expect(connector.listDiscoverableMilestones('not-a-guid')).rejects.toThrow(/GUID/)
  })

  it('unions access-team milestone opportunities into the portfolio', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_dealteams')) return json({ value: [] })
      if (url.pathname.endsWith('/teamtemplates')) return json({ value: [{ teamtemplateid: templateGuid }] })
      if (url.pathname.endsWith('/teams')) return json({ value: [{ _regardingobjectid_value: milestoneGuid }] })
      if (url.pathname.endsWith('/msp_engagementmilestones')) return json({ value: [{ msp_engagementmilestoneid: milestoneGuid, _msp_opportunityid_value: opportunityGuid }] })
      if (url.pathname.endsWith('/opportunities')) return json({ value: [{ opportunityid: opportunityGuid, _parentaccountid_value: 'account-x', name: 'Milestone-only deal', msp_activesalesstage: 2, estimatedvalue: 1000, estimatedclosedate: '2027-01-01' }] })
      if (url.pathname.endsWith('/accounts')) return json({ value: [{ accountid: 'account-x', name: 'Acct X' }] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

    const opportunities = await connector.listOpportunities('account-x')
    expect(opportunities.map((item) => item.id)).toContain(opportunityGuid)
  })

  it('discovers the Milestone Team template id by name once and caches it', async () => {
    const templateQueries: string[] = []
    let isMember = false
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_engagementmilestones')) return json({ value: [{ msp_engagementmilestoneid: milestoneGuid, msp_name: 'Pilot' }] })
      if (url.pathname.endsWith('/teamtemplates')) {
        templateQueries.push(url.searchParams.get('$filter') ?? '')
        return json({ value: [{ teamtemplateid: templateGuid }] })
      }
      if (url.pathname.endsWith('/teams') && method === 'GET') return json({ value: isMember ? [{ _regardingobjectid_value: milestoneGuid }] : [] })
      if (url.pathname.endsWith('/Microsoft.Dynamics.CRM.AddUserToRecordTeam') && method === 'POST') { isMember = true; return new Response(null, { status: 204 }) }
      throw new Error(`Unexpected request: ${url} ${method}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch)

    await connector.joinMilestoneTeam(opportunityGuid, milestoneGuid)
    await connector.joinMilestoneTeam(opportunityGuid, milestoneGuid)
    expect(templateQueries).toHaveLength(1)
    expect(templateQueries[0]).toContain("teamtemplatename eq 'Milestone Team'")
  })

  it('uses an explicit team template id when configured, skipping name discovery', async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      if (url.pathname.endsWith('/WhoAmI')) return json({ UserId: 'user-id' })
      if (url.pathname.endsWith('/msp_engagementmilestones')) return json({ value: [{ msp_engagementmilestoneid: milestoneGuid, msp_name: 'Pilot' }] })
      if (url.pathname.endsWith('/teams') && method === 'GET') return json({ value: [] })
      if (url.pathname.endsWith('/Microsoft.Dynamics.CRM.AddUserToRecordTeam') && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toMatchObject({ TeamTemplate: { teamtemplateid: templateGuid } })
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${url} ${method}`)
    })
    const connector = new LiveMsxConnector({ getAccessToken: async () => 'token' }, request as typeof fetch, undefined, undefined, { milestoneTeam: { templateName: 'Milestone Team', templateId: templateGuid } })
    const joined = await connector.joinMilestoneTeam(opportunityGuid, milestoneGuid)
    expect(joined.onMilestoneTeam).toBe(true)
    // No /teamtemplates discovery call was made.
    expect(request.mock.calls.some(([input]) => String(input).includes('/teamtemplates'))).toBe(false)
  })
})
