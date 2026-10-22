import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../packages/connectors/msx/live.js'

const opportunityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const originalNeed = 'Customer requirements must remain unchanged.'
const originalComments = 'Existing forecast comment history.'

function harness(cachePortfolio = true) {
  const source = {
    need: originalNeed,
    comments: originalComments as string | null,
    persist: true,
    patchStatus: 204,
    readBackStatus: 200,
    writes: 0,
    stage: 2
  }
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    if (init?.method === 'PATCH') {
      expect(url.pathname).toBe(`/api/data/v9.2/opportunities(${opportunityId})`)
      source.writes++
      if (source.patchStatus !== 204) return Response.json({ error: { message: 'Synthetic source rejection.' } }, { status: source.patchStatus })
      if (source.persist) {
        const body: Record<string, unknown> = JSON.parse(String(init.body))
        if (typeof body['description'] === 'string') source.need = body['description']
        if (typeof body['msp_forecastcomments'] === 'string') source.comments = body['msp_forecastcomments']
        if (typeof body['msp_activesalesstage'] === 'number') source.stage = body['msp_activesalesstage']
      }
      return new Response(null, { status: 204 })
    }
    if (url.pathname.endsWith('/WhoAmI')) return Response.json({ UserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
    if (url.pathname.endsWith('/msp_dealteams')) return Response.json({ value: [{ _msp_parentopportunityid_value: opportunityId }] })
    if (url.pathname.endsWith('/opportunities')) {
      if (source.writes && source.readBackStatus !== 200) return Response.json({}, { status: source.readBackStatus })
      return Response.json({ value: [{
        opportunityid: opportunityId, _parentaccountid_value: accountId, name: 'Sanitized opportunity',
        estimatedvalue: 100, msp_activesalesstage: source.stage,
        description: source.need, msp_forecastcomments: source.comments
      }] })
    }
    if (url.pathname.endsWith('/accounts')) return Response.json({ value: [{ accountid: accountId, name: 'Sanitized account' }] })
    if (url.pathname.endsWith('/teamtemplates') || url.pathname.endsWith('/msp_engagementmilestones')) return Response.json({ value: [] })
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
  const createConnector = () => new LiveMsxConnector(
    { getAccessToken: async () => 'synthetic-token' }, request, undefined, undefined,
    { stageCodes: { 3: 3 } }, undefined, { cachePortfolio }
  )
  return { source, request, connector: createConnector(), createConnector }
}

describe('MSX opportunity Forecast Comments persistence', () => {
  it('reads Forecast Comments rather than the unrelated Need field', async () => {
    const { connector, request } = harness()
    expect((await connector.listOpportunities(accountId))[0]?.comments).toBe(originalComments)
    const opportunityRead = request.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith('/opportunities'))
    const fields = new URL(String(opportunityRead?.[0])).searchParams.get('$select')?.split(',')
    expect(fields).toContain('msp_forecastcomments')
    expect(fields).not.toContain('description')
  })

  it('persists comments on the opportunity and preserves Need across a new connector session', async () => {
    const { connector, createConnector, source, request } = harness()
    await expect(connector.updateOpportunity(opportunityId, { comments: 'Confirmed customer next steps.' }))
      .resolves.toMatchObject({ id: opportunityId, comments: 'Confirmed customer next steps.' })
    expect(source.comments).toBe('Confirmed customer next steps.')
    expect(source.need).toBe(originalNeed)
    const patch = request.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ msp_forecastcomments: 'Confirmed customer next steps.' })
    expect(new Headers(patch?.[1]?.headers).get('If-Match')).toBe('*')
    expect((await createConnector().listOpportunities(accountId))[0]?.comments).toBe('Confirmed customer next steps.')
    expect(source.writes).toBe(1)
  })

  it.each(['process', 'request', 'fresh'] as const)('does not acknowledge stale comments from the %s read cache', async (scope) => {
    const { connector, source } = harness(scope !== 'request')
    const save = async () => {
      expect((await connector.listOpportunities(accountId))[0]?.comments).toBe(originalComments)
      await expect(connector.updateOpportunity(opportunityId, { comments: 'Persisted after cached read.' }))
        .resolves.toMatchObject({ comments: 'Persisted after cached read.' })
      expect((await connector.getOpportunityContext(opportunityId)).opportunity.comments).toBe('Persisted after cached read.')
    }
    if (scope === 'fresh') await connector.withFreshReadContext(save)
    else if (scope === 'request') await connector.withReadContext(save)
    else await save()
    expect(source.comments).toBe('Persisted after cached read.')
    expect(source.need).toBe(originalNeed)
  })

  it('does not report success when MSX accepts a PATCH but the stored comments do not match', async () => {
    const { connector, source } = harness()
    source.persist = false
    await expect(connector.updateOpportunity(opportunityId, { comments: 'Not persisted by the source.' }))
      .rejects.toThrow('MSX did not confirm the saved opportunity comments')
    expect(source.comments).toBe(originalComments)
    expect(source.writes).toBe(1)
  })

  it('surfaces an unreadable post-write result without repeating the write', async () => {
    const { connector, source } = harness()
    source.readBackStatus = 403
    await expect(connector.updateOpportunity(opportunityId, { comments: 'Written but not readable.' }))
      .rejects.toMatchObject({ status: 403 })
    expect(source.comments).toBe('Written but not readable.')
    expect(source.writes).toBe(1)
  })

  it.each([401, 403, 412, 500])('surfaces a rejected HTTP %s write rather than claiming success', async (status) => {
    const { connector, source } = harness()
    source.patchStatus = status
    await expect(connector.updateOpportunity(opportunityId, { comments: 'Must not appear saved.' }))
      .rejects.toMatchObject({ status })
    expect(source.comments).toBe(originalComments)
    expect(source.need).toBe(originalNeed)
    expect(source.writes).toBe(1)
  })

  it('preserves reviewed concurrency tokens when writing comments', async () => {
    const { connector, request } = harness()
    await connector.withExpectedVersions({ [`opportunities(${opportunityId})`]: 'W/"123"' },
      () => connector.updateOpportunity(opportunityId, { comments: 'Reviewed source update.' }))
    const patch = request.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(new Headers(patch?.[1]?.headers).get('If-Match')).toBe('W/"123"')
  })

  it('supports clearing comments without falling back to Need', async () => {
    const { connector, createConnector, source } = harness()
    await expect(connector.updateOpportunity(opportunityId, { comments: '' })).resolves.toMatchObject({ comments: '' })
    expect(source.comments).toBe('')
    source.comments = null
    expect((await createConnector().listOpportunities(accountId))[0]).not.toHaveProperty('comments')
    expect(source.need).toBe(originalNeed)
  })

  it('keeps stage audit notes in Forecast Comments and refreshes scoped reads', async () => {
    const { connector, source } = harness()
    await connector.withFreshReadContext(async () => {
      await connector.listOpportunities(accountId)
      await expect(connector.updateOpportunityStage(opportunityId, 3, 'Reviewed stage advance.'))
        .resolves.toMatchObject({ recordedStage: 3, comments: `${originalComments}\n\nReviewed stage advance.` })
    })
    expect(source.comments).toBe(`${originalComments}\n\nReviewed stage advance.`)
    expect(source.need).toBe(originalNeed)
  })

  it('does not dispatch writes outside the accessible opportunity portfolio', async () => {
    const { connector, source } = harness()
    await expect(connector.updateOpportunity('dddddddd-dddd-4ddd-8ddd-dddddddddddd', { comments: 'Outside scope.' }))
      .rejects.toThrow('not in the signed-in user')
    expect(source.writes).toBe(0)
  })
})
