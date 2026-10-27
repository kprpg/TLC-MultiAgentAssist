import { z } from 'zod'
import { inferenceExecutionSchema, inferenceResponseVersion, validateInferenceResponse } from './inference.js'

export const workingSessionContractVersion = '1.0' as const

const shortText = (max: number) => z.string().trim().min(1).max(max)
const untrustedText = (max: number) => z.string().max(max)

export const workingSessionTopicRequestSchema = z.object({
  contractVersion: z.literal(workingSessionContractVersion),
  opportunityId: shortText(200),
  opportunityName: shortText(300),
  opportunityComments: untrustedText(4000).optional(),
  milestoneId: shortText(200).optional(),
  milestoneName: shortText(300),
  milestoneComments: untrustedText(4000).optional()
}).strict()

export const workingSessionTopicSchema = z.object({
  topic: shortText(200),
  domain: shortText(100),
  azureServices: z.array(shortText(80)).max(8),
  deckQueries: z.array(shortText(120)).min(1).max(5),
  learnQueries: z.array(shortText(120)).min(1).max(5),
  iacScenario: shortText(300),
  confidence: z.enum(['low', 'medium', 'high']),
  basis: z.enum(['model', 'rules']),
  evidence: z.array(shortText(200)).max(8)
}).strict()

export const workingSessionTopicResponseSchema = z.object({
  contractVersion: z.enum([workingSessionContractVersion, inferenceResponseVersion]),
  inference: inferenceExecutionSchema.optional(),
  mode: z.enum(['sample', 'live']),
  topic: workingSessionTopicSchema
}).strict().superRefine(validateInferenceResponse)

export const workingSessionDeliverablesSchema = z.object({
  decks: z.boolean(),
  learn: z.boolean(),
  iac: z.boolean()
}).strict().refine((value) => value.decks || value.learn || value.iac, 'Choose at least one deliverable.')

export const workingSessionPrepareRequestSchema = z.object({
  contractVersion: z.literal(workingSessionContractVersion),
  opportunityId: shortText(200),
  opportunityName: shortText(300),
  milestoneName: shortText(300),
  topic: workingSessionTopicSchema,
  deliverables: workingSessionDeliverablesSchema
}).strict()

const relativeFilePath = z.string().min(1).max(260).refine((value) =>
  !/^([a-zA-Z]:|[\\/])/.test(value) && !value.split(/[\\/]/).some((part) => part === '..' || part === '' || part === '.'),
'File paths must be relative and stay inside the working-session folder.')

const httpsUrl = z.url().max(4096).refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password
}, 'Source links must use HTTPS without credentials.')

export const workingSessionFileSchema = z.object({
  path: relativeFilePath,
  kind: z.enum(['deck', 'learn', 'iac', 'manifest']),
  title: shortText(300),
  sourceLabel: shortText(200),
  sourceUrl: httpsUrl.optional(),
  bytes: z.number().int().min(0)
}).strict()

export const workingSessionGapCodeSchema = z.enum([
  'not-configured', 'needs-consent', 'not-available-here', 'nothing-found', 'unavailable', 'tool-missing', 'rejected'
])

export const workingSessionGapSchema = z.object({
  deliverable: z.enum(['decks', 'learn', 'iac']),
  source: shortText(120),
  code: workingSessionGapCodeSchema,
  message: shortText(600)
}).strict()

export const workingSessionDeliverySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('folder'), folderPath: shortText(1000) }).strict(),
  z.object({ kind: z.literal('download'), downloadId: z.string().uuid(), fileName: shortText(200), expiresAt: z.string().datetime() }).strict()
])

export const workingSessionResultSchema = z.object({
  contractVersion: z.enum([workingSessionContractVersion, inferenceResponseVersion]),
  inference: inferenceExecutionSchema.optional(),
  mode: z.enum(['sample', 'live']),
  folderName: shortText(200),
  delivery: workingSessionDeliverySchema,
  files: z.array(workingSessionFileSchema).max(200),
  gaps: z.array(workingSessionGapSchema).max(50),
  summary: shortText(1000)
}).strict().superRefine(validateInferenceResponse)

export const workingSessionOpenFolderRequestSchema = z.object({ folderPath: shortText(1000) }).strict()

export type WorkingSessionTopicRequest = z.infer<typeof workingSessionTopicRequestSchema>
export type WorkingSessionTopic = z.infer<typeof workingSessionTopicSchema>
export type WorkingSessionTopicResponse = z.infer<typeof workingSessionTopicResponseSchema>
export type WorkingSessionDeliverables = z.infer<typeof workingSessionDeliverablesSchema>
export type WorkingSessionPrepareRequest = z.infer<typeof workingSessionPrepareRequestSchema>
export type WorkingSessionFile = z.infer<typeof workingSessionFileSchema>
export type WorkingSessionGap = z.infer<typeof workingSessionGapSchema>
export type WorkingSessionResult = z.infer<typeof workingSessionResultSchema>
