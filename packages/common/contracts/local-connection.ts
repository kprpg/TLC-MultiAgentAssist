import { z } from 'zod'

export const localConnectionVersion = '1.0' as const
const base = z.object({ contractVersion: z.literal(localConnectionVersion) })
export const localCapabilitySchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  state: z.enum(['available', 'requires-source-grant', 'requires-configuration', 'requires-redesign', 'unavailable-local']),
  detail: z.string().min(1).max(1000)
}).strict()
export const nativeCapabilities: z.infer<typeof localCapabilitySchema>[] = [
  { id: 'msx', title: 'Live MSX Portfolio', state: 'requires-source-grant', detail: 'Connect your approved native identity and verify your own Dataverse access.' },
  { id: 'mcp', title: 'Dataverse MCP Plays', state: 'requires-source-grant', detail: 'REST access does not establish the native client MCP scope or allowlisting.' },
  { id: 'reviewed-writes', title: 'Reviewed source changes', state: 'requires-source-grant', detail: 'Requires native writer eligibility, source permission, exact review and native concurrency evidence.' },
  { id: 'guidance', title: 'MCEM and live guidance', state: 'available', detail: 'Deterministic guidance over your live source context; no claim of a Foundry model response.' },
  { id: 'foundry', title: 'Foundry agents', state: 'requires-configuration', detail: 'An optional approved workload credential and project are separate from MSX connectivity.' },
  { id: 'graph', title: 'Meeting transcripts', state: 'requires-source-grant', detail: 'Optional delegated Graph reads require separate grants and actual meeting access; local foreground acquisition only.' },
  { id: 'shared-contexts', title: 'Shared channel and chat bindings', state: 'requires-redesign', detail: 'Another device cannot resolve this installation’s private binding IDs. No shared TLC store is assumed.' },
  { id: 'stage', title: 'Shared meeting stage', state: 'requires-redesign', detail: 'Approved artifact distribution and current audience admission remain required; private source access is not publication authority.' },
  { id: 'bot', title: 'Cloud bot and message extensions', state: 'unavailable-local', detail: 'Microsoft cloud callbacks cannot reach another user’s private localhost listener.' },
  { id: 'notifications', title: 'Notifications and Activity', state: 'available', detail: 'Private local Activity is available. Proactive Teams delivery is not implied.' },
  { id: 'seller-dashboard', title: 'Live Seller Dashboard', state: 'requires-redesign', detail: 'Native MSX connection does not authorize reading a Windows earnings profile; the existing privacy denial is retained.' }
]
export const nativePublicConfigurationSchema = base.extend({
  mode: z.literal('live'),
  authentication: z.literal('local-interactive'),
  capabilities: z.array(localCapabilitySchema).min(1)
}).strict()
export const cliPublicConfigurationVersion = '1.2' as const
export const cliWriteModeSchema = z.enum(['read-only', 'reviewed'])
export type CliWriteMode = z.infer<typeof cliWriteModeSchema>
export const cliCapabilities: z.infer<typeof localCapabilitySchema>[] = nativeCapabilities.map((capability) => {
  if (capability.id === 'msx') return { ...capability, detail: 'Use the current Azure CLI user, verify their Dataverse identity and load their active deal-team accounts. Source access is read-only.' }
  if (capability.id === 'reviewed-writes') return {
    ...capability, state: 'unavailable-local',
    detail: 'This CLI connection is read-only. Enable explicit reviewed-write mode to review source changes under your own MSX permissions.'
  }
  if (['mcp', 'graph', 'foundry'].includes(capability.id)) return {
    ...capability, state: 'unavailable-local',
    detail: 'This CLI profile does not request this optional resource grant. Use an approved native profile for separately granted capabilities.'
  }
  return { ...capability }
})
export function getCliCapabilities(writeMode: CliWriteMode): z.infer<typeof localCapabilitySchema>[] {
  return cliCapabilities.map((capability) => {
    if (writeMode === 'reviewed' && capability.id === 'msx') return {
      ...capability, detail: 'Use the verified current Azure CLI user and their own Dataverse permissions. Every source change requires exact review and approval.'
    }
    if (writeMode === 'reviewed' && capability.id === 'reviewed-writes') return {
      ...capability, state: 'requires-source-grant',
      detail: 'Desktop-equivalent MSX operations use the shared core, explicit review, source permissions, concurrency checks and durable action receipts. No FTE or publication role is inferred.'
    }
    return { ...capability }
  })
}
export const cliPublicConfigurationSchema = z.object({
  contractVersion: z.literal(cliPublicConfigurationVersion),
  mode: z.literal('live'),
  authentication: z.literal('local-azure-cli'),
  writeMode: cliWriteModeSchema,
  capabilities: z.array(localCapabilitySchema).min(1)
}).strict()
export const localPairRequestSchema = base.extend({
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  contextTenantId: z.uuid().optional(),
  contextUserId: z.uuid().optional()
}).strict()
export const localPairRequestResultSchema = base.extend({
  requestId: z.uuid(),
  userCode: z.string().regex(/^[A-F0-9]{8}$/),
  expiresAt: z.iso.datetime(),
  state: z.literal('pending-owner-approval')
}).strict()
export const localPairExchangeSchema = base.extend({
  requestId: z.uuid(),
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/)
}).strict()
export const localPairResultSchema = z.discriminatedUnion('state', [
  base.extend({ state: z.literal('pending-owner-approval'), expiresAt: z.iso.datetime() }).strict(),
  base.extend({ state: z.literal('paired'), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.iso.datetime() }).strict()
])
export const localRevokeRequestSchema = base.strict()
export const localRevokeResultSchema = base.extend({ state: z.literal('disconnected') }).strict()
export const nativeResourceSchema = z.enum(['msx', 'mcp', 'graph'])
export const nativeConnectionStatusSchema = base.extend({
  state: z.enum(['sign-in-required', 'connecting', 'connected', 'reconnect-required', 'blocked']),
  detail: z.string().min(1).max(1000),
  account: z.string().max(500).optional(),
  resources: z.array(z.object({
    resource: nativeResourceSchema,
    state: z.enum(['not-connected', 'connected', 'consent-required', 'denied', 'unavailable']),
    detail: z.string().min(1).max(1000)
  }).strict()),
  capabilities: z.array(localCapabilitySchema)
}).strict()
export type NativeConnectionStatus = z.infer<typeof nativeConnectionStatusSchema>
export type NativeResource = z.infer<typeof nativeResourceSchema>
export type LocalPairRequestResult = z.infer<typeof localPairRequestResultSchema>

