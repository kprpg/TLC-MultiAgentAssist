import { z } from 'zod'

export const accountProvenanceSchema = z.enum(['deal-team', 'manual', 'both'])
export const accountVisibilitySchema = z.enum(['visible', 'hidden'])

export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  segment: z.string().min(1),
  tpid: z.string().min(1).optional(),
  provenance: accountProvenanceSchema.optional(),
  visibility: accountVisibilitySchema.optional()
})

export const accountSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(120),
  matchBy: z.enum(['name', 'tpid'])
}).strict().superRefine((value, context) => {
  if (value.matchBy === 'name' && value.query.length < 2) {
    context.addIssue({
      code: 'custom',
      path: ['query'],
      message: 'Account name searches require at least two characters.'
    })
  }
})

export const accountCandidateSchema = accountSchema.extend({
  state: z.enum(['not-added', 'visible', 'hidden'])
}).strict()

export const accountListOptionsSchema = z.object({
  includeHidden: z.boolean().optional()
}).strict()

export const accountVisibilityMutationSchema = z.object({
  visibility: accountVisibilitySchema
}).strict()

export const dealTeamJoinResultSchema = z.object({
  opportunityId: z.string().min(1),
  onDealTeam: z.literal(true),
  alreadyMember: z.boolean()
}).strict()

export const dealTeamLeaveResultSchema = z.object({
  opportunityId: z.string().min(1),
  onDealTeam: z.literal(false),
  alreadyAbsent: z.boolean()
}).strict()

export type Account = z.infer<typeof accountSchema>
export type AccountCandidate = z.infer<typeof accountCandidateSchema>
export type AccountListOptions = z.infer<typeof accountListOptionsSchema>
export type AccountSearchRequest = z.infer<typeof accountSearchRequestSchema>
export type AccountVisibility = z.infer<typeof accountVisibilitySchema>
export type DealTeamJoinResult = z.infer<typeof dealTeamJoinResultSchema>
export type DealTeamLeaveResult = z.infer<typeof dealTeamLeaveResultSchema>
