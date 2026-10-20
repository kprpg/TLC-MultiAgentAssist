import { z } from 'zod'

export const teamsLaunchVersion = '1.0' as const
const base = z.object({ contractVersion: z.literal(teamsLaunchVersion) })
const runId = z.string().regex(/^[a-f0-9]{32}$/)
const packageVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
export const teamsClientBuildSchema = base.extend({ buildId: z.uuid() }).strict()
export const teamsLaunchIdentitySchema = base.extend({
  runId,
  clientBuildId: z.uuid(),
  packageId: z.uuid(),
  packageVersion,
  origin: z.url().refine((value) => value === new URL(value).origin),
  mode: z.enum(['sample', 'live']),
  authentication: z.enum(['hosted-obo', 'local-interactive', 'local-azure-cli'])
}).strict()
export const teamsClientReadyRequestSchema = base.extend({
  runId,
  clientBuildId: z.uuid(),
  packageVersion,
  host: z.enum(['teams', 'browser'])
}).strict()
export const teamsClientReadyResultSchema = base.extend({ state: z.literal('ready') }).strict()
export const teamsLaunchStatusSchema = teamsLaunchIdentitySchema.extend({
  clients: z.array(z.object({
    host: z.enum(['teams', 'browser']),
    checkedAt: z.iso.datetime(),
    pairingCode: z.string().regex(/^[A-F0-9]{8}$/).optional()
  }).strict()).max(10)
}).strict()
export type TeamsLaunchIdentity = z.infer<typeof teamsLaunchIdentitySchema>
export type TeamsLaunchStatus = z.infer<typeof teamsLaunchStatusSchema>
