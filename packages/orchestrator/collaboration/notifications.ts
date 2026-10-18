import { z } from 'zod'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import { principalPartition, requireRole, type ExecutionPrincipal } from './principal.js'
import { CollaborationAdmissionError, CollaborationLifecycle } from './lifecycle.js'
import { acquisitionSchema, type Acquisition } from '../../common/contracts/collaboration.js'

const notificationSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(100),
  reference: z.string().min(1).max(500),
  state: z.enum(['pending', 'sending', 'delivered', 'delivery-unknown', 'cancelled']),
  generation: z.number().int().nonnegative().default(0),
  occurredAt: z.iso.datetime()
}).strict()
export type PersonalNotification = z.infer<typeof notificationSchema>

export class NotificationOutbox {
  constructor(private readonly store: ScopedDocumentStore) {}
  async enqueueAcquisition(principal: ExecutionPrincipal, result: { status: Acquisition; evidenceVersion?: string }): Promise<void> {
    requireRole(principal, 'TLC.Teams.User')
    const status = acquisitionSchema.parse(result.status)
    if (status.state === 'waiting') return
    const version = status.state === 'ready' ? z.string().regex(/^[a-f0-9]{64}$/).parse(result.evidenceVersion) : 'status'
    await this.enqueue(principal, `meeting:${status.id}:${status.state}:${version}`,
      status.state === 'ready' ? 'Meeting review ready' : 'Meeting acquisition needs attention', status.id)
  }
  async enqueue(principal: ExecutionPrincipal, eventId: string, title: string, reference: string): Promise<void> {
    requireRole(principal, 'TLC.Teams.User')
    const admission = await new CollaborationLifecycle(this.store).status(principal)
    const notification = notificationSchema.parse({
      id: eventId, title, reference, state: admission.acceptingNewWork ? 'pending' : 'cancelled',
      generation: admission.generation, occurredAt: new Date().toISOString()
    })
    await this.store.insert(principalPartition(principal), `notification:${eventId}`, notification)
  }
  async list(principal: ExecutionPrincipal): Promise<PersonalNotification[]> {
    requireRole(principal, 'TLC.Teams.User')
    const admission = await new CollaborationLifecycle(this.store).status(principal)
    return (await this.store.list(principalPartition(principal), 'notification:', 100)).map((row) => {
      const notification = notificationSchema.parse(row.value)
      return notification.state === 'pending' && notification.generation !== admission.generation
        ? { ...notification, state: 'cancelled' as const } : notification
    })
  }
  async deliver(principal: ExecutionPrincipal, send: (notification: PersonalNotification) => Promise<void>): Promise<void> {
    requireRole(principal, 'TLC.Teams.User')
    const partition = principalPartition(principal)
    const lifecycle = new CollaborationLifecycle(this.store)
    if (!(await lifecycle.status(principal)).acceptingNewWork) return
    for (const row of await this.store.list(partition, 'notification:', 100)) {
      const notification = notificationSchema.parse(row.value)
      if (notification.state !== 'pending') continue
      const admission = await lifecycle.status(principal)
      if (!admission.acceptingNewWork || admission.generation !== notification.generation) {
        if (!await this.store.replace(partition, row.key, row.revision, { ...notification, state: 'cancelled' })) {
          throw new Error('Pending notification cancellation changed concurrently.')
        }
        continue
      }
      if (!await this.store.replace(partition, row.key, row.revision, { ...notification, state: 'sending' })) continue
      let state: PersonalNotification['state']
      try {
        const current = await lifecycle.assertActive(principal)
        if (current.generation !== notification.generation) throw new CollaborationAdmissionError('collaboration_paused')
        await send(notification)
        state = 'delivered'
      } catch (error) {
        state = error instanceof CollaborationAdmissionError ? 'cancelled' : 'delivery-unknown'
      }
      if (!await this.store.replace(partition, row.key, row.revision + 1, { ...notification, state })) {
        throw new Error('Notification delivery is unconfirmed. Do not repeat it automatically.')
      }
    }
  }
}
