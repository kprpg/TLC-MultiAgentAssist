import { z } from 'zod'

export const contractVersion = '1.0' as const

export const dataModeSchema = z.enum(['sample', 'live'])
export const sourceStateSchema = z.enum([
  'sample',
  'live',
  'stale',
  'partial',
  'unauthorized',
  'unavailable'
])

export const sourceHealthSchema = z.object({
  source: z.enum(['msx', 'mcem', 'seismic', 'linkedin']),
  state: sourceStateSchema,
  detail: z.string().min(1),
  checkedAt: z.string().datetime()
})

export const authStatusSchema = z.object({
  state: z.enum(['ready', 'cli-missing', 'login-required', 'tenant-mismatch', 'consent-required', 'permission-missing']),
  displayName: z.string().min(1).optional(),
  tenantName: z.string().min(1).optional(),
  detail: z.string().min(1)
})

export const desktopDataStatusSchema = z.object({
  mode: dataModeSchema,
  auth: authStatusSchema
})

export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  segment: z.string().min(1)
})

export const opportunitySchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  name: z.string().min(1),
  recordedStage: z.number().int().min(1).max(5),
  value: z.number().nonnegative(),
  currency: z.string().length(3),
  closeDate: z.string().date()
})

export const evidenceSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['msx', 'mcem']),
  recordId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url().optional(),
  retrievedAt: z.string().datetime(),
  modifiedAt: z.string().datetime().optional(),
  accessContext: z.enum(['sample', 'delegated-user']),
  quality: z.enum(['authoritative', 'observed', 'stale', 'incomplete']),
  excerpt: z.string().min(1)
})

export const criterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['met', 'partial', 'missing']),
  rationale: z.string().min(1),
  evidenceIds: z.array(z.string().min(1))
})

export const recommendationSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    ownerRole: z.string().min(1),
    rationale: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
    assumption: z.boolean(),
    confidence: z.enum(['high', 'medium', 'low'])
  })
  .superRefine((recommendation, context) => {
    if (recommendation.evidenceIds.length === 0 && !recommendation.assumption) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'A recommendation must cite evidence or be labeled as an assumption.'
      })
    }
  })

export const mcemRequestSchema = z.object({
  contractVersion: z.literal(contractVersion),
  accountId: z.string().min(1),
  opportunityId: z.string().min(1),
  prompt: z.string().min(3).max(1000)
})

export const agentCapabilitySchema = z.enum([
  'account-pulse',
  'mcem-coach',
  'pursuit-executive',
  'risk-solution-play'
])

export const agentTaskRequestSchema = z.object({
  contractVersion: z.literal(contractVersion),
  capability: agentCapabilitySchema,
  accountId: z.string().min(1),
  opportunityId: z.string().min(1),
  prompt: z.string().min(3).max(1000)
})

export const agentTaskResponseSchema = z.object({
  contractVersion: z.literal(contractVersion),
  correlationId: z.string().uuid(),
  capability: agentCapabilitySchema,
  agentVersion: z.string().min(1),
  generatedAt: z.string().datetime(),
  mode: dataModeSchema,
  state: z.enum(['complete', 'partial', 'unauthorized']),
  content: z.string().min(1),
  sourceHealth: z.array(sourceHealthSchema).min(1)
})

export const emailComposeRequestSchema = z.object({
  contractVersion: z.literal(contractVersion),
  recipients: z.array(z.string().email()).min(1).max(20),
  subject: z.string().trim().min(1).max(255),
  responseTitle: z.string().trim().min(1).max(255),
  responseMarkdown: z.string().min(1).max(200_000)
}).strict()

export const emailComposeResultSchema = z.object({
  state: z.literal('opened')
}).strict()

export const exportResponseRequestSchema = z.object({
  contractVersion: z.literal(contractVersion),
  responseTitle: z.string().trim().min(1).max(255),
  responseMarkdown: z.string().min(1).max(200_000),
  generatedAt: z.string().datetime()
}).strict()

export const exportResponseResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('saved'), filePath: z.string().min(1) }).strict(),
  z.object({ state: z.literal('cancelled') }).strict()
])

export const mcemResponseSchema = z.object({
  contractVersion: z.literal(contractVersion),
  correlationId: z.string().uuid(),
  capability: z.literal('mcem-coach'),
  agentVersion: z.string().min(1),
  generatedAt: z.string().datetime(),
  mode: dataModeSchema,
  state: z.enum(['complete', 'partial', 'unauthorized']),
  summary: z.string().min(1),
  recordedStage: z.number().int().min(1).max(5),
  evidenceBasedStage: z.number().int().min(1).max(5),
  criteria: z.array(criterionSchema).min(1),
  recommendations: z.array(recommendationSchema).min(1),
  missingData: z.array(z.string().min(1)),
  evidence: z.array(evidenceSchema).min(1),
  sourceHealth: z.array(sourceHealthSchema).min(1)
})

export const feedbackSchema = z.object({
  correlationId: z.string().uuid(),
  agentVersion: z.string().min(1),
  capability: z.literal('mcem-coach'),
  category: z.enum(['useful', 'incorrect', 'missing-source', 'wrong-owner', 'other']),
  comment: z.string().max(500).optional()
})

export type Account = z.infer<typeof accountSchema>
export type Opportunity = z.infer<typeof opportunitySchema>
export type SourceHealth = z.infer<typeof sourceHealthSchema>
export type AuthStatus = z.infer<typeof authStatusSchema>
export type DesktopDataStatus = z.infer<typeof desktopDataStatusSchema>
export type McemRequest = z.infer<typeof mcemRequestSchema>
export type McemResponse = z.infer<typeof mcemResponseSchema>
export type AgentCapability = z.infer<typeof agentCapabilitySchema>
export type AgentTaskRequest = z.infer<typeof agentTaskRequestSchema>
export type AgentTaskResponse = z.infer<typeof agentTaskResponseSchema>
export type EmailComposeRequest = z.infer<typeof emailComposeRequestSchema>
export type EmailComposeResult = z.infer<typeof emailComposeResultSchema>
export type ExportResponseRequest = z.infer<typeof exportResponseRequestSchema>
export type ExportResponseResult = z.infer<typeof exportResponseResultSchema>
export type Feedback = z.infer<typeof feedbackSchema>