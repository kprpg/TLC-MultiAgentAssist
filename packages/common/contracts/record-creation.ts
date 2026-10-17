import { z } from 'zod'
import { contractVersion } from './version.js'

const clientKeySchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
const dateSchema = z.string().date()
const textSchema = z.string().trim().min(1).max(200)

export const recordCreationMaxMutations = 50

export const choiceRefSchema = z.object({
  value: z.number().int(),
  label: textSchema
}).strict()

export const lookupRefSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: textSchema
}).strict()

export const currencyRefSchema = lookupRefSchema.extend({ isoCode: z.string().length(3) })

export const recordCreationTargetSchema = z.enum(['sqlite', 'draft', 'live-msx'])

export const milestoneCreateInputSchema = z.object({
  clientMilestoneKey: clientKeySchema,
  name: z.string().trim().min(1).max(100),
  category: choiceRefSchema,
  milestoneDate: dateSchema,
  workload: lookupRefSchema,
  owner: lookupRefSchema.optional(),
  status: choiceRefSchema.optional(),
  commitment: choiceRefSchema.optional(),
  estimatedMonthlyUsage: z.number().finite().nonnegative().max(922337203685477).optional(),
  comments: z.string().max(35_000).optional(),
  riskDetails: z.string().trim().max(2_000).optional(),
  customerBudgetApproved: choiceRefSchema.optional()
}).strict().superRefine((item, context) => {
  if ((item.status?.value === 861980001 || item.status?.value === 861980002) && !item.riskDetails) {
    context.addIssue({ code: 'custom', path: ['riskDetails'], message: 'Risk/Blocker Details are required for At Risk or Blocked milestones.' })
  }
})

export const opportunityCreateInputSchema = z.object({
  clientOpportunityKey: clientKeySchema,
  name: z.string().trim().min(1).max(200),
  intent: z.array(choiceRefSchema).min(1).max(2).refine(
    (items) => new Set(items.map((item) => item.value)).size === items.length,
    'Opportunity Intent choices must not repeat.'
  ),
  estimatedValue: z.number().finite().nonnegative().max(1_000_000_000_000),
  priceList: lookupRefSchema.optional(),
  currency: lookupRefSchema.optional(),
  owner: lookupRefSchema.optional(),
  estimatedCloseDate: dateSchema,
  need: z.string().max(2_000).optional(),
  solutionArea: choiceRefSchema.optional(),
  technicalCapability: choiceRefSchema.optional()
}).strict()

export const opportunityBundleSchema = z.object({
  opportunity: opportunityCreateInputSchema,
  milestones: z.array(milestoneCreateInputSchema).max(50)
}).strict()

export const opportunityBatchDraftSchema = z.object({
  kind: z.literal('opportunity-batch'),
  account: lookupRefSchema,
  opportunities: z.array(opportunityBundleSchema).min(1).max(50)
}).strict()

export const existingOpportunityMilestoneBatchDraftSchema = z.object({
  kind: z.literal('existing-opportunity-milestone-batch'),
  account: lookupRefSchema,
  opportunity: lookupRefSchema,
  milestones: z.array(milestoneCreateInputSchema).min(1).max(50)
}).strict()

export const recordCreationDraftSchema = z.discriminatedUnion('kind', [
  opportunityBatchDraftSchema,
  existingOpportunityMilestoneBatchDraftSchema
]).superRefine((draft, context) => {
  const opportunityKeys = new Set<string>()
  const milestoneKeys = new Set<string>()
  const bundles = draft.kind === 'opportunity-batch'
    ? draft.opportunities.map((bundle, index) => ({ key: bundle.opportunity.clientOpportunityKey, milestones: bundle.milestones, index }))
    : [{ key: draft.opportunity.id, milestones: draft.milestones, index: 0 }]
  for (const { key, milestones, index } of bundles) {
    if (draft.kind === 'opportunity-batch' && opportunityKeys.has(key)) {
      context.addIssue({ code: 'custom', path: ['opportunities', index, 'opportunity', 'clientOpportunityKey'], message: 'Opportunity keys must be unique.' })
    }
    opportunityKeys.add(key)
    for (const [milestoneIndex, milestone] of milestones.entries()) {
      if (milestoneKeys.has(milestone.clientMilestoneKey)) {
        context.addIssue({
          code: 'custom',
          path: draft.kind === 'opportunity-batch' ? ['opportunities', index, 'milestones', milestoneIndex] : ['milestones', milestoneIndex],
          message: 'Milestone keys must be unique.'
        })
      }
      milestoneKeys.add(milestone.clientMilestoneKey)
    }
  }
})

const creationChoicesSchema = z.object({
  intent: z.array(choiceRefSchema),
  category: z.array(choiceRefSchema),
  status: z.array(choiceRefSchema),
  commitment: z.array(choiceRefSchema),
  customerBudgetApproved: z.array(choiceRefSchema),
  solutionArea: z.array(choiceRefSchema),
  technicalCapability: z.array(choiceRefSchema)
}).strict()

