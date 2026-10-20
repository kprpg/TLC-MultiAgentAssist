import { app, nestedAppAuth, type FrameContexts } from '@microsoft/teams-js'
import {
  BrowserCacheLocation, InteractionRequiredAuthError, PublicClientApplication, createNestablePublicClientApplication,
  type IPublicClientApplication
} from '@azure/msal-browser'
import { teamsPublicConfigurationSchema } from '../../../../packages/common/contracts/collaboration.js'
import { z } from 'zod'
import { LocalBrowserConnection } from './local-connection.js'

export interface BrowserHostContext {
  embedded: boolean
  theme: string
  frameContext?: FrameContexts
  contextId?: string
  kind: 'channel' | 'chat' | 'meeting'
  tenantId?: string
  userId?: string
}
export async function initializeBrowserAuthentication(onTheme: (theme: string) => void) {
  const configuration = teamsPublicConfigurationSchema.parse(await (await fetch('/api/teams/config', { credentials: 'omit' })).json())
  let context: BrowserHostContext = { embedded: false, theme: 'default', kind: 'channel' }
  let naa = false
  const nativeHost = 'nativeInterface' in window && typeof window.nativeInterface === 'object' && window.nativeInterface !== null &&
    'framelessPostMessage' in window.nativeInterface && typeof window.nativeInterface.framelessPostMessage === 'function'
  if (window.parent !== window || nativeHost) {
    await app.initialize()
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
    app.registerOnThemeChangeHandler(onTheme)
    onTheme(context.theme)
    app.notifySuccess()
  }
  let pca: IPublicClientApplication | undefined
  let currentClaims: string | undefined
  const localConnection = 'authentication' in configuration ? new LocalBrowserConnection(context) : undefined
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
  return {
    configuration, context, localConnection,
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
    async clear() { currentClaims = undefined; localConnection?.clear(); if (pca) await pca.clearCache() }
  }
}
export type BrowserAuthentication = Awaited<ReturnType<typeof initializeBrowserAuthentication>>
