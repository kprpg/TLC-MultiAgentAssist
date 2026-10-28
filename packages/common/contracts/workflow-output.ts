import { z } from 'zod'
import { sourceHealthSchema } from './index.js'
import { mcpEvidenceLineageSchema, scopeRefSchema, workflowResultCardSchema, workflowRunSchema } from './workflows.js'

export const initialWorkflowIds = ['WF-001', 'WF-002', 'WF-003', 'WF-004', 'WF-005', 'WF-006', 'WF-007', 'WF-008', 'WF-009', 'WF-010', 'WF-011', 'WF-012'] as const
export type InitialWorkflowId = typeof initialWorkflowIds[number]

export const workflowRecordReferenceSchema = z.object({
  recordId: z.string().min(1).max(200),
  kind: z.enum(['opportunity', 'milestone', 'activity']),
  accountId: z.string().min(1).max(200).optional(),
  opportunityId: z.string().min(1).max(200).optional(),
  milestoneId: z.string().min(1).max(200).optional(),
  queueItemId: z.string().min(1).max(240).optional(),
  cardIndex: z.number().int().nonnegative(),
  ownerId: z.string().min(1).max(200).optional(),
  ownerName: z.string().min(1).max(500).optional()
}).strict()

export const workflowProjectionSchema = z.object({
  records: z.array(workflowRecordReferenceSchema).max(500),
  maximumActiveItems: z.number().int().min(1).max(100).optional()
}).strict()

export const workflowQueueItemSchema = z.object({
  id: z.string().min(1),
  workflowId: z.enum(initialWorkflowIds),
  priority: z.enum(['P0', 'P1', 'P2']),
  title: z.string().min(1),
  owner: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  accountName: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  opportunityName: z.string().min(1).optional(),
  dueDate: z.string().date().optional(),
  evidenceIds: z.array(z.string().min(1)),
  status: z.literal('new')
}).strict()

export const initialWorkflowOutputSchema = z.object({
  contractVersion: z.enum(['1.0', '2.0']),
  workflowId: z.enum(initialWorkflowIds),
  generatedAt: z.string().datetime(),
  scope: scopeRefSchema,
  card: workflowResultCardSchema,
  queueItems: z.array(workflowQueueItemSchema),
  projection: workflowProjectionSchema.optional(),
  lineage: z.array(mcpEvidenceLineageSchema).min(1),
  sourceHealth: z.array(sourceHealthSchema).min(1)
}).strict().refine(
  (output) => (output.contractVersion === '2.0') === (output.projection !== undefined),
  'Version 2 workflow output requires projection metadata; legacy output must not contain it.'
)

/**
 * Output of a workflow registered through the extension seam. Its shape is owned and validated host-side
 * by the registration's approved schema; the wire carries it as bounded data beside the stable initial-cohort `output`.
 */
export const registeredWorkflowOutputSchema = z.object({
  workflowId: z.string().regex(/^WF-[0-9]{3}$/),
  outputSchemaRef: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown())
}).strict()

export const workflowRunViewSchema = z.object({
  run: workflowRunSchema,
  output: initialWorkflowOutputSchema.optional(),
  extensionOutput: registeredWorkflowOutputSchema.optional()
}).strict()

export type WorkflowQueueItem = z.infer<typeof workflowQueueItemSchema>
export type WorkflowRecordReference = z.infer<typeof workflowRecordReferenceSchema>
export type InitialWorkflowOutput = z.infer<typeof initialWorkflowOutputSchema>
export type RegisteredWorkflowOutput = z.infer<typeof registeredWorkflowOutputSchema>
export type WorkflowRunView = z.infer<typeof workflowRunViewSchema>
