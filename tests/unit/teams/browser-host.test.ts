import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FrameContexts } from '@microsoft/teams-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBrowserAuthentication, type BrowserHostContext } from '../../../apps/teams/src/client/authentication.js'
import { ContextWorkspace } from '../../../apps/teams/src/client/context.js'
import { TeamsApiClient } from '../../../apps/teams/src/client/data-client.js'
import { localConnectionVersion, nativeCapabilities } from '../../../packages/common/contracts/local-connection.js'

const hooks = vi.hoisted(() => {
  const effects: Array<() => unknown> = []
  return { effects }
})
const sdk = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  getContext: vi.fn(async () => ({ app: { theme: 'dark' }, page: { frameContext: 'content' } })),
  registerOnThemeChangeHandler: vi.fn(),
  notifySuccess: vi.fn(),
  isSupported: vi.fn(() => true),
  setValidityState: vi.fn(),
  registerOnSaveHandler: vi.fn(),
  setConfig: vi.fn(async () => undefined)
}))

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect) }
}))
vi.mock('@microsoft/teams-js', () => ({
  FrameContexts: { content: 'content', settings: 'settings', sidePanel: 'sidePanel' },
  app: {
    initialize: sdk.initialize, getContext: sdk.getContext,
    registerOnThemeChangeHandler: sdk.registerOnThemeChangeHandler, notifySuccess: sdk.notifySuccess
  },
  nestedAppAuth: { isNAAChannelRecommended: () => false },
  pages: { config: {
    isSupported: sdk.isSupported, setValidityState: sdk.setValidityState,
    registerOnSaveHandler: sdk.registerOnSaveHandler, setConfig: sdk.setConfig
  } }
}))

beforeEach(() => {
  vi.clearAllMocks()
  hooks.effects.length = 0
  sdk.isSupported.mockReturnValue(true)
  sdk.getContext.mockResolvedValue({ app: { theme: 'dark' }, page: { frameContext: 'content' } })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ mode: 'sample' })))
  vi.stubGlobal('window', { parent: {} })
})
afterEach(() => { vi.unstubAllGlobals() })

async function renderContext(host: BrowserHostContext) {
  const client = new TeamsApiClient(async () => '')
  vi.spyOn(client, 'operation').mockResolvedValue([])
  const html = renderToStaticMarkup(createElement(ContextWorkspace, { client, host, selection: null }))
  for (const effect of hooks.effects.splice(0)) effect()
  await Promise.resolve()
  return html
}