export const localOwnerCommandSchema = z.discriminatedUnion('action', [
  base.extend({ action: z.literal('status') }).strict(),
  base.extend({ action: z.literal('connect'), resource: nativeResourceSchema }).strict(),
  base.extend({ action: z.literal('approve'), userCode: z.string().regex(/^[A-F0-9]{8}$/) }).strict(),
  base.extend({ action: z.literal('disconnect') }).strict()
])
export const localOwnerResultSchema = z.discriminatedUnion('ok', [
  base.extend({
    ok: z.literal(true), status: nativeConnectionStatusSchema,
    pending: z.array(z.object({ userCode: z.string().regex(/^[A-F0-9]{8}$/), expiresAt: z.iso.datetime(), approved: z.boolean() }).strict()).max(3)
  }).strict(),
  base.extend({ ok: z.literal(false), error: z.string().regex(/^[a-z_]{1,100}$/) }).strict()
])
export const localOwnerRecordSchema = base.extend({
  instanceId: z.uuid(), processId: z.int().positive(), origin: z.url()
}).strict()
export type LocalOwnerCommand = z.infer<typeof localOwnerCommandSchema>
export type LocalOwnerResult = z.infer<typeof localOwnerResultSchema>
export type LocalOwnerRecord = z.infer<typeof localOwnerRecordSchema>
