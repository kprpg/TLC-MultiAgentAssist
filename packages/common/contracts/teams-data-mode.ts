import { z } from 'zod'

export const teamsDataModeVersion = '1.0' as const
export const teamsDataModeSchema = z.enum(['sample', 'live'])
export type TeamsDataMode = z.infer<typeof teamsDataModeSchema>
export const teamsApiBasePathSchema = z.enum(['/api/teams', '/api/teams/sample', '/api/teams/live'])
export type TeamsApiBasePath = z.infer<typeof teamsApiBasePathSchema>
export const teamsDataModesSchema = z.object({
  contractVersion: z.literal(teamsDataModeVersion),
  initialMode: teamsDataModeSchema,
  runtimeMode: teamsDataModeSchema,
  runtimeAuthentication: z.enum(['hosted-obo', 'local-interactive', 'local-azure-cli']),
  availableModes: z.array(teamsDataModeSchema).min(1).max(2)
}).strict().superRefine((value, context) => {
  if (new Set(value.availableModes).size !== value.availableModes.length ||
      !value.availableModes.includes('sample') || !value.availableModes.includes(value.initialMode) ||
      !value.availableModes.includes(value.runtimeMode)) {
    context.addIssue({ code: 'custom', path: ['availableModes'], message: 'Available data modes must be unique and include Sample and both defaults.' })
  }
})
export type TeamsDataModes = z.infer<typeof teamsDataModesSchema>

export function teamsApiBasePath(mode: TeamsDataMode, runtimeMode: TeamsDataMode): TeamsApiBasePath {
  return mode === runtimeMode ? '/api/teams' : mode === 'sample' ? '/api/teams/sample' : '/api/teams/live'
}
