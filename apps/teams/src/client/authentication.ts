import { app, nestedAppAuth, type FrameContexts } from '@microsoft/teams-js'
import {
  BrowserCacheLocation, InteractionRequiredAuthError, PublicClientApplication, createNestablePublicClientApplication,
  type IPublicClientApplication
} from '@azure/msal-browser'
import { teamsPublicConfigurationSchema } from '../../../../packages/common/contracts/collaboration.js'

export interface BrowserHostContext {
  embedded: boolean
  theme: string
  frameContext?: FrameContexts
  contextId?: string
  kind: 'channel' | 'chat' | 'meeting'
}
export async function initializeBrowserAuthentication(onTheme: (theme: string) => void) {
  const configuration = teamsPublicConfigurationSchema.parse(await (await fetch('/api/teams/config', { credentials: 'omit' })).json())
  let context: BrowserHostContext = { embedded: false, theme: 'default', kind: 'channel' }
  let naa = false
  if (window.parent !== window) {
    await app.initialize()
    const host = await app.getContext()
    context = {
      embedded: true, theme: host.app.theme, frameContext: host.page.frameContext,
      kind: host.meeting ? 'meeting' : host.channel ? 'channel' : 'chat',
      ...(host.channel?.id ? { contextId: host.channel.id } : host.chat?.id ? { contextId: host.chat.id } : {})
    }
    naa = nestedAppAuth.isNAAChannelRecommended()
    app.registerOnThemeChangeHandler(onTheme)
    onTheme(context.theme)
    app.notifySuccess()
  }
  let pca: IPublicClientApplication | undefined
  let currentClaims: string | undefined
  if (configuration.mode === 'live') {
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
    configuration, context,
    async getToken(interactive = false, claims?: string): Promise<string> {
      if (configuration.mode === 'sample') return ''
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
    async clear() { currentClaims = undefined; if (pca) await pca.clearCache() }
  }
}
export type BrowserAuthentication = Awaited<ReturnType<typeof initializeBrowserAuthentication>>
