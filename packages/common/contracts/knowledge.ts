import { z } from 'zod'

export const knowledgeContractVersion = '1.0' as const
export const knowledgeSourceIdSchema = z.enum(['mcem', 'seismic-m365', 'seismic-mcp'])
export const knowledgeFileTypeSchema = z.enum(['ppt', 'pptx', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'html'])
export const knowledgeSearchFiltersSchema = z.object({
  fileTypes: z.array(knowledgeFileTypeSchema).min(1).max(8).optional()
}).strict()

export const knowledgeSearchRequestSchema = z.object({
  contractVersion: z.literal(knowledgeContractVersion),
  query: z.string().trim().min(1).max(500),
  source: knowledgeSourceIdSchema,
  filters: knowledgeSearchFiltersSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).max(10_000).optional()
}).strict()

const httpsEvidenceUrl = z.url().max(4096).refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password
}, 'Knowledge evidence must use an HTTPS URL without credentials.')

export const knowledgeHitSchema = z.object({
  id: z.string().min(1).max(500),
  evidenceId: z.string().min(1).max(1000),
  source: knowledgeSourceIdSchema,
  title: z.string().trim().min(1).max(1000),
  url: httpsEvidenceUrl,
  snippet: z.string().max(4000).optional(),
  fileType: knowledgeFileTypeSchema.optional(),
  lastModifiedAt: z.iso.datetime({ offset: true }).optional(),
  connectionId: z.string().min(1).max(32).optional(),
  untrusted: z.literal(true)
}).strict()

export const knowledgeFailureCodeSchema = z.enum([
  'source-not-configured', 'mcp-not-configured', 'graph-not-configured',
  'graph-auth-not-configured', 'graph-sign-in-required', 'graph-permission-denied',
  'graph-throttled', 'graph-request-failed', 'graph-transport-failed',
  'graph-response-invalid', 'graph-response-too-large'
])

const sourceHealth = z.object({
  state: z.enum(['sample', 'live', 'partial', 'unauthorized', 'unavailable']),
  detail: z.string().min(1).max(1000),
  checkedAt: z.iso.datetime()
}).strict()
const common = {
  contractVersion: z.literal(knowledgeContractVersion),
  source: knowledgeSourceIdSchema,
  mode: z.enum(['sample', 'live']),
  sourceHealth
}

export const knowledgeSearchResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('results'),
    hits: z.array(knowledgeHitSchema).max(50),
    hasMore: z.boolean(),
    nextOffset: z.number().int().min(1).max(10_000).optional(),
    warnings: z.array(z.enum(['invalid-source-items', 'unverified-file-types'])).max(2)
  }).strict().superRefine((value, context) => {
    if (value.hasMore !== (value.nextOffset !== undefined)) {
      context.addIssue({ code: 'custom', message: 'A continuation offset is required exactly when more results are available.' })
    }
    if (value.sourceHealth.state !== value.mode && value.sourceHealth.state !== 'partial') {
      context.addIssue({ code: 'custom', message: 'Results require an available source.' })
    }
    if (value.hits.some((hit) => hit.source !== value.source)) {
      context.addIssue({ code: 'custom', message: 'Knowledge hits must come from the requested source.' })
    }
  }),
  z.object({
    ...common,
    kind: z.literal('unavailable'),
    code: knowledgeFailureCodeSchema,
    message: z.string().min(1).max(1000)
  }).strict().refine((value) => ['unauthorized', 'unavailable'].includes(value.sourceHealth.state),
    'Unavailable results must report an unavailable or unauthorized source.')
])

export type KnowledgeSourceId = z.infer<typeof knowledgeSourceIdSchema>
export type KnowledgeFileType = z.infer<typeof knowledgeFileTypeSchema>
export type KnowledgeHit = z.infer<typeof knowledgeHitSchema>
export type KnowledgeSearchFilters = z.infer<typeof knowledgeSearchFiltersSchema>
export type KnowledgeSearchRequest = z.infer<typeof knowledgeSearchRequestSchema>
export type KnowledgeSearchResponse = z.infer<typeof knowledgeSearchResponseSchema>
export type KnowledgeSearchPage = Pick<Extract<KnowledgeSearchResponse, { kind: 'results' }>, 'hits' | 'hasMore' | 'nextOffset' | 'warnings'>
export type KnowledgeFailureCode = z.infer<typeof knowledgeFailureCodeSchema>