export const recordCreationCatalogSchema = z.object({
  contractVersion: z.literal(contractVersion),
  target: z.enum(['sqlite', 'draft']),
  revision: z.string().min(1),
  account: lookupRefSchema,
  opportunities: z.array(lookupRefSchema.extend({ currency: currencyRefSchema.optional() })),
  priceLists: z.array(lookupRefSchema),
  currencies: z.array(currencyRefSchema),
  workloads: z.array(lookupRefSchema),
  owners: z.array(lookupRefSchema),
  defaults: z.object({
    owner: lookupRefSchema,
    priceList: lookupRefSchema.optional(),
    currency: currencyRefSchema.optional()
  }).strict(),
  choices: creationChoicesSchema,
  maxMutations: z.number().int().positive().max(999)
}).strict()

export const recordCreationCatalogRequestSchema = z.object({
  contractVersion: z.literal(contractVersion),
  accountId: z.string().trim().min(1).max(200)
}).strict()

export const recordCreationPreviewRequestSchema = z.object({
  contractVersion: z.literal(contractVersion),
  target: recordCreationTargetSchema,
  draft: recordCreationDraftSchema
}).strict()

export const recordCreationPreviewSchema = z.object({
  contractVersion: z.literal(contractVersion),
  batchId: z.string().min(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  target: z.enum(['sqlite', 'draft']),
  catalogRevision: z.string().min(1),
  normalizedDraft: recordCreationDraftSchema,
  mutationCount: z.number().int().positive(),
  warnings: z.array(z.string().min(1)),
  expiresAt: z.string().datetime()
}).strict()

export const recordCreationCommitRequestSchema = z.object({
  contractVersion: z.literal(contractVersion),
  preview: recordCreationPreviewSchema,
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true)
}).strict()

export const recordCreationItemResultSchema = z.object({
  clientKey: z.string().min(1),
  kind: z.enum(['opportunity', 'milestone', 'deal-team']),
  recordId: z.string().min(1).optional(),
  parentRecordId: z.string().min(1).optional()
}).strict()

export const recordCreationResultSchema = z.object({
  contractVersion: z.literal(contractVersion),
  batchId: z.string().min(1),
  target: z.enum(['sqlite', 'draft']),
  state: z.enum(['committed', 'drafted', 'rolled-back', 'reconciled']),
  created: z.array(recordCreationItemResultSchema),
  audit: z.object({
    correlationId: z.string().min(1),
    opportunityCount: z.number().int().nonnegative(),
    milestoneCount: z.number().int().nonnegative(),
    committedAt: z.string().datetime().optional()
  }).strict(),
  message: z.string().min(1)
}).strict().superRefine((result, context) => {
  if (result.target === 'draft') {
    if (result.state !== 'drafted' || result.created.length > 0 || result.audit.committedAt) {
      context.addIssue({ code: 'custom', path: ['state'], message: 'Drafts cannot claim committed records or a commit time.' })
    }
  } else if (result.state === 'drafted') {
    context.addIssue({ code: 'custom', path: ['state'], message: 'A SQLite result cannot be a draft.' })
  }
  if (result.state === 'committed') {
    const count = (kind: typeof result.created[number]['kind']) => result.created.filter((item) => item.kind === kind).length
    if (!result.audit.committedAt || count('opportunity') !== result.audit.opportunityCount
      || count('deal-team') !== result.audit.opportunityCount || count('milestone') !== result.audit.milestoneCount) {
      context.addIssue({ code: 'custom', path: ['created'], message: 'A commit receipt must match its created-record counts and commit time.' })
    }
  }
})

export const recordCreationDraftResultSchema = z.object({
  contractVersion: z.literal(contractVersion),
  result: recordCreationResultSchema,
  files: z.array(z.object({
    name: z.string().min(1),
    content: z.string(),
    mimeType: z.string().min(1)
  }).strict()).min(1)
}).strict()

export const recordCreationErrorSchema = z.object({
  code: z.enum([
    'validation-failed', 'parent-unavailable', 'reference-unavailable', 'catalog-changed',
    'stale-preview', 'batch-too-large', 'target-disabled', 'already-committed',
    'transaction-failed', 'ambiguous-outcome'
  ]),
  message: z.string().min(1),
  path: z.array(z.union([z.string(), z.number()])).optional()
}).strict()

export type ChoiceRef = z.infer<typeof choiceRefSchema>
export type LookupRef = z.infer<typeof lookupRefSchema>
export type MilestoneCreateInput = z.infer<typeof milestoneCreateInputSchema>
export type OpportunityCreateInput = z.infer<typeof opportunityCreateInputSchema>
export type RecordCreationDraft = z.infer<typeof recordCreationDraftSchema>
export type RecordCreationCatalog = z.infer<typeof recordCreationCatalogSchema>
export type RecordCreationCatalogRequest = z.infer<typeof recordCreationCatalogRequestSchema>
export type RecordCreationPreviewRequest = z.infer<typeof recordCreationPreviewRequestSchema>
export type RecordCreationPreview = z.infer<typeof recordCreationPreviewSchema>
export type RecordCreationCommitRequest = z.infer<typeof recordCreationCommitRequestSchema>
export type RecordCreationResult = z.infer<typeof recordCreationResultSchema>
export type RecordCreationDraftResult = z.infer<typeof recordCreationDraftResultSchema>
export type RecordCreationErrorCode = z.infer<typeof recordCreationErrorSchema>['code']
