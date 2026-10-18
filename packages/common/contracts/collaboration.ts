import { z } from 'zod'

export const collaborationVersion = '1.0' as const
const identifier = z.string().min(1).max(500)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const base = z.object({ contractVersion: z.literal(collaborationVersion) })
export const contextBindingSchema = base.extend({
  id: identifier,
  kind: z.enum(['channel', 'chat', 'meeting']),
  accountId: identifier,
  opportunityId: identifier.optional(),
  contextId: identifier,
  revision: z.number().int().positive()
}).strict()
export const actionPreviewSchema = base.extend({
  id: identifier,
  operation: identifier,
  digest,
  expiresAt: z.iso.datetime(),
  input: z.record(z.string(), z.unknown()),
  before: z.unknown().optional(),
  state: z.literal('awaiting-approval')
}).strict()
export const actionApprovalSchema = base.extend({
  id: identifier,
  digest,
  reason: z.string().trim().min(3).max(1000)
}).strict()
export const actionReceiptSchema = base.extend({
  id: identifier,
  operation: identifier,
  state: z.enum(['confirmed', 'failed-before-send', 'effect-unknown']),
  occurredAt: z.iso.datetime(),
  result: z.unknown().optional()
}).strict()
export const acquisitionSchema = base.extend({
  id: identifier,
  state: z.enum(['ready', 'waiting', 'denied', 'admin-blocked', 'auth-required', 'unsupported', 'paused']),
  meetingId: identifier,
  transcriptIds: z.array(identifier),
  attribution: z.enum(['attributed', 'unattributed', 'unknown']),
  detail: z.string().min(1),
  checkedAt: z.iso.datetime()
}).strict()
export const activityItemSchema = base.extend({
  id: identifier,
  category: z.enum(['action', 'workflow', 'acquisition', 'publication', 'notification']),
  state: identifier,
  title: identifier,
  occurredAt: z.iso.datetime()
}).strict()
export type ContextBinding = z.infer<typeof contextBindingSchema>
export type ActionPreview = z.infer<typeof actionPreviewSchema>
export type ActionApproval = z.infer<typeof actionApprovalSchema>
export type ActionReceipt = z.infer<typeof actionReceiptSchema>
export type Acquisition = z.infer<typeof acquisitionSchema>
export type ActivityItem = z.infer<typeof activityItemSchema>

export const teamsSessionSchema = base.extend({
  mode: z.enum(['sample', 'live']),
  roles: z.array(z.string()),
  displayName: z.string().min(1)
}).strict()
export const teamsPublicConfigurationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('sample') }).strict(),
  z.object({ mode: z.literal('live'), tenantId: z.uuid(), spaClientId: z.uuid(), apiScope: z.string().min(1) }).strict()
])
export type TeamsSession = z.infer<typeof teamsSessionSchema>

export const collaborationLifecycleCommandSchema = base.extend({
  command: z.enum(['pause', 'resume', 'retire'])
}).strict()
export const collaborationLifecycleSchema = base.extend({
  state: z.enum(['active', 'paused', 'retired']),
  generation: z.number().int().nonnegative(),
  acceptingNewWork: z.boolean()
}).strict()
export type CollaborationLifecycleStatus = z.infer<typeof collaborationLifecycleSchema>
