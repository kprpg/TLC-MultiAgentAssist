import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { TeamsApiClient } from '../../../apps/teams/src/client/data-client.js'
import { DataModeSwitcher } from '../../../apps/teams/src/client/data-mode-switcher.js'
import { teamsDataModesSchema } from '../../../packages/common/contracts/teams-data-mode.js'
import { discoverableOpportunitySchema, portfolioIndexSchema, type DiscoverySnapshot } from '../../../packages/common/contracts/index.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('mode-scoped Teams clients', () => {
  it('coalesces pending and completed session reads until Refresh, and one subscriber cannot abort the other', async () => {
    let complete: (response: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => { complete = resolve })
    const snapshot: DiscoverySnapshot = {
      contractVersion: '1.0', generatedAt: '2026-10-21T00:00:00.000Z',
      accounts: [{ id: 'account', name: 'Sanitized customer', segment: 'test' }], portfolioOpportunities: [], milestoneTeamOpportunityIds: [],
      opportunities: [{ id: 'opportunity', accountId: 'account', name: 'Sanitized opportunity', recordedStage: 1, value: 0,
        currency: 'USD', closeDate: '2099-01-01', domain: 'infra', onDealTeam: false }]
    }
    const transport = vi.fn<typeof fetch>().mockReturnValueOnce(pending).mockImplementation(async () => Response.json(snapshot))
    vi.stubGlobal('fetch', transport)
    const client = new TeamsApiClient(async () => '')
    const controller = new AbortController()
    const first = client.operation('discoverOpportunities', { domain: 'infra' }, z.array(discoverableOpportunitySchema), controller.signal)
    const second = client.operation('discoverOpportunities', { domain: 'infra' }, z.array(discoverableOpportunitySchema))
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce())
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    complete(Response.json(snapshot))
    expect(await second).toEqual(snapshot.opportunities)
    expect(await client.operation('discoverOpportunities', { domain: 'infra' }, z.array(discoverableOpportunitySchema))).toEqual(snapshot.opportunities)
    expect(await client.operation('discoverOpportunities', { domain: 'services' }, z.array(discoverableOpportunitySchema))).toEqual([])
    expect(transport).toHaveBeenCalledOnce()
    client.refreshSources()
    expect(await client.operation('discoverOpportunities', { domain: 'infra' }, z.array(discoverableOpportunitySchema))).toEqual(snapshot.opportunities)
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('does not issue a request after its old mode is disposed while token acquisition is pending', async () => {
    let complete: ((token: string) => void) | undefined
    const token = new Promise<string>((resolve) => { complete = resolve })
    const transport = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', transport)
    const client = new TeamsApiClient(() => token)
    const request = client.request('session', z.unknown())
    client.dispose()
    complete?.('old-mode-capability')
    await expect(request).rejects.toMatchObject({ code: 'data_mode_changed' })
    expect(transport).not.toHaveBeenCalled()
  })
  it('rechecks connection identity before returning a queued memory-cache result', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ contractVersion: '1.0', accounts: [], opportunities: [] }))
    vi.stubGlobal('fetch', transport)
    let current = true
    const client = new TeamsApiClient(async () => 'fixture', undefined, () => current)
    await client.operation('getPortfolioIndex', { contractVersion: '1.0' }, portfolioIndexSchema)
    const pending = client.operation('getPortfolioIndex', { contractVersion: '1.0' }, portfolioIndexSchema)
    queueMicrotask(() => { current = false })
    await expect(pending).rejects.toMatchObject({ code: 'local_connection_changed' })
    expect(transport).toHaveBeenCalledOnce()
  })
  it('does not fetch a source for an already aborted cached read', async () => {
    const transport = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', transport)
    const controller = new AbortController()
    controller.abort()
    const client = new TeamsApiClient(async () => '')
    await expect(client.operation('getPortfolioIndex', { contractVersion: '1.0' }, portfolioIndexSchema, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(transport).not.toHaveBeenCalled()
  })
  it('rejects an old response rather than letting it populate the newly selected mode', async () => {
    let complete: ((response: Response) => void) | undefined
    const pending = new Promise<Response>((resolve) => { complete = resolve })
    const transport = vi.fn<typeof fetch>().mockReturnValueOnce(pending)
    vi.stubGlobal('fetch', transport)
    const client = new TeamsApiClient(async () => 'fixture-live-capability')
    const request = client.request('operations/listAccounts', z.array(z.string()))
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce())
    client.dispose()
    complete?.(Response.json(['old-mode-private-fixture']))
    await expect(request).rejects.toMatchObject({ code: 'data_mode_changed' })
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })
  it('does not download a stale document after switching modes', async () => {
    let complete: ((blob: Blob) => void) | undefined
    const pending = new Promise<Blob>((resolve) => { complete = resolve })
    const response = Response.json({})
    const blob = vi.spyOn(response, 'blob').mockReturnValue(pending)
    const objectUrl = vi.spyOn(URL, 'createObjectURL')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response))
    const client = new TeamsApiClient(async () => '')
    const download = client.download('documents/export', {}, 'fixture.docx')
    await vi.waitFor(() => expect(blob).toHaveBeenCalledOnce())
    client.dispose()
    complete?.(new Blob(['old-mode-document-fixture']))
    await expect(download).rejects.toMatchObject({ code: 'data_mode_changed' })
    expect(objectUrl).not.toHaveBeenCalled()
  })
  it('routes Sample without a Live bearer and refuses a session labelled with the wrong mode', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
      contractVersion: '1.0', mode: 'sample', roles: ['TLC.Teams.User'], displayName: 'Sample user'
    }))
    vi.stubGlobal('fetch', transport)
    const sample = new TeamsApiClient(async () => '', undefined, undefined, '/api/teams/sample', 'sample')
    expect((await sample.session()).mode).toBe('sample')
    expect(transport.mock.calls[0]?.[0]).toBe('/api/teams/sample/session')
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false)
    const live = new TeamsApiClient(async () => 'fixture-live-token', undefined, undefined, '/api/teams/live', 'live')
    await expect(live.session()).rejects.toMatchObject({ code: 'data_mode_session_mismatch' })
  })
  it('renders a confirmable selector that disables unavailable Live mode and locks during a write', () => {
    const catalog = teamsDataModesSchema.parse({
      contractVersion: '1.0', initialMode: 'sample', runtimeMode: 'sample',
      runtimeAuthentication: 'hosted-obo', availableModes: ['sample']
    })
    const html = renderToStaticMarkup(createElement(DataModeSwitcher, {
      catalog, mode: 'sample', locked: true, error: '', onSwitch: vi.fn()
    }))
    expect(html).toContain('Sample - SQLite')
    expect(html).toContain('value="live" disabled=""')
    expect(html).toContain('unsaved drafts')
    expect(html).toContain('does not cancel or undo work already submitted')
    expect(html).toContain('Wait for the current write confirmation')
  })
})
