import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { TlcDesktopApi } from '../../../apps/desktop/electron/preload/index.js'
import { createWebApiClient } from '../../../apps/desktop/renderer-revamp/src/data-client.js'
import { buildWebApiHandler } from '../../../apps/web/src/app.js'
import { buildLiveDataProvider } from '../../../apps/vscode-extension/src/live-provider-core.js'
import { withPresentationCache } from '../../../apps/vscode-extension/src/presentation-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { opportunitySchema, opportunityUpdateSchema, type Opportunity } from '../../../packages/common/contracts/index.js'
import { LiveMsxConnector } from '../../../packages/connectors/msx/live.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { createSampleWorkflowHost } from '../../../packages/orchestrator/workflows/index.js'

const electron = vi.hoisted(() => ({
  invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
  expose: vi.fn<(name: string, api: TlcDesktopApi) => void>()
}))
vi.mock('electron', () => ({ ipcRenderer: { invoke: electron.invoke }, contextBridge: { exposeInMainWorld: electron.expose } }))
import '../../../apps/desktop/electron/preload/index.js'

const opportunityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  electron.invoke.mockReset()
})

async function harness(surface: 'desktop' | 'web' | 'vscode') {
  const source = { comments: 'Existing forecast comments.', need: 'Preserve this customer need.', persist: true, status: 204 }
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    if (init?.method === 'PATCH') {
      expect(url.pathname).toBe(`/api/data/v9.2/opportunities(${opportunityId})`)
      if (source.status !== 204) return Response.json({}, { status: source.status })
      if (source.persist) {
        const update: Record<string, unknown> = JSON.parse(String(init.body))
        if (typeof update['msp_forecastcomments'] === 'string') source.comments = update['msp_forecastcomments']
        if (typeof update['description'] === 'string') source.need = update['description']
      }
      return new Response(null, { status: 204 })
    }
    if (url.pathname.endsWith('/WhoAmI')) return Response.json({ UserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
    if (url.pathname.endsWith('/msp_dealteams')) return Response.json({ value: [{ _msp_parentopportunityid_value: opportunityId }] })
    if (url.pathname.endsWith('/opportunities')) return Response.json({ value: [{
      opportunityid: opportunityId, _parentaccountid_value: accountId, name: 'Sanitized opportunity',
      msp_activesalesstage: 2, estimatedvalue: 100, description: source.need, msp_forecastcomments: source.comments
    }] })
    if (url.pathname.endsWith('/accounts')) return Response.json({ value: [{ accountid: accountId, name: 'Sanitized account' }] })
    if (url.pathname.endsWith('/teamtemplates') || url.pathname.endsWith('/msp_engagementmilestones')) return Response.json({ value: [] })
    throw new Error(`Unexpected source request: ${url.pathname}`)
  })
  const connector = () => new LiveMsxConnector({ getAccessToken: async () => 'synthetic' }, fetcher)
  const core = new ThinSliceOrchestrator(connector(), { getStageGuidance: vi.fn() })
  let save: (comments: string) => Promise<Opportunity>
  if (surface === 'desktop') {
    const api = electron.expose.mock.calls.find(([name]) => name === 'tlc')?.[1]
    if (!api) throw new Error('The Desktop preload did not expose its bridge.')
    electron.invoke.mockImplementation(async (channel, id, input) => {
      expect(channel).toBe('tlc:update-opportunity')
      return core.updateOpportunity(z.string().min(1).parse(id), opportunityUpdateSchema.parse(input))
    })
    save = (comments) => api.updateOpportunity(opportunityId, { comments })
  } else if (surface === 'web') {
    const handler = buildWebApiHandler({
      authenticate: () => ({ accessToken: 'synthetic', clientPrincipal: 'synthetic', userEmail: 'synthetic@example.test' }),
      createRuntime: () => Object.assign(core, {
        listMeetingTranscripts: vi.fn(), getMeetingTranscript: vi.fn(), proposeMeetingChangeSet: vi.fn(), applyMeetingChangeSet: vi.fn()
      })
    })
    const server = createServer((request, response) => { void handler(request, response) })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('The Web parity listener did not start.')
    const client = createWebApiClient((input, init) => fetch(new URL(String(input), `http://127.0.0.1:${address.port}`), init))
    save = (comments) => client.updateOpportunity(opportunityId, { comments })
  } else {
    const provider = withPresentationCache(buildLiveDataProvider({
      orchestrator: core, host: createSampleWorkflowHost(), account: 'synthetic@example.test', dispose: async () => undefined
    }))
    cleanup.push(() => provider.dispose())
    await provider.listOpportunities(accountId)
    save = async (comments) => {
      const response = await routeBridgeMessage(provider, {
        kind: 'request', id: 'save-comments', method: 'updateOpportunity', params: { opportunityId, update: { comments } }
      })
      if (!response.ok) throw new Error(response.error.message)
      return opportunitySchema.parse(response.result)
    }
  }
  return { save, source, fetcher, reload: async () => (await connector().listOpportunities(accountId))[0] }
}

describe.each(['desktop', 'web', 'vscode'] as const)('%s opportunity comment persistence', (surface) => {
  it('writes Forecast Comments through the real connector and survives a fresh source session', async () => {
    const { save, source, fetcher, reload } = await harness(surface)
    await expect(save('Reviewed next steps.')).resolves.toMatchObject({ id: opportunityId, comments: 'Reviewed next steps.' })
    await expect(reload()).resolves.toMatchObject({ comments: 'Reviewed next steps.' })
    expect(source.need).toBe('Preserve this customer need.')
    const patches = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(JSON.parse(String(patches[0]?.[1]?.body))).toEqual({ msp_forecastcomments: 'Reviewed next steps.' })
  })

  it('propagates a source rejection instead of returning a saved opportunity', async () => {
    const { save, source, reload } = await harness(surface)
    source.status = 403
    await expect(save('Rejected comment.')).rejects.toThrow(surface === 'web'
      ? 'Current source access was denied.' : 'MSX update failed with status 403')
    await expect(reload()).resolves.toMatchObject({ comments: 'Existing forecast comments.' })
  })

  it('propagates a failed read-back instead of acknowledging a non-persisted comment', async () => {
    const { save, source, reload } = await harness(surface)
    source.persist = false
    await expect(save('Not actually persisted.')).rejects.toThrow(surface === 'web'
      ? 'The server could not complete the request.' : 'MSX did not confirm the saved opportunity comments')
    await expect(reload()).resolves.toMatchObject({ comments: 'Existing forecast comments.' })
  })
})
