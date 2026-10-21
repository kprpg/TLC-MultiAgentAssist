import { app, nestedAppAuth, type FrameContexts } from '@microsoft/teams-js'
import {
  BrowserCacheLocation, InteractionRequiredAuthError, PublicClientApplication, createNestablePublicClientApplication,
  type IPublicClientApplication
} from '@azure/msal-browser'
import { teamsPublicConfigurationSchema } from '../../../../packages/common/contracts/collaboration.js'
import { z } from 'zod'
import { LocalBrowserConnection } from './local-connection.js'
import type { TeamsApiBasePath } from '../../../../packages/common/contracts/teams-data-mode.js'

export interface BrowserHostContext {
  embedded: boolean
  theme: string
  frameContext?: FrameContexts
  contextId?: string
  kind: 'channel' | 'chat' | 'meeting'
  tenantId?: string
  userId?: string
}
async function readBrowserHost(onTheme: (theme: string) => void, reuseHost: boolean) {
  let context: BrowserHostContext = { embedded: false, theme: 'default', kind: 'channel' }
  let naa = false
  const nativeHost = 'nativeInterface' in window && typeof window.nativeInterface === 'object' && window.nativeInterface !== null &&
    'framelessPostMessage' in window.nativeInterface && typeof window.nativeInterface.framelessPostMessage === 'function'
  if (window.parent !== window || nativeHost) {
    if (!reuseHost) await app.initialize()
    const host = await app.getContext()
    const tenantId = z.uuid().safeParse(host.user?.tenant?.id)
    const userId = z.uuid().safeParse(host.user?.id)
    context = {
      embedded: true, theme: host.app.theme, frameContext: host.page.frameContext,
      kind: host.meeting ? 'meeting' : host.channel ? 'channel' : 'chat',
      ...(tenantId.success ? { tenantId: tenantId.data } : {}),
      ...(userId.success ? { userId: userId.data } : {}),
      ...(host.channel?.id ? { contextId: host.channel.id } : host.chat?.id ? { contextId: host.chat.id } : {})
    }
    naa = nestedAppAuth.isNAAChannelRecommended()
    app.registerOnThemeChangeHandler((value) => { context.theme = value; onTheme(value) })
    onTheme(context.theme)
    if (!reuseHost) app.notifySuccess()
  }
  return { context, naa }
}
const hostIdentity = (context: BrowserHostContext) => JSON.stringify([
  context.embedded, context.frameContext, context.kind, context.contextId, context.tenantId, context.userId
])

export async function initializeBrowserAuthentication(onTheme: (theme: string) => void, apiBasePath: TeamsApiBasePath = '/api/teams', reuseHost = false) {
  const response = await fetch(`${apiBasePath}/config`, { credentials: 'omit' })
  if (!response.ok) throw new Error(`Data-mode configuration is unavailable (HTTP ${response.status}).`)
  const configuration = teamsPublicConfigurationSchema.parse(await response.json())
  const { context, naa } = await readBrowserHost(onTheme, reuseHost)
  let pca: IPublicClientApplication | undefined
  let currentClaims: string | undefined
  const localConnection = 'authentication' in configuration ? new LocalBrowserConnection(context, apiBasePath) : undefined
  if (configuration.mode === 'live' && !('authentication' in configuration)) {
    const settings = {
      auth: {
        clientId: configuration.spaClientId, authority: `https://login.microsoftonline.com/${configuration.tenantId}`,
        redirectUri: `${window.location.origin}/auth/callback`
      },
      cache: { cacheLocation: BrowserCacheLocation.MemoryStorage }
    }
    if (naa) pca = await createNestablePublicClientApplication(settings)
    else { pca = new PublicClientApplication(settings); await pca.initialize() }
  }
  const clear = async () => { currentClaims = undefined; localConnection?.clear(); if (pca) await pca.clearCache() }
  return {
    configuration, context, localConnection, apiBasePath,
    async activate(onTheme: (theme: string) => void): Promise<boolean> {
      const fresh = await readBrowserHost(onTheme, true)
      if (hostIdentity(fresh.context) !== hostIdentity(context)) { await clear(); return false }
      context.theme = fresh.context.theme
      return true
    },
    async getToken(interactive = false, claims?: string): Promise<string> {
      if (configuration.mode === 'sample') return ''
      if (localConnection) return localConnection.getToken()
      if ('authentication' in configuration) throw new Error('The local connection client is unavailable.')
      if (!pca) throw new Error('The authentication client is unavailable.')
      if (claims) currentClaims = claims
      const account = pca.getActiveAccount()
      const request = { scopes: [configuration.apiScope], ...(account ? { account } : {}), ...(currentClaims ? { claims: currentClaims } : {}) }
      if (account) {
        try { return (await pca.acquireTokenSilent(request)).accessToken } catch (error) {
          if (!(error instanceof InteractionRequiredAuthError)) throw error
          if (!interactive) throw new Error('Sign in to continue with your corporate FTE account.', { cause: error })
        }
      }
      if (!interactive) throw new Error('Sign in to continue with your corporate FTE account.')
      const result = await pca.acquireTokenPopup(request)
      pca.setActiveAccount(result.account)
      return result.accessToken
    },
    clear
  }
}
export type BrowserAuthentication = Awaited<ReturnType<typeof initializeBrowserAuthentication>>
