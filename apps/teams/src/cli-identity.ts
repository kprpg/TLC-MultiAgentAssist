import { AzureCliCredential } from '@azure/identity'
import type { AccessToken, TokenCredential } from '@azure/core-auth'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import { getCliCapabilities, localConnectionVersion, type NativeConnectionStatus, type NativeResource } from '../../../packages/common/contracts/local-connection.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import type { CliTeamsConfiguration } from './configuration.js'
import { NativeConnectionError, type NativeIdentity } from './native-identity.js'

export class CliIdentityProvider {
  generation = 0
  private current: NativeIdentity | undefined
  private state: NativeConnectionStatus['state'] = 'sign-in-required'
  private readonly resolveKey: JWTVerifyGetKey
  private readonly now: () => number
  constructor(
    private readonly configuration: CliTeamsConfiguration,
    private readonly credential: Pick<TokenCredential, 'getToken'> = new AzureCliCredential({ tenantId: configuration.tenantId, processTimeoutInMs: 30_000 }),
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
    return this.current && (this.current.principal.expiresAt ?? 0) > this.now() ? this.current : undefined
  }
  private assertResource(resource: NativeResource): void {
    if (resource !== 'msx') throw new NativeConnectionError('native_resource_unavailable')
  }
  private async acquire(): Promise<{ token: string; identity: NativeIdentity }> {
    const result = await this.credential.getToken(`${this.configuration.msxResource}/.default`)
    if (!result) throw new NativeConnectionError('native_sign_in_required')
    return this.validate(result)
  }
  private async validate(result: AccessToken): Promise<{ token: string; identity: NativeIdentity }> {
    try {
      const v1Issuer = `https://sts.windows.net/${this.configuration.tenantId}/`
      const v2Issuer = `https://login.microsoftonline.com/${this.configuration.tenantId}/v2.0`
      const { payload } = await jwtVerify(result.token, this.resolveKey, {
        issuer: [v1Issuer, v2Issuer],
        audience: [this.configuration.msxResource, `${this.configuration.msxResource}/`, '00000007-0000-0000-c000-000000000000'],
        algorithms: ['RS256'], requiredClaims: ['exp', 'tid', 'oid', 'scp', 'ver'], currentDate: new Date(this.now())
      })
      const userId = z.uuid().parse(payload['oid']).toLowerCase()
      if (payload['tid'] !== this.configuration.tenantId || payload['idtyp'] === 'app' ||
          !(payload['ver'] === '1.0' && payload.iss === v1Issuer || payload['ver'] === '2.0' && payload.iss === v2Issuer) ||
          typeof payload['scp'] !== 'string' || !payload['scp'].split(' ').includes('user_impersonation') ||
          !Number.isFinite(result.expiresOnTimestamp) || result.expiresOnTimestamp <= this.now()) {
        throw new Error('Invalid delegated source identity.')
      }
      const username = [payload['preferred_username'], payload['upn'], payload['unique_name']]
        .find((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 500)
      return {
        token: result.token,
        identity: {
          generation: this.generation, account: username ?? 'Signed-in Azure CLI user',
          principal: {
            key: `${this.configuration.tenantId}:${userId}`, tenantId: this.configuration.tenantId, userId,
            environmentId: this.configuration.environmentId, mode: 'live', roles: [], localSourceAccess: this.configuration.writeMode,
            expiresAt: Math.min(Number(payload.exp) * 1000, result.expiresOnTimestamp)
          }
        }
      }
    } catch { throw new NativeConnectionError('native_identity_rejected') }
  }
  async connect(resource: NativeResource): Promise<void> {
    this.assertResource(resource)
    if (this.state === 'connecting') throw new NativeConnectionError('native_sign_in_in_progress')
    await this.disconnect()
    const generation = this.generation
    this.state = 'connecting'
    try {
      const result = await this.acquire()
      if (generation !== this.generation) throw new NativeConnectionError('native_connection_changed')
      await this.options.probeMsxIdentity(result.token, result.identity.principal)
      if (generation !== this.generation) throw new NativeConnectionError('native_connection_changed')
      this.current = result.identity
      this.state = 'connected'
    } catch (error) {
      if (generation === this.generation) { this.current = undefined; this.state = 'blocked' }
      throw error instanceof NativeConnectionError ? error : new NativeConnectionError('native_source_denied')
    }
  }
  async getToken(resource: NativeResource): Promise<string> {
    this.assertResource(resource)
    const identity = this.identity()
    if (!identity) throw new NativeConnectionError('native_sign_in_required')
    const generation = this.generation
    try {
      // The CLI owns its cache. Recheck its current subject rather than retaining a token across account switches.
      const result = await this.acquire()
      if (generation !== this.generation) throw new NativeConnectionError('native_connection_changed')
      if (result.identity.principal.userId !== identity.principal.userId) {
        await this.disconnect()
        throw new NativeConnectionError('native_connection_changed')
      }
      this.current = result.identity
      return result.token
    } catch (error) {
      if (generation === this.generation) { await this.disconnect(); this.state = 'blocked' }
      throw error instanceof NativeConnectionError ? error : new NativeConnectionError('native_source_denied')
    }
  }
  async disconnect(): Promise<void> {
    this.generation++; this.current = undefined; this.state = 'sign-in-required'
  }
  status(): NativeConnectionStatus {
    const identity = this.identity()
    return {
      contractVersion: localConnectionVersion,
      state: identity ? 'connected' : this.state === 'connected' ? 'reconnect-required' : this.state,
      detail: identity
        ? this.configuration.writeMode === 'reviewed'
          ? 'Current Azure CLI user and own Dataverse mapping verified. MSX changes require exact review, approval and source permission; action receipts are retained. No FTE or publication role is inferred.'
          : 'Current Azure CLI user and own Dataverse mapping verified. Private MSX access is read-only; no FTE, writer or publication role is inferred.'
        : 'Use the protected owner Connect command to reuse your existing Azure CLI user. If needed, run az login yourself first. No sign-in or source request is triggered by this page.',
      ...(identity ? { account: identity.account } : {}),
      resources: (['msx', 'mcp', 'graph'] as const).map((resource) => ({
        resource, state: resource !== 'msx' ? 'unavailable' : identity ? 'connected' : 'not-connected',
        detail: resource !== 'msx' ? 'This CLI profile does not request optional source grants.' : 'Current-user delegated MSX access; all operations remain source-authorized.'
      })),
      capabilities: getCliCapabilities(this.configuration.writeMode).map((capability) => {
        if (identity && capability.id === 'msx') return { ...capability, state: 'available', detail: 'Signed-in user verified. Portfolio automatically uses their Dataverse system-user ID and active deal-team memberships.' }
        if (identity && capability.id === 'reviewed-writes' && this.configuration.writeMode === 'reviewed') return {
          ...capability, state: 'available', detail: 'Reviewed MSX changes are enabled. Each operation is approved explicitly and remains subject to the current user permissions and concurrency checks.'
        }
        return capability
      })
    }
  }
}
