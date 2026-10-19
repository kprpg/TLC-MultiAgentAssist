import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { PublicClientApplication, type AccountInfo } from '@azure/msal-node'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import { localConnectionVersion, nativeCapabilities, type NativeConnectionStatus, type NativeResource } from '../../../packages/common/contracts/local-connection.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import type { NativeTeamsConfiguration } from './configuration.js'

export type NativeErrorCode = 'native_sign_in_required' | 'native_sign_in_in_progress' | 'native_identity_rejected' | 'native_source_denied' | 'native_consent_required' | 'native_resource_unavailable' | 'native_connection_changed'
export class NativeConnectionError extends Error {
  constructor(readonly code: NativeErrorCode) { super(code.replaceAll('_', ' ')); this.name = 'NativeConnectionError' }
}
export interface NativeAuthenticationResult {
  accessToken: string
  idToken: string
  account: AccountInfo | null
  expiresOn: Date | null
}
export interface NativeAuthenticationClient {
  interactive(scopes: string[]): Promise<NativeAuthenticationResult>
  silent(scopes: string[], account: AccountInfo): Promise<NativeAuthenticationResult>
  clear(): Promise<void>
}
export interface NativeIdentity {
  principal: ExecutionPrincipal
  account: string
  generation: number
}
const knownRoles = ['TLC.Teams.User', 'TLC.Teams.Writer', 'TLC.Teams.Publisher', 'TLC.Teams.ContextAdmin']

export function createNativeAuthenticationClient(configuration: NativeTeamsConfiguration): NativeAuthenticationClient {
  const client = new PublicClientApplication({
    auth: { clientId: configuration.nativeClientId, authority: `https://login.microsoftonline.com/${configuration.tenantId}` }
  })
  return {
    interactive: (scopes) => client.acquireTokenInteractive({
      scopes,
      ...(new URL(configuration.nativeRedirectUri).port ? { preferredPort: Number(new URL(configuration.nativeRedirectUri).port) } : {}),
      openBrowser: async (value) => {
        const url = new URL(value)
        if (process.platform !== 'win32' || url.protocol !== 'https:' || url.hostname !== 'login.microsoftonline.com') {
          throw new NativeConnectionError('native_identity_rejected')
        }
        const browserEnvironment: NodeJS.ProcessEnv = { TLC_NATIVE_AUTH_URL: url.href }
        for (const name of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH']) {
          if (process.env[name] !== undefined) browserEnvironment[name] = process.env[name]
        }
        await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:TLC_NATIVE_AUTH_URL"], {
          env: browserEnvironment, timeout: 30_000
        })
      }
    }),
    silent: (scopes, account) => client.acquireTokenSilent({ scopes, account }),
    clear: async () => {
      const cache = client.getTokenCache()
      for (const account of await cache.getAllAccounts()) await cache.removeAccount(account)
    }
  }
}

