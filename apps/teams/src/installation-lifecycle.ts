import { z } from 'zod'
import type { ScopedDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { CollaborationLifecycle } from '../../../packages/orchestrator/collaboration/lifecycle.js'
import type { PrincipalIdentity } from '../../../packages/orchestrator/collaboration/principal.js'

const activitySchema = z.object({
  tenantId: z.uuid(), userId: z.uuid().optional(),
  conversationId: z.string().min(1).max(500),
  conversationType: z.string().min(1).max(50),
  channelId: z.string().min(1).max(500).optional(),
  teamId: z.string().min(1).max(500).optional(),
  timestamp: z.union([z.iso.datetime(), z.date()]).optional()
}).strict()
const referenceSchema = z.object({
  conversationId: z.string(),
  disabled: z.boolean(),
  installationEventAt: z.iso.datetime().optional()
}).passthrough()

export async function updateVerifiedTeamsInstallation(options: {
  store: ScopedDocumentStore
  scope: { tenantId: string; environmentId: string }
  onDeactivate?(identity: PrincipalIdentity): Promise<void>
}, raw: unknown, action: 'add' | 'remove'): Promise<void> {
  const activity = activitySchema.parse(raw)
  if (activity.tenantId.toLowerCase() !== options.scope.tenantId.toLowerCase()) throw new Error('The installation tenant is not authorized.')
  const partition = `${options.scope.tenantId}:${options.scope.environmentId}:delivery`
  let userId = activity.userId
  if (activity.conversationType === 'personal' && !userId) {
    const owner = await options.store.read(partition, `conversation-owner:${activity.conversationId}`)
    if (owner) userId = z.object({ userId: z.uuid() }).strict().parse(owner.value).userId
    if (!userId) throw new Error('The personal installation owner could not be verified.')
  }
  const key = activity.conversationType === 'personal' ? `personal:${userId}`
    : activity.teamId ? `team:${activity.teamId}`
      : activity.channelId ? `channel:${activity.channelId}` : `chat:${activity.conversationId}`
  const eventAt = activity.timestamp instanceof Date ? activity.timestamp.toISOString() : activity.timestamp ?? new Date().toISOString()
  const eventTime = Date.parse(eventAt)
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await options.store.read(partition, key)
    const previous = row ? referenceSchema.parse(row.value) : undefined
    if (previous?.installationEventAt && (Date.parse(previous.installationEventAt) > eventTime
      || Date.parse(previous.installationEventAt) === eventTime && previous.disabled && action === 'add')) return
    if (action === 'remove' && previous && !previous.installationEventAt && previous.conversationId !== activity.conversationId) return
    const value = { ...previous, conversationId: activity.conversationId, disabled: action === 'remove', installationEventAt: eventAt }
    const changed = row ? await options.store.replace(partition, key, row.revision, value) : await options.store.insert(partition, key, value)
    if (!changed) continue
    if (action === 'remove' && activity.conversationType === 'personal' && userId) {
      const identity: PrincipalIdentity = { ...options.scope, userId }
      await new CollaborationLifecycle(options.store).deactivate(identity)
      await options.onDeactivate?.(identity)
    }
    return
  }
  throw new Error('The installation state changed concurrently. Its outcome requires reconciliation.')
}
