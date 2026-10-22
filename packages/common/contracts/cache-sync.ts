import { z } from 'zod'

export const cacheSyncVersion = '1.0' as const

export const cachePolicySchema = z.object({
  mutableFreshMs: z.number().int().positive().default(5 * 60_000),
  referenceFreshMs: z.number().int().positive().default(30 * 60_000),
  maxInactiveEntries: z.number().int().min(1).max(1000).default(100),
  maxSerializedBytes: z.number().int().min(1024).default(64 * 1024 * 1024),
  readRetries: z.number().int().min(0).max(2).default(2),
  maxConcurrentWrites: z.number().int().min(1).max(2).default(2),
  confirmedRetentionMs: z.number().int().positive().default(30 * 24 * 60 * 60_000)
}).strict()
export const defaultCachePolicy = Object.freeze(cachePolicySchema.parse({}))
export type CachePolicy = z.infer<typeof cachePolicySchema>

export const cacheReadStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  dataRevision: z.number().int().nonnegative().optional(),
  generation: z.number().int().nonnegative(),
  fetchedAt: z.number().finite().nonnegative().optional(),
  validatedAt: z.number().finite().nonnegative().optional(),
  refreshing: z.boolean(),
  stale: z.boolean(),
  error: z.string().optional()
}).strict()
export type CacheReadState = z.infer<typeof cacheReadStateSchema>
const readKey = z.string().min(1).max(500).regex(/^(portfolio|discovery|(?:milestones|activities|catalog|search):.+)$/)
export const cacheControlRequestSchema = z.discriminatedUnion('operation', [
  z.object({ contractVersion: z.literal(cacheSyncVersion), operation: z.literal('interest'), keys: z.array(readKey).max(100), active: z.boolean(), consumer: z.string().min(1).max(100).optional() }).strict(),
  z.object({ contractVersion: z.literal(cacheSyncVersion), operation: z.literal('refresh'), opportunityId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ contractVersion: z.literal(cacheSyncVersion), operation: z.literal('state') }).strict()
])
export const cacheControlResponseSchema = z.object({
  contractVersion: z.literal(cacheSyncVersion), state: cacheReadStateSchema
}).strict()
export type CacheControlRequest = z.infer<typeof cacheControlRequestSchema>
export type CacheControlResponse = z.infer<typeof cacheControlResponseSchema>

export const syncMutationOperationSchema = z.enum([
  'addAccount', 'setAccountVisibility',
  'joinDealTeam', 'leaveDealTeam', 'joinMilestoneTeam', 'leaveMilestoneTeam',
  'updateOpportunity', 'updateMilestone', 'createMilestoneActivity',
  'transitionOpportunityStage', 'commitRecordCreation', 'applyMeetingChangeSet'
])
export type SyncMutationOperation = z.infer<typeof syncMutationOperationSchema>

export const mutationStateSchema = z.enum([
  'accepted', 'dispatching', 'confirmed', 'failed-before-send',
  'conflict', 'effect-unknown', 'reconciled-current-state'
])
export type MutationState = z.infer<typeof mutationStateSchema>
export const mutationFailureCodeSchema = z.enum([
  'validation', 'access-denied', 'auth-required', 'source-conflict', 'source-unavailable',
  'outcome-unconfirmed', 'capacity', 'session-changed', 'storage-unavailable',
  'review-expired', 'review-changed', 'unsupported'
])
export type MutationFailureCode = z.infer<typeof mutationFailureCodeSchema>

const identifier = z.string().min(1).max(500)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const envelope = z.object({ contractVersion: z.literal(cacheSyncVersion) })

export const mutationCapabilitiesSchema = envelope.extend({
  available: z.boolean(),
  recoveryAvailable: z.boolean().optional(),
  readCacheOwner: z.enum(['host', 'client']),
  operations: z.array(syncMutationOperationSchema),
  reason: z.string().min(1).optional()
}).strict()
export type MutationCapabilities = z.infer<typeof mutationCapabilitiesSchema>

export const mutationReviewSchema = envelope.extend({
  id: z.string().uuid(),
  operation: syncMutationOperationSchema,
  input: z.record(z.string(), z.unknown()),
  digest,
  expiresAt: z.string().datetime(),
  before: z.unknown().optional(),
  recordKeys: z.array(identifier).min(1).max(100)
}).strict()
export type MutationReview = z.infer<typeof mutationReviewSchema>

export const mutationReceiptSchema = envelope.extend({
  id: z.string().uuid(),
  operation: syncMutationOperationSchema,
  state: mutationStateSchema,
  acceptedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  recordKeys: z.array(identifier).min(1).max(100),
  code: mutationFailureCodeSchema.optional(),
  result: z.unknown().optional()
}).strict()
export type MutationReceipt = z.infer<typeof mutationReceiptSchema>

export const mutationSyncRequestSchema = z.discriminatedUnion('operation', [
  envelope.extend({ operation: z.literal('capabilities') }).strict(),
  envelope.extend({
    operation: z.literal('prepare'),
    mutation: syncMutationOperationSchema,
    input: z.record(z.string(), z.unknown())
  }).strict(),
  envelope.extend({
    operation: z.literal('submit'),
    id: z.string().uuid(),
    digest,
    reason: z.string().trim().min(3).max(1000),
    confirmed: z.literal(true)
  }).strict(),
  envelope.extend({ operation: z.literal('status'), id: z.string().uuid() }).strict(),
  envelope.extend({ operation: z.literal('pending') }).strict(),
  envelope.extend({ operation: z.literal('reconcile'), id: z.string().uuid() }).strict()
])
export type MutationSyncRequest = z.infer<typeof mutationSyncRequestSchema>

export const mutationSyncResponseSchema = z.discriminatedUnion('kind', [
  envelope.extend({ kind: z.literal('capabilities'), capabilities: mutationCapabilitiesSchema }).strict(),
  envelope.extend({ kind: z.literal('review'), review: mutationReviewSchema }).strict(),
  envelope.extend({ kind: z.literal('receipt'), receipt: mutationReceiptSchema }).strict(),
  envelope.extend({ kind: z.literal('pending'), receipts: z.array(mutationReceiptSchema).max(100) }).strict()
])
export type MutationSyncResponse = z.infer<typeof mutationSyncResponseSchema>
