import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import type { GraphSubscriptionConnector } from '../../connectors/graph/subscriptions.js'
import { meetingAcquisitionRequestSchema, type MeetingAcquisitionRequest } from './meeting-acquisition.js'
import { canonicalJson } from './reviewed-actions.js'
import { principalPartition, requireRole, type ExecutionPrincipal } from './principal.js'
import { CollaborationLifecycle } from './lifecycle.js'

const ownerSchema = z.object({ partition: z.string(), userId: z.string(), tenantId: z.string(), environmentId: z.string() }).strict()
const subscriptionRecord = z.object({
  id: z.uuid(), owner: ownerSchema, request: meetingAcquisitionRequestSchema,
  clientStateHash: z.string(), expiresAt: z.iso.datetime(), disabled: z.boolean(),
  generation: z.number().int().nonnegative().default(0)
}).strict()
const hintSchema = z.object({
  request: meetingAcquisitionRequestSchema, subscriptionId: z.uuid(),
  state: z.enum(['pending', 'processing', 'processed', 'auth-required']),
  generation: z.number().int().nonnegative().default(0)
}).strict()
export interface SubscriptionHealth { state: 'active' | 'unconfirmed' | 'foreground-only'; detail: string }

export class TranscriptEventService {
  private readonly partition: string
  constructor(
    private readonly store: ScopedDocumentStore,
    private readonly scope: { tenantId: string; environmentId: string },
    private readonly connector: (principal: ExecutionPrincipal) => GraphSubscriptionConnector,
    private readonly available: (principal: ExecutionPrincipal, request: MeetingAcquisitionRequest, generation: number, notificationId: string) => Promise<void>
  ) { this.partition = `${scope.tenantId}:${scope.environmentId}:graph-subscriptions` }
  private key(request: MeetingAcquisitionRequest): string {
    return `subscription-intent:${createHash('sha256').update(canonicalJson(request)).digest('hex')}`
  }
  private check(principal: ExecutionPrincipal) {
    requireRole(principal, 'TLC.Teams.User')
    if (principal.tenantId !== this.scope.tenantId || principal.environmentId !== this.scope.environmentId) throw new Error('The subscription tenant or environment is not authorized.')
  }
  async ensure(principal: ExecutionPrincipal, raw: unknown): Promise<SubscriptionHealth> {
    this.check(principal)
    const admission = await new CollaborationLifecycle(this.store).assertActive(principal)
    const request = meetingAcquisitionRequestSchema.parse(raw)
    const key = this.key(request)
    const partition = principalPartition(principal)
    const intent = await this.store.read(partition, key)
    if (intent) {
      const existing = z.object({ state: z.string(), id: z.string().optional() }).parse(intent.value)
      if (existing.state !== 'active' || !existing.id) return { state: 'unconfirmed', detail: 'Subscription outcome is unconfirmed or inactive. Foreground transcript discovery remains available; no create is repeated.' }
      const row = await this.store.read(this.partition, existing.id)
      if (!row) throw new Error('Subscription metadata is unavailable.')
      const record = subscriptionRecord.parse(row.value)
      if (record.owner.partition !== partition) throw new Error('The subscription owner is not authorized.')
      if (record.disabled) return { state: 'foreground-only', detail: 'Background acquisition is stopped for this meeting.' }
      if (record.generation === admission.generation && Date.parse(record.expiresAt) > Date.now() + 5 * 60_000) return { state: 'active', detail: 'Delegated per-meeting notifications are active.' }
      if (!await this.store.replace(partition, key, intent.revision, { state: 'renewing', id: record.id })) {
        return { state: 'unconfirmed', detail: 'Another request is renewing this subscription.' }
      }
      try {
        const renewed = await this.connector(principal).renew(record.id)
        if (!await this.store.replace(this.partition, record.id, row.revision, { ...record, generation: admission.generation, expiresAt: renewed.expirationDateTime })) throw new Error('Subscription renewal metadata changed.')
        if (!await this.store.replace(partition, key, intent.revision + 1, { state: 'active', id: record.id })) throw new Error('Subscription renewal intent changed concurrently.')
        return { state: 'active', detail: 'Delegated subscription renewed.' }
      } catch {
        return { state: 'unconfirmed', detail: 'Subscription renewal is unconfirmed. No external write is retried automatically.' }
      }
    }
    if ((await this.store.list(partition, 'subscription-intent:', 21)).length >= 20) return { state: 'foreground-only', detail: 'The per-user background meeting limit was reached.' }
    if (!await this.store.insert(partition, key, { state: 'creating' })) return { state: 'unconfirmed', detail: 'Another request owns subscription creation.' }
    const clientState = randomBytes(32).toString('base64url')
    try {
      const created = await this.connector(principal).create(request.meetingId, clientState)
      const record = subscriptionRecord.parse({
        id: created.id, owner: { partition, userId: principal.userId, tenantId: principal.tenantId, environmentId: principal.environmentId },
        request, clientStateHash: createHash('sha256').update(clientState).digest('hex'),
        expiresAt: created.expirationDateTime, disabled: false, generation: admission.generation
      })
      if (!await this.store.insert(this.partition, created.id, record)) throw new Error('Subscription identity was already recorded.')
      if (!await this.store.replace(partition, key, 1, { state: 'active', id: created.id })) throw new Error('Subscription intent changed concurrently.')
      return { state: 'active', detail: 'Delegated per-meeting notifications are active.' }
    } catch {
      return { state: 'unconfirmed', detail: 'Subscription creation is unconfirmed or rejected. Foreground discovery remains available; no external create is repeated.' }
    }
  }
  async maintain(principal: ExecutionPrincipal): Promise<SubscriptionHealth[]> {
    this.check(principal)
    const admission = await new CollaborationLifecycle(this.store).status(principal)
    if (!admission.acceptingNewWork) return []
    const partition = principalPartition(principal)
    const health: SubscriptionHealth[] = []
    for (const intent of await this.store.list(partition, 'subscription-intent:', 20)) {
      const value = z.object({ state: z.string(), id: z.uuid().optional() }).parse(intent.value)
      if (value.state !== 'active' || !value.id) continue
      const row = await this.store.read(this.partition, value.id)
      if (!row) throw new Error('Subscription renewal metadata is unavailable.')
      const record = subscriptionRecord.parse(row.value)
      if (record.owner.partition !== partition) throw new Error('The subscription owner is not authorized.')
      if (record.disabled || record.generation !== admission.generation || Date.parse(record.expiresAt) > Date.now() + 5 * 60_000) continue
      health.push(await this.ensure(principal, record.request))
    }
    return health
  }
  async receive(raw: unknown): Promise<void> {
    const envelope = z.object({ value: z.array(z.object({
      subscriptionId: z.uuid(), clientState: z.string().min(1).max(128),
      resourceData: z.object({ id: z.string().max(500).optional() }).optional(),
      lifecycleEvent: z.string().optional()
    })).min(1).max(50) }).parse(raw)
    for (const event of envelope.value) {
      const row = await this.store.read(this.partition, event.subscriptionId)
      if (!row) throw new Error('The Graph notification is not authorized.')
      const record = subscriptionRecord.parse(row.value)
      const actual = createHash('sha256').update(event.clientState).digest()
      const expected = Buffer.from(record.clientStateHash, 'hex')
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('The Graph notification is not authorized.')
      if (record.disabled || Date.parse(record.expiresAt) <= Date.now()) continue
      const admission = await new CollaborationLifecycle(this.store).readIdentity(record.owner)
      if (!admission.acceptingNewWork || record.generation !== admission.generation) continue
      const hintId = createHash('sha256').update(`${event.subscriptionId}:${record.generation}:${event.resourceData?.id ?? event.lifecycleEvent ?? 'available'}`).digest('hex')
      await this.store.insert(record.owner.partition, `transcript-event:${hintId}`, {
        request: record.request, subscriptionId: record.id, state: 'pending', generation: record.generation
      })
    }
  }
  async drain(principal: ExecutionPrincipal): Promise<void> {
    this.check(principal)
    const admission = await new CollaborationLifecycle(this.store).status(principal)
    if (!admission.acceptingNewWork) return
    const partition = principalPartition(principal)
    for (const row of await this.store.list(partition, 'transcript-event:', 20)) {
      const hint = hintSchema.parse(row.value)
      if (hint.generation !== admission.generation) continue
      if (!['pending', 'auth-required'].includes(hint.state)) continue
      const subscription = await this.store.read(this.partition, hint.subscriptionId)
      if (!subscription || subscriptionRecord.parse(subscription.value).disabled) continue
      if (!await this.store.replace(partition, row.key, row.revision, { ...hint, state: 'processing' })) continue
      let state: z.infer<typeof hintSchema>['state']
      try {
        await new CollaborationLifecycle(this.store).assertGeneration(principal, hint.generation)
        await this.available(principal, hint.request, hint.generation, row.key)
        state = 'processed'
      } catch { state = 'auth-required' }
      if (!await this.store.replace(partition, row.key, row.revision + 1, { ...hint, state })) throw new Error('Transcript notification processing could not be persisted.')
    }
  }
  async stop(principal: ExecutionPrincipal, raw: unknown): Promise<SubscriptionHealth> {
    this.check(principal)
    const request = meetingAcquisitionRequestSchema.parse(raw)
    const intent = await this.store.read(principalPartition(principal), this.key(request))
    if (!intent) return { state: 'foreground-only', detail: 'No active subscription is registered.' }
    const id = z.object({ id: z.uuid() }).parse(intent.value).id
    const row = await this.store.read(this.partition, id)
    if (!row) throw new Error('Subscription metadata is unavailable.')
    const record = subscriptionRecord.parse(row.value)
    if (record.owner.partition !== principalPartition(principal)) throw new Error('The subscription owner is not authorized.')
    if (!await this.store.replace(this.partition, id, row.revision, { ...record, disabled: true })) throw new Error('Subscription state changed concurrently.')
    try { await this.connector(principal).stop(id) } catch {
      return { state: 'unconfirmed', detail: 'Local background processing is stopped; remote subscription cleanup is unconfirmed and it will expire.' }
    }
    return { state: 'foreground-only', detail: 'Background processing and the Graph subscription are stopped.' }
  }
}