describe('Teams browser host context', () => {
  it('reuses SDK initialization and a valid same-page local approval only while the Teams identity/context still matches', async () => {
    const host = {
      app: { theme: 'dark' }, page: { frameContext: 'content' }, chat: { id: 'original-chat' },
      user: { id: '11111111-1111-4111-8111-111111111111', tenant: { id: '22222222-2222-4222-8222-222222222222' } }
    }
    sdk.getContext.mockResolvedValue(host)
    const token = 'L'.repeat(43)
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ contractVersion: localConnectionVersion, mode: 'live', authentication: 'local-interactive', capabilities: nativeCapabilities }))
      .mockResolvedValueOnce(Response.json({ contractVersion: localConnectionVersion, requestId: '33333333-3333-4333-8333-333333333333', userCode: 'ABCDEF12', state: 'pending-owner-approval', expiresAt }))
      .mockResolvedValueOnce(Response.json({ contractVersion: localConnectionVersion, state: 'paired', token, expiresAt })))
    const authentication = await initializeBrowserAuthentication(() => undefined, '/api/teams/live')
    await authentication.localConnection?.begin()
    await authentication.localConnection?.poll()
    expect(await authentication.activate(() => undefined)).toBe(true)
    expect(await authentication.getToken()).toBe(token)
    expect(sdk.initialize).toHaveBeenCalledOnce()
    const changed = { ...host, user: { ...host.user, id: '44444444-4444-4444-8444-444444444444' } }
    sdk.getContext.mockResolvedValue(changed)
    expect(await authentication.activate(() => undefined)).toBe(false)
    await expect(authentication.getToken()).rejects.toThrow(/pair/i)
    expect(sdk.initialize).toHaveBeenCalledOnce()
  })
  it.each(['tenant', 'context', 'frame'] as const)('rejects cached activation after a Teams %s change', async (change) => {
    const host = {
      app: { theme: 'dark' }, page: { frameContext: 'content' }, chat: { id: 'original-chat' },
      user: { id: '11111111-1111-4111-8111-111111111111', tenant: { id: '22222222-2222-4222-8222-222222222222' } }
    }
    sdk.getContext.mockResolvedValue(host)
    const authentication = await initializeBrowserAuthentication(() => undefined)
    const changed = change === 'tenant' ? { ...host, user: { ...host.user, tenant: { id: '44444444-4444-4444-8444-444444444444' } } }
      : change === 'context' ? { ...host, chat: { id: 'different-chat' } } : { ...host, page: { frameContext: 'sidePanel' } }
    sdk.getContext.mockResolvedValue(changed)
    expect(await authentication.activate(() => undefined)).toBe(false)
  })
  it('uses local pairing rather than browser source sign-in for the explicit native strategy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      contractVersion: localConnectionVersion, mode: 'live', authentication: 'local-interactive', capabilities: nativeCapabilities
    })))
    const authentication = await initializeBrowserAuthentication(() => undefined)
    expect(authentication.localConnection).toBeDefined()
    await expect(authentication.getToken(true)).rejects.toThrow(/pair/i)
  })
  it.each([FrameContexts.content, FrameContexts.settings])('retains the SDK frame context for embedded %s pages', async (frameContext) => {
    sdk.getContext.mockResolvedValue({ app: { theme: 'dark' }, page: { frameContext } })
    const onTheme = vi.fn()
    const authentication = await initializeBrowserAuthentication(onTheme)
    expect(authentication.context).toMatchObject({ embedded: true, frameContext, theme: 'dark' })
    expect(onTheme).toHaveBeenCalledWith('dark')
    expect(await authentication.getToken()).toBe('')
  })
  it('does not initialize the Teams SDK for a standalone browser', async () => {
    const browser = { parent: {} }
    browser.parent = browser
    vi.stubGlobal('window', browser)
    const authentication = await initializeBrowserAuthentication(() => undefined)
    expect(authentication.context).toEqual({ embedded: false, theme: 'default', kind: 'channel' })
    expect(sdk.initialize).not.toHaveBeenCalled()
  })
  it('initializes the public SDK for a frameless native Teams webview, not just iframe hosts', async () => {
    const native = { parent: {}, nativeInterface: { framelessPostMessage: vi.fn() } }
    native.parent = native
    vi.stubGlobal('window', native)
    const authentication = await initializeBrowserAuthentication(() => undefined)
    expect(sdk.initialize).toHaveBeenCalledOnce()
    expect(authentication.context.embedded).toBe(true)
  })
  it('does not mistake an unrelated or malformed nativeInterface object for a Teams host', async () => {
    const browser = { parent: {}, nativeInterface: { framelessPostMessage: 'not-a-bridge' } }
    browser.parent = browser
    vi.stubGlobal('window', browser)
    const authentication = await initializeBrowserAuthentication(() => undefined)
    expect(authentication.context.embedded).toBe(false)
    expect(sdk.initialize).not.toHaveBeenCalled()
  })
})

describe('Teams configuration-frame APIs', () => {
  const nonSettingsHosts: Array<{ name: string; host: BrowserHostContext }> = [
    { name: 'standalone', host: { embedded: false, theme: 'default', kind: 'channel' } },
    { name: 'personal content', host: { embedded: true, frameContext: FrameContexts.content, theme: 'default', kind: 'chat' } },
    { name: 'side panel', host: { embedded: true, frameContext: FrameContexts.sidePanel, theme: 'default', kind: 'meeting' } },
    { name: 'unknown embedded frame', host: { embedded: true, theme: 'default', kind: 'chat' } }
  ]
  it.each(nonSettingsHosts)('keeps Context settings usable without tab-save hooks in $name', async ({ host }) => {
    expect(await renderContext(host)).toContain('Configure a Teams context')
    expect(sdk.isSupported).not.toHaveBeenCalled()
    expect(sdk.setValidityState).not.toHaveBeenCalled()
    expect(sdk.registerOnSaveHandler).not.toHaveBeenCalled()
    expect(sdk.setConfig).not.toHaveBeenCalled()
  })
  it('registers the existing tab-save behavior in a supported settings frame', async () => {
    await renderContext({ embedded: true, frameContext: FrameContexts.settings, theme: 'default', kind: 'channel' })
    expect(sdk.isSupported).toHaveBeenCalledOnce()
    expect(sdk.setValidityState).toHaveBeenCalledWith(false)
    expect(sdk.registerOnSaveHandler).toHaveBeenCalledOnce()
  })
  it('does not register tab-save hooks if the settings capability is unavailable', async () => {
    sdk.isSupported.mockReturnValue(false)
    await renderContext({ embedded: true, frameContext: FrameContexts.settings, theme: 'default', kind: 'channel' })
    expect(sdk.setValidityState).not.toHaveBeenCalled()
    expect(sdk.registerOnSaveHandler).not.toHaveBeenCalled()
  })
})
