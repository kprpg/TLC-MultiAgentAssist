import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { localConnectionVersion, localPairExchangeSchema, localPairRequestSchema, type LocalPairRequestResult, localPairResultSchema } from '../../../packages/common/contracts/local-connection.js'
import { isLocalReadOnlyPrincipal, principalPartition, type ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import type { NativeIdentity } from './native-identity.js'

export class LocalPairingError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = 'LocalPairingError' }
}
type Binding = { partition: string; generation: number }
type Pending = {
  challenge: string; expiresAt: number; userCode: string; attempts: number
  contextTenantId?: string; contextUserId?: string; ownerAtRequest?: Binding; approved?: Binding
}
const hash = (value: string) => createHash('sha256').update(value).digest('base64url')
const binding = (identity: NativeIdentity): Binding => ({ partition: principalPartition(identity.principal), generation: identity.generation })
const matches = (expected: Binding, identity: NativeIdentity) => expected.partition === principalPartition(identity.principal) && expected.generation === identity.generation

export class LocalPairingAuthority {
  private readonly instanceId = randomUUID()
  private readonly requests = new Map<string, Pending>()
  private readonly sessions = new Map<string, { binding: Binding; expiresAt: number }>()
  private readonly now: () => number
  private readonly allowLocalReadOnly: boolean
  constructor(private readonly origin: string, private readonly getIdentity: () => NativeIdentity | undefined, options: { now?: () => number; allowLocalReadOnly?: boolean } = {}) {
    this.now = options.now ?? Date.now
    this.allowLocalReadOnly = options.allowLocalReadOnly === true
  }
  private checkOrigin(origin: string): void {
    if (origin !== this.origin) throw new LocalPairingError(403, 'local_origin_denied')
  }
  private current(): NativeIdentity {
    const identity = this.getIdentity()
    if (!identity || !this.eligible(identity) || (identity.principal.expiresAt ?? 0) <= this.now()) {
      throw new LocalPairingError(401, 'native_sign_in_required')
    }
    return identity
  }
  private eligible(identity: NativeIdentity): boolean {
    return identity.principal.mode === 'live' && (identity.principal.roles.includes('TLC.Teams.User') ||
      this.allowLocalReadOnly && isLocalReadOnlyPrincipal(identity.principal))
  }
  private prune(): void {
    const candidate = this.getIdentity()
    const identity = candidate && this.eligible(candidate) && (candidate.principal.expiresAt ?? 0) > this.now() ? candidate : undefined
    for (const [id, request] of this.requests) {
      if (request.expiresAt <= this.now() || request.ownerAtRequest && identity && !matches(request.ownerAtRequest, identity)) this.requests.delete(id)
    }
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= this.now() || !identity || !matches(session.binding, identity)) this.sessions.delete(id)
    }
  }
  begin(value: unknown, origin: string): LocalPairRequestResult {
    this.checkOrigin(origin)
    const input = localPairRequestSchema.parse(value)
    this.prune()
    if (this.requests.size >= 3) throw new LocalPairingError(429, 'local_pairing_capacity')
    let userCode: string
    do { userCode = randomBytes(4).toString('hex').toUpperCase() } while ([...this.requests.values()].some((request) => request.userCode === userCode))
    const requestId = randomUUID()
    const expiresAt = this.now() + 300_000
    const identity = this.getIdentity()
    this.requests.set(requestId, {
      challenge: input.challenge, expiresAt, userCode, attempts: 0,
      ...(input.contextTenantId ? { contextTenantId: input.contextTenantId.toLowerCase() } : {}),
      ...(input.contextUserId ? { contextUserId: input.contextUserId.toLowerCase() } : {}),
      ...(identity ? { ownerAtRequest: binding(identity) } : {})
    })
    return { contractVersion: localConnectionVersion, requestId, userCode, expiresAt: new Date(expiresAt).toISOString(), state: 'pending-owner-approval' }
  }
  pending(): { userCode: string; expiresAt: string; approved: boolean }[] {
    this.prune()
    return [...this.requests.values()].map((request) => ({ userCode: request.userCode, expiresAt: new Date(request.expiresAt).toISOString(), approved: !!request.approved }))
  }
  reviewGeneration(): string { return `${this.instanceId}:${this.current().generation}` }
  approve(userCode: string): void {
    this.prune()
    const identity = this.current()
    const pending = [...this.requests.values()].find((request) => request.userCode === userCode)
    if (!pending) throw new LocalPairingError(410, 'local_pairing_expired')
    if (pending.ownerAtRequest && !matches(pending.ownerAtRequest, identity) ||
        pending.contextTenantId && pending.contextTenantId !== identity.principal.tenantId.toLowerCase() ||
        pending.contextUserId && pending.contextUserId !== identity.principal.userId.toLowerCase()) {
      throw new LocalPairingError(403, 'local_identity_mismatch')
    }
    pending.approved = binding(identity)
  }
  exchange(value: unknown, origin: string): ReturnType<typeof localPairResultSchema.parse> {
    this.checkOrigin(origin)
    const input = localPairExchangeSchema.parse(value)
    this.prune()
    const pending = this.requests.get(input.requestId)
    if (!pending) throw new LocalPairingError(410, 'local_pairing_expired')
    if (!timingSafeEqual(Buffer.from(hash(input.verifier)), Buffer.from(pending.challenge))) {
      if (++pending.attempts >= 5) this.requests.delete(input.requestId)
      throw new LocalPairingError(403, 'local_verifier_rejected')
    }
    if (!pending.approved) return { contractVersion: localConnectionVersion, state: 'pending-owner-approval', expiresAt: new Date(pending.expiresAt).toISOString() }
    const identity = this.current()
    if (!matches(pending.approved, identity)) {
      this.requests.delete(input.requestId)
      throw new LocalPairingError(401, 'local_connection_changed')
    }
    if (this.sessions.size >= 8) throw new LocalPairingError(429, 'local_session_capacity')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Math.min(this.now() + 900_000, identity.principal.expiresAt ?? this.now())
    this.sessions.set(hash(token), { binding: pending.approved, expiresAt })
    this.requests.delete(input.requestId)
    return { contractVersion: localConnectionVersion, state: 'paired', token, expiresAt: new Date(expiresAt).toISOString() }
  }
  authenticate(token: string): ExecutionPrincipal {
    this.prune()
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new LocalPairingError(401, 'local_session_required')
    const key = hash(token)
    const session = this.sessions.get(key)
    const identity = this.current()
    if (!session || !matches(session.binding, identity)) {
      this.sessions.delete(key)
      throw new LocalPairingError(401, 'local_session_required')
    }
    return { ...identity.principal, expiresAt: Math.min(session.expiresAt, identity.principal.expiresAt ?? 0) }
  }
  revoke(token: string): void { this.authenticate(token); this.sessions.delete(hash(token)) }
  invalidate(): void { this.requests.clear(); this.sessions.clear() }
}
