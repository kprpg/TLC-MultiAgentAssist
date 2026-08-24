import { InteractiveBrowserCredential } from '@azure/identity'
import type { AuthStatus } from '../../../../packages/common/index.js'

const defaultClientId = 'd4a694ba-9ed0-4467-9c06-f7dfe41ceb8c'
const defaultTenantId = '72f988bf-86f1-41af-91ab-2d7cd011db47'
const graphScope = 'https://graph.microsoft.com/Sites.Read.All'
const graphAudiences = new Set([
  '00000003-0000-0000-c000-000000000000',
  'https://graph.microsoft.com'
])
const corpDomain = '@microsoft.com'

interface AccessToken {
  token: string
  expiresOnTimestamp: number
}

interface InteractiveCredential {
  authenticate(scopes: string | string[]): Promise<unknown>
  getToken(scope: string): Promise<AccessToken | null>
}

export class InteractiveGraphTokenProvider {
  private corpId: string | undefined

  constructor(
    private readonly credential: InteractiveCredential = new InteractiveBrowserCredential({
      clientId: process.env['TLC_ENTRA_CLIENT_ID'] ?? defaultClientId,
      tenantId: process.env['TLC_ENTRA_TENANT_ID'] ?? defaultTenantId,
      redirectUri: 'http://localhost',
      disableAutomaticAuthentication: true
    })
  ) {}

  async connect(): Promise<AuthStatus> {
    try {
      await this.credential.authenticate(graphScope)
      await this.getAccessToken()
      return this.readyStatus()
    } catch (cause) {
      return mapGraphAuthError(cause)
    }
  }

  async getAccessToken(): Promise<string> {
    const accessToken = await this.credential.getToken(graphScope)
    if (!accessToken) throw new Error('Microsoft Entra ID did not return a Microsoft Graph access token.')

    const claims = readGraphClaims(accessToken.token)
    this.corpId = claims.corpId
    return accessToken.token
  }

  async getAuthStatus(): Promise<AuthStatus> {
    try {
      await this.getAccessToken()
      return this.readyStatus()
    } catch (cause) {
      return mapGraphAuthError(cause)
    }
  }

  private readyStatus(): AuthStatus {
    return {
      state: 'ready',
      ...(this.corpId ? { displayName: this.corpId } : {}),
      detail: `TLC has delegated Microsoft Graph access as ${this.corpId ?? 'a Microsoft corporate user'}.`
    }
  }
}

function readGraphClaims(accessToken: string): { corpId: string } {
  const payloadPart = accessToken.split('.')[1]
  if (!payloadPart) throw new Error('Microsoft Entra ID returned an invalid Microsoft Graph access token.')

  let claims: Record<string, unknown>
  try {
    claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new Error('Microsoft Entra ID returned an unreadable Microsoft Graph access token.')
  }

  if (typeof claims['aud'] !== 'string' || !graphAudiences.has(claims['aud'])) {
    throw new Error('The access token audience is not Microsoft Graph.')
  }
  const scopes = typeof claims['scp'] === 'string' ? claims['scp'].split(' ') : []
  if (!scopes.includes('Sites.Read.All')) {
    throw new Error('The Microsoft Graph token does not contain delegated Sites.Read.All access.')
  }
  const corpId = [claims['preferred_username'], claims['upn'], claims['unique_name']]
    .find((claim): claim is string => typeof claim === 'string' && claim.toLowerCase().endsWith(corpDomain))
  if (!corpId) {
    throw new Error('The Microsoft Graph token is not for a Microsoft corporate identity.')
  }
  return { corpId }
}

function mapGraphAuthError(cause: unknown): AuthStatus {
  const detail = graphAuthErrorDetail(cause)
  const normalized = detail.toLowerCase()
  const state = normalized.includes('token does not contain delegated sites.read.all')
    ? 'permission-missing'
    : normalized.includes('aadsts65001') ||
        normalized.includes('aadsts90094') ||
        normalized.includes('aadsts900941') ||
        normalized.includes('aadsts900981') ||
        normalized.includes('consent_required') ||
        normalized.includes('need admin approval') ||
        normalized.includes('approval required') ||
        normalized.includes('userconsentblocked')
    ? 'consent-required'
    : normalized.includes('aadsts50020') || normalized.includes('tenant') || normalized.includes('corporate identity')
      ? 'tenant-mismatch'
      : 'login-required'
  return {
    state,
    detail: state === 'consent-required'
      ? `${detail} Sites.Read.All is user-consentable by definition. The Entra error code determines whether consent was incomplete or Microsoft CORP policy requires an admin-consent request or policy exception.`
      : detail
  }
}

function graphAuthErrorDetail(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : 'Microsoft Graph authentication failed.'
  if (!cause || typeof cause !== 'object' || !('errorResponse' in cause)) return message

  const response = cause.errorResponse
  if (!response || typeof response !== 'object') return message

  const diagnostics: string[] = []
  if ('errorCodes' in response && Array.isArray(response.errorCodes)) {
    diagnostics.push(...response.errorCodes.filter((code): code is number => typeof code === 'number').map((code) => `AADSTS${code}`))
  }
  if ('correlationId' in response && typeof response.correlationId === 'string') {
    diagnostics.push(`correlation ${response.correlationId}`)
  }
  if ('traceId' in response && typeof response.traceId === 'string') {
    diagnostics.push(`trace ${response.traceId}`)
  }
  return diagnostics.length > 0 ? `${message} Diagnostic: ${diagnostics.join('; ')}.` : message
}