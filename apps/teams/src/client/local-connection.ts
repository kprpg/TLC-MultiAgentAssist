import { z } from 'zod'
import type { TeamsApiBasePath } from '../../../../packages/common/contracts/teams-data-mode.js'
import {
  localConnectionVersion, localPairRequestResultSchema, localPairResultSchema, localRevokeResultSchema, type LocalPairRequestResult,
  localWorkSessionMs, localSessionRenewalIntervalMs, localSessionVersion, localSessionRenewalResultSchema
} from '../../../../packages/common/contracts/local-connection.js'

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
export class LocalBrowserConnection {
  private pending: { requestId: string; verifier: string; expiresAt: number } | undefined
  private capability: { token: string; expiresAt: number; sessionExpiresAt: number; renewAt: number } | undefined
  private renewal: Promise<void> | undefined
  private generation = 0
  constructor(private readonly context: { tenantId?: string; userId?: string } = {}, private readonly apiBasePath: TeamsApiBasePath = '/api/teams') {}
  private async post<T>(path: string, input: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.apiBasePath}/local/${path}`, {
      method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input), ...(signal ? { signal } : {})
    })
    if (!response.ok) {
      const error = z.object({ error: z.string().regex(/^[a-z_]{1,100}$/), correlationId: z.string().optional() }).strict().parse(await response.json())
      throw new Error(`${error.error.replaceAll('_', ' ')}. Use the protected local owner command; no source sign-in is performed by this page.`)
    }
    return schema.parse(await response.json())
  }
  async begin(signal?: AbortSignal): Promise<LocalPairRequestResult> {
    this.clear()
    const generation = this.generation
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
    const request = await this.post('requests', {
      contractVersion: localConnectionVersion, challenge,
      ...(this.context.tenantId ? { contextTenantId: this.context.tenantId } : {}),
      ...(this.context.userId ? { contextUserId: this.context.userId } : {})
    }, localPairRequestResultSchema, signal)
    if (generation !== this.generation) throw new Error('The local connection changed. Request a fresh pairing.')
    this.pending = { requestId: request.requestId, verifier, expiresAt: Date.parse(request.expiresAt) }
    return request
  }
  async poll(signal?: AbortSignal): Promise<boolean> {
    const pending = this.pending
    if (!pending || pending.expiresAt <= Date.now()) throw new Error('Local pairing expired. Request a fresh pairing.')
    const generation = this.generation
    const result = await this.post('exchange', { contractVersion: localConnectionVersion, requestId: pending.requestId, verifier: pending.verifier }, localPairResultSchema, signal)
    if (generation !== this.generation) throw new Error('The local connection changed. Request a fresh pairing.')
    if (result.state !== 'paired') return false
    const expiresAt = Date.parse(result.expiresAt)
    if (expiresAt <= Date.now()) throw new Error('The local page capability expired. Request a fresh pairing.')
    this.capability = {
      token: result.token, expiresAt, sessionExpiresAt: Date.now() + localWorkSessionMs,
      renewAt: Math.min(Date.now() + localSessionRenewalIntervalMs, expiresAt - 30_000)
    }
    this.pending = undefined
    return true
  }
  async getToken(): Promise<string> {
    const capability = this.capability
    if (!capability || capability.sessionExpiresAt <= Date.now()) {
      this.clear()
      throw new Error('Pair this page with your local native connection before accessing live data.')
    }
    if (capability.renewAt <= Date.now()) await this.renew()
    if (this.capability !== capability) throw new Error('The local connection changed. Request a fresh pairing.')
    return capability.token
  }
  async renew(): Promise<void> {
    if (this.renewal) return this.renewal
    const capability = this.capability
    const generation = this.generation
    if (!capability || capability.sessionExpiresAt <= Date.now()) {
      this.clear()
      throw new Error('The 8-hour local work session ended. Pair this page again.')
    }
    const renewing = (async () => {
      try {
        const response = await fetch(`${this.apiBasePath}/local/renew`, {
          method: 'POST', credentials: 'omit', signal: AbortSignal.timeout(30_000),
          headers: { authorization: `Bearer ${capability.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ contractVersion: localSessionVersion })
        })
        if (!response.ok) throw new Error('Local session renewal was rejected. Reconnect your source account and pair again; private results must be cleared.')
        const result = localSessionRenewalResultSchema.parse(await response.json())
        if (generation !== this.generation || capability !== this.capability) throw new Error('The local connection changed during renewal.')
        const expiresAt = Date.parse(result.expiresAt)
        const sessionExpiresAt = Date.parse(result.sessionExpiresAt)
        if (expiresAt <= Date.now() || sessionExpiresAt <= Date.now()) throw new Error('The local session renewal already expired. Pair again.')
        capability.expiresAt = expiresAt; capability.sessionExpiresAt = Math.min(capability.sessionExpiresAt, sessionExpiresAt)
        capability.renewAt = Math.min(Date.now() + localSessionRenewalIntervalMs, expiresAt - 30_000)
      } catch (error) {
        if (generation === this.generation) this.clear()
        throw error
      }
    })()
    this.renewal = renewing
    try { await renewing } finally { if (this.renewal === renewing) this.renewal = undefined }
  }
  expiresAt(): number | undefined { return this.capability?.expiresAt }
  sessionExpiresAt(): number | undefined { return this.capability?.sessionExpiresAt }
  isCurrentToken(token: string): boolean {
    return !!this.capability && this.capability.token === token && this.capability.expiresAt > Date.now() && this.capability.sessionExpiresAt > Date.now()
  }
  async disconnect(): Promise<void> {
    const capability = this.capability
    this.clear()
    if (!capability) return
    const response = await fetch(`${this.apiBasePath}/local/revoke`, {
      method: 'POST', credentials: 'omit',
      headers: { authorization: `Bearer ${capability.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion: localConnectionVersion })
    })
    if (!response.ok) throw new Error('The page capability was cleared locally, but server revocation was not confirmed. Other paired pages and the native owner were not disconnected.')
    localRevokeResultSchema.parse(await response.json())
  }
  clear(): void { this.generation++; this.pending = undefined; this.capability = undefined; this.renewal = undefined }
}
