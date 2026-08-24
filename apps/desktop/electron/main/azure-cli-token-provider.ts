import { AzureCliCredential } from '@azure/identity'
import type { AuthStatus } from '../../../../packages/common/index.js'
import type { MsxAccessTokenProvider } from '../../../../packages/connectors/msx/index.js'

const msxScope = 'https://microsoftsales.crm.dynamics.com/.default'
const corpDomain = '@microsoft.com'
const refreshBufferMs = 5 * 60 * 1000

interface AccessToken {
  token: string
  expiresOnTimestamp: number
}

interface TokenCredential {
  getToken(scope: string): Promise<AccessToken | null>
}

export class AzureCliMsxTokenProvider implements MsxAccessTokenProvider {
  private cachedToken: AccessToken | undefined
  private corpId: string | undefined

  constructor(
    private readonly credential: TokenCredential = new AzureCliCredential({ processTimeoutInMs: 30_000 })
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresOnTimestamp > Date.now() + refreshBufferMs) {
      return this.cachedToken.token
    }

    const accessToken = await this.credential.getToken(msxScope)
    if (!accessToken) throw new Error('Azure CLI did not return an MSX access token.')

    this.corpId = readMicrosoftCorpId(accessToken.token)
    this.cachedToken = accessToken
    return accessToken.token
  }

  async getAuthStatus(): Promise<AuthStatus> {
    try {
      await this.getAccessToken()
      return {
        state: 'ready',
        ...(this.corpId ? { displayName: this.corpId } : {}),
        detail: `Azure CLI is signed in as ${this.corpId ?? 'a Microsoft corporate user'}.`
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Azure CLI authentication failed.'
      const normalized = detail.toLowerCase()
      const state = normalized.includes('could not be found') || normalized.includes('not recognized')
        ? 'cli-missing'
        : normalized.includes('aadsts65001') || normalized.includes('consent')
          ? 'consent-required'
          : normalized.includes('aadsts50020') || normalized.includes('tenant') || normalized.includes('corporate identity')
            ? 'tenant-mismatch'
            : 'login-required'
      return { state, detail }
    }
  }
}

export function readMicrosoftCorpId(accessToken: string): string {
  const payloadPart = accessToken.split('.')[1]
  if (!payloadPart) throw new Error('Azure CLI returned an invalid MSX access token.')

  let claims: Record<string, unknown>
  try {
    claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new Error('Azure CLI returned an unreadable MSX access token.')
  }

  const corpId = [claims['preferred_username'], claims['upn'], claims['unique_name']]
    .find((claim): claim is string => typeof claim === 'string' && claim.toLowerCase().endsWith(corpDomain))
  if (!corpId) {
    throw new Error('The active Azure CLI token is not a Microsoft corporate identity. Sign in with your @microsoft.com CORP ID.')
  }
  return corpId
}