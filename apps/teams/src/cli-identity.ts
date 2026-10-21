import { AzureCliCredential } from '@azure/identity'
import type { AccessToken, TokenCredential } from '@azure/core-auth'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import { getCliCapabilities, localConnectionVersion, type NativeConnectionStatus, type NativeResource } from '../../../packages/common/contracts/local-connection.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import type { CliTeamsConfiguration } from './configuration.js'
import { NativeConnectionError, type NativeIdentity } from './native-identity.js'
import { measurePerformance, type PerformanceReporter } from '../../../packages/common/telemetry/performance.js'

export class CliIdentityProvider {
  private acquisition: { generation: number; promise: Promise<{ token: string; identity: NativeIdentity }> } | undefined
  generation = 0
  private current: NativeIdentity | undefined
  private state: NativeConnectionStatus['state'] = 'sign-in-required'
  private mcpState: NativeConnectionStatus['resources'][number]['state'] = 'not-connected'
  private readonly resolveKey: JWTVerifyGetKey
  private readonly now: () => number
  constructor(
    private readonly configuration: CliTeamsConfiguration,
    private readonly credential: Pick<TokenCredential, 'getToken'> = new AzureCliCredential({ tenantId: configuration.tenantId, processTimeoutInMs: 30_000 }),
    private readonly options: {
      probeMsxIdentity(token: string, identity: ExecutionPrincipal): Promise<void>
      resolveKey?: JWTVerifyGetKey
      now?: () => number
      performanceReporter?: PerformanceReporter
    }
  ) {
    this.now = options.now ?? Date.now
    this.resolveKey = options.resolveKey ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${configuration.tenantId}/discovery/v2.0/keys`))
  }
  identity(): NativeIdentity | undefined {
    return this.current && (this.current.principal.expiresAt ?? 0) > this.now() ? this.current : undefined
  }
  private assertResource(resource: NativeResource): void {
    if (resource !== 'msx' && resource !== 'mcp') throw new NativeConnectionError('native_resource_unavailable')
  }
  private acquire(): Promise<{ token: string; identity: NativeIdentity }> {
    if (this.acquisition?.generation === this.generation) return this.acquisition.promise
    const generation = this.generation
    const promise = measurePerformance('credential.cli.acquire', this.options.performanceReporter, async () => {
      const result = await this.credential.getToken(`${this.configuration.msxResource}/.default`)
      if (!result) throw new NativeConnectionError('native_sign_in_required')
      return this.validate(result)
    })
    const acquisition = { generation, promise }
    this.acquisition = acquisition
    const cleanup = () => { if (this.acquisition === acquisition) this.acquisition = undefined }
    void promise.then(cleanup, cleanup)
    return promise
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
    const previous = this.identity()
    if (resource === 'mcp' && !previous) throw new NativeConnectionError('native_sign_in_required')
    if (resource === 'msx') await this.disconnect()
    const generation = this.generation
    this.state = 'connecting'
    try {
      const result = await this.acquire()
      if (generation !== this.generation) throw new NativeConnectionError('native_connection_changed')
      if (previous && resource === 'mcp' && previous.principal.userId !== result.identity.principal.userId) {
        await this.disconnect()
        throw new NativeConnectionError('native_connection_changed')
      }
      if (resource === 'msx') await this.options.probeMsxIdentity(result.token, result.identity.principal)
      if (generation !== this.generation) throw new NativeConnectionError('native_connection_changed')
      this.current = result.identity
      if (resource === 'mcp') this.mcpState = 'connected'
      this.state = 'connected'
    } catch (error) {
      if (generation === this.generation) {
        if (resource === 'mcp' && !(error instanceof NativeConnectionError && error.code === 'native_identity_rejected')) {
          this.mcpState = 'denied'; this.state = this.identity() ? 'connected' : 'blocked'
        } else { await this.disconnect(); this.state = 'blocked' }
      }
      throw error instanceof NativeConnectionError ? error : new NativeConnectionError('native_source_denied')
    }
  }
  async getToken(resource: NativeResource, renewSession = false): Promise<string> {
    this.assertResource(resource)
    const identity = renewSession ? this.current : this.identity()
    if (!identity) throw new NativeConnectionError('native_sign_in_required')
    if (resource === 'mcp' && this.mcpState !== 'connected') throw new NativeConnectionError('native_resource_unavailable')
    const generation = this.generation
    try {
      // The CLI owns its cache. Recheck its current subject rather than retaining a token across account switches.
      const result = await this.acquire()
      if (generation !== this.generation) throw new NativeConnectionError('native_connection_changed')
      if (result.identity.principal.userId !== identity.principal.userId) {
        await this.disconnect()
        throw new NativeConnectionError('native_connection_changed')
      }
      if (renewSession) await this.options.probeMsxIdentity(result.token, result.identity.principal)
      if (generation !== this.generation) throw new NativeConnectionError('native_connection_changed')
      this.current = result.identity
      return result.token
    } catch (error) {
      if (generation === this.generation) {
        if (resource === 'mcp' && !(error instanceof NativeConnectionError && error.code === 'native_identity_rejected')) {
          this.mcpState = 'denied'
        } else { await this.disconnect(); this.state = 'blocked' }
      }
      throw error instanceof NativeConnectionError ? error : new NativeConnectionError('native_source_denied')
    }
  }
  async disconnect(): Promise<void> {
    this.generation++; this.acquisition = undefined; this.current = undefined; this.state = 'sign-in-required'; this.mcpState = 'not-connected'
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
        resource, state: resource === 'graph' ? 'unavailable' : resource === 'mcp' ? identity ? this.mcpState : 'not-connected' : identity ? 'connected' : 'not-connected',
        detail: resource === 'graph' ? 'This CLI profile does not request Graph grants.'
          : resource === 'mcp' ? 'Explicit owner Connect for MCP is required. Uses a verified current-user Dataverse token; MCP tool policy and source permissions are checked separately.'
            : 'Current-user delegated MSX access; all operations remain source-authorized.'
      })),
      capabilities: getCliCapabilities(this.configuration.writeMode).map((capability) => {
        if (identity && capability.id === 'msx') return { ...capability, state: 'available', detail: 'Signed-in user verified. Portfolio automatically uses their Dataverse system-user ID and active deal-team memberships.' }
        if (identity && capability.id === 'mcp' && this.mcpState === 'connected') return {
          ...capability, state: 'available', detail: 'Owner-enabled delegated Dataverse token is available. MCP server admission, read-query allowlists and row permissions remain enforced.'
        }
        if (identity && capability.id === 'reviewed-writes' && this.configuration.writeMode === 'reviewed') return {
          ...capability, state: 'available', detail: 'Reviewed MSX changes are enabled. Each operation is approved explicitly and remains subject to the current user permissions and concurrency checks.'
        }
        return capability
      })
    }
  }
}