export class NativeIdentityProvider {
  generation = 0
  private current: { identity: NativeIdentity; account: AccountInfo } | undefined
  private readonly tokens = new Map<NativeResource, { token: string; expiresAt: number }>()
  private readonly states = new Map<NativeResource, { state: NativeConnectionStatus['resources'][number]['state']; detail: string }>()
  private connecting = false
  private blocked = false
  private readonly resolveKey: JWTVerifyGetKey
  private readonly now: () => number
  constructor(
    private readonly configuration: NativeTeamsConfiguration,
    private readonly client: NativeAuthenticationClient,
    private readonly options: {
      probeMsxIdentity(token: string, identity: ExecutionPrincipal): Promise<void>
      resolveKey?: JWTVerifyGetKey
      now?: () => number
    }
  ) {
    this.now = options.now ?? Date.now
    this.resolveKey = options.resolveKey ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${configuration.tenantId}/discovery/v2.0/keys`))
  }
  identity(): NativeIdentity | undefined {
    return this.current && (this.current.identity.principal.expiresAt ?? 0) > this.now() ? this.current.identity : undefined
  }
  private scopes(resource: NativeResource): string[] {
    if (resource === 'msx') return [`${this.configuration.msxResource}/.default`]
    if (resource === 'mcp') return [this.configuration.mcpScope]
    if (!this.configuration.graphScopes.length) throw new NativeConnectionError('native_resource_unavailable')
    return this.configuration.graphScopes
  }
  private sameAuthority(first: NativeIdentity, second: NativeIdentity): boolean {
    return first.principal.userId === second.principal.userId &&
      first.principal.roles.length === second.principal.roles.length &&
      first.principal.roles.every((role) => second.principal.roles.includes(role))
  }
  private async validate(result: NativeAuthenticationResult): Promise<{ identity: NativeIdentity; account: AccountInfo; tokenExpiresAt: number }> {
    try {
      const { payload } = await jwtVerify(result.idToken, this.resolveKey, {
        issuer: `https://login.microsoftonline.com/${this.configuration.tenantId}/v2.0`,
        audience: this.configuration.nativeClientId, algorithms: ['RS256'],
        requiredClaims: ['exp', 'tid', 'oid', 'roles', 'ver'], currentDate: new Date(this.now())
      })
      const oid = z.uuid().parse(payload['oid']).toLowerCase()
      const roles = z.array(z.string()).parse(payload['roles']).filter((role) => knownRoles.includes(role))
      if (payload['tid'] !== this.configuration.tenantId || payload['ver'] !== '2.0' || payload['idtyp'] === 'app' ||
          !roles.includes('TLC.Teams.User') || !result.accessToken || !result.account || !result.expiresOn ||
          !Number.isFinite(result.expiresOn.getTime()) || result.expiresOn.getTime() <= this.now() || result.account.tenantId.toLowerCase() !== this.configuration.tenantId ||
          result.account.localAccountId.toLowerCase() !== oid.toLowerCase()) throw new Error('Invalid native identity.')
      return {
        account: result.account,
        tokenExpiresAt: result.expiresOn.getTime(),
        identity: {
          generation: this.generation, account: result.account.username,
          principal: {
            key: `${this.configuration.tenantId}:${oid}`, tenantId: this.configuration.tenantId, userId: oid,
            environmentId: this.configuration.environmentId, mode: 'live', roles,
            expiresAt: Math.min(Number(payload.exp) * 1000, result.expiresOn.getTime())
          }
        }
      }
    } catch { throw new NativeConnectionError('native_identity_rejected') }
  }
  private failure(resource: NativeResource, error: unknown): NativeConnectionError {
    const code = error !== null && typeof error === 'object' && 'errorCode' in error && typeof error.errorCode === 'string' ? error.errorCode : ''
    const failure = error instanceof NativeConnectionError ? error :
      new NativeConnectionError(/consent|interaction|login_required/.test(code) ? 'native_consent_required' : 'native_source_denied')
    this.states.set(resource, { state: failure.code === 'native_consent_required' ? 'consent-required' : 'denied', detail: failure.message })
    return failure
  }
  async connect(resource: NativeResource): Promise<void> {
    if (this.connecting) throw new NativeConnectionError('native_sign_in_in_progress')
    const scopes = this.scopes(resource)
    const previous = this.identity()
    if (resource !== 'msx' && !previous) throw new NativeConnectionError('native_sign_in_required')
    if (resource === 'msx') { this.current = undefined; this.tokens.clear(); this.states.clear(); this.generation++ }
    const generation = this.generation
    this.connecting = true; this.blocked = false
    try {
      const result = await this.client.interactive(scopes)
      const verified = await this.validate(result)
      if (generation !== this.generation) throw new NativeConnectionError('native_connection_changed')
      if (previous && resource !== 'msx' && !this.sameAuthority(verified.identity, previous)) {
        await this.disconnect()
        throw new NativeConnectionError('native_connection_changed')
      }
      if (resource === 'msx') await this.options.probeMsxIdentity(result.accessToken, verified.identity.principal)
      if (generation !== this.generation) throw new NativeConnectionError('native_connection_changed')
      this.current = verified
      this.tokens.set(resource, { token: result.accessToken, expiresAt: verified.tokenExpiresAt })
      this.states.set(resource, { state: 'connected', detail: resource === 'msx' ? 'Native identity and own Dataverse mapping verified.' : 'Resource token acquired; source operation authorization remains independent.' })
    } catch (error) {
      if (generation === this.generation && error instanceof NativeConnectionError && error.code === 'native_identity_rejected') await this.disconnect()
      this.blocked = !this.identity()
      throw this.failure(resource, error)
    } finally { this.connecting = false }
  }
  async getToken(resource: NativeResource): Promise<string> {
    const identity = this.identity()
    if (!identity || !this.current) throw new NativeConnectionError('native_sign_in_required')
    const scopes = this.scopes(resource)
    const cached = this.tokens.get(resource)
    if (cached && cached.expiresAt > this.now() + 30_000) return cached.token
    const generation = this.generation
    try {
      const result = await this.client.silent(scopes, this.current.account)
      const verified = await this.validate(result)
      if (generation !== this.generation) throw new NativeConnectionError('native_connection_changed')
      if (!this.sameAuthority(verified.identity, identity)) {
        await this.disconnect()
        throw new NativeConnectionError('native_connection_changed')
      }
      this.current = verified
      this.tokens.set(resource, { token: result.accessToken, expiresAt: verified.tokenExpiresAt })
      this.states.set(resource, { state: 'connected', detail: 'Native resource token acquired silently for the same owner.' })
      return result.accessToken
    } catch (error) {
      if (generation === this.generation && error instanceof NativeConnectionError && error.code === 'native_identity_rejected') await this.disconnect()
      throw this.failure(resource, error)
    }
  }
  async disconnect(): Promise<void> {
    this.generation++; this.current = undefined; this.tokens.clear(); this.states.clear(); this.blocked = false
    await this.client.clear()
  }
  status(): NativeConnectionStatus {
    const identity = this.identity()
    return {
      contractVersion: localConnectionVersion,
      state: this.connecting ? 'connecting' : identity ? 'connected' : this.blocked ? 'blocked' : 'sign-in-required',
      detail: identity ? 'Connected through the local owner’s native identity; feature/source grants remain separate.' : 'Use the protected local owner command to sign in. HTTP requests never open sign-in.',
      ...(identity ? { account: identity.account } : {}),
      resources: (['msx', 'mcp', 'graph'] as const).map((resource) => {
        const state = this.states.get(resource)
        return { resource, ...(state && (identity || state.state !== 'connected') ? state : {
          state: resource === 'graph' && !this.configuration.graphScopes.length ? 'unavailable' : 'not-connected',
          detail: 'This resource has not been connected.'
        }) }
      }),
      capabilities: nativeCapabilities.map((capability) => capability.id === 'msx' && identity
        ? { ...capability, state: 'available', detail: 'Own native identity and Dataverse user mapping verified. Record-level source authorization still applies.' }
        : capability.id === 'graph' && !this.configuration.graphScopes.length
          ? { ...capability, state: 'requires-configuration', detail: 'Optional Graph delegated scopes are not configured. No transcript sign-in or cloud subscription is started.' }
          : capability.id === 'guidance' && this.configuration.guidanceMode === 'foundry'
            ? { ...capability, state: 'requires-source-grant', detail: 'Foundry guidance explicitly selected. Its separate configured workload identity and deployed agents must be authorized.' }
            : { ...capability })
    }
  }
}
