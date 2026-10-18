import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { TeamsConfiguration } from './configuration.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'

export class TeamsAuthorizationError extends Error {
  constructor(readonly code: 'authorization_required' | 'fte_ineligible' = 'authorization_required', readonly claims?: string) {
    super(code === 'fte_ineligible' ? 'This account is not eligible for TLC Teams.' : 'Delegated authorization is required.')
    this.name = 'TeamsAuthorizationError'
  }
}

export function createTeamsAuthenticator(configuration: TeamsConfiguration, resolveKey?: JWTVerifyGetKey) {
  if (configuration.mode !== 'live') throw new Error('Live token validation requires live configuration.')
  const issuer = `https://login.microsoftonline.com/${configuration.tenantId}/v2.0`
  const key = resolveKey ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${configuration.tenantId}/discovery/v2.0/keys`))
  return async (token: string): Promise<ExecutionPrincipal> => {
    let payload
    try {
      ;({ payload } = await jwtVerify(token, key, {
        algorithms: ['RS256'], issuer, audience: configuration.apiClientId,
        requiredClaims: ['exp', 'tid', 'oid', 'azp', 'scp', 'ver']
      }))
    } catch {
      throw new TeamsAuthorizationError()
    }
    if (payload['tid'] !== configuration.tenantId || payload['ver'] !== '2.0'
      || payload['idtyp'] === 'app' || typeof payload['oid'] !== 'string'
      || !/^[0-9a-f-]{36}$/i.test(payload['oid'])
      || ![configuration.spaClientId, configuration.botClientId].includes(String(payload['azp']))
      || typeof payload['scp'] !== 'string' || !payload['scp'].split(' ').includes('access_as_user')) {
      throw new TeamsAuthorizationError()
    }
    const roles = payload['roles']
    if (!Array.isArray(roles) || !roles.every((role): role is string => typeof role === 'string') || !roles.includes('TLC.Teams.User')) {
      throw new TeamsAuthorizationError('fte_ineligible')
    }
    return {
      key: `${configuration.tenantId}:${payload['oid']}`,
      tenantId: configuration.tenantId, userId: payload['oid'],
      environmentId: configuration.environmentId, roles, mode: 'live', expiresAt: Number(payload.exp) * 1000
    }
  }
}

export type ResourceName = 'msx' | 'mcp' | 'graph'
export type AcquireDelegatedToken = (request: { oboAssertion: string; scopes: string[] }) => Promise<{ accessToken: string } | null>
export interface DelegatedTokenProvider { getToken(resource: ResourceName): Promise<string> }

export function createDelegatedTokenProvider(configuration: TeamsConfiguration, assertion: string, acquire: AcquireDelegatedToken, expiresAt = Number.POSITIVE_INFINITY): DelegatedTokenProvider {
  if (configuration.mode !== 'live') throw new Error('Sample mode cannot acquire source tokens.')
  const resources: Record<ResourceName, string> = {
    msx: `${configuration.msxResource}/.default`,
    mcp: configuration.mcpScope,
    graph: 'https://graph.microsoft.com/.default'
  }
  return {
    async getToken(resource) {
      if (Date.now() >= expiresAt) throw new TeamsAuthorizationError()
      const scope = resources[resource]
      if (!scope) throw new TeamsAuthorizationError()
      let result
      try {
        result = await acquire({ oboAssertion: assertion, scopes: [scope] })
      } catch (error) {
        let claims: string | undefined
        if (error !== null && typeof error === 'object' && 'claims' in error && typeof error.claims === 'string' && error.claims.length <= 8192) {
          try {
            const parsed: unknown = JSON.parse(error.claims)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 1 && 'access_token' in parsed
              && parsed.access_token !== null && typeof parsed.access_token === 'object' && !Array.isArray(parsed.access_token)) claims = JSON.stringify(parsed)
          } catch {
            throw new TeamsAuthorizationError()
          }
        }
        throw new TeamsAuthorizationError('authorization_required', claims)
      }
      if (!result?.accessToken || result.accessToken === assertion) throw new TeamsAuthorizationError()
      return result.accessToken
    }
  }
}
