import { z } from 'zod'
import { initialWorkflowOutputSchema } from './workflow-output.js'

export const workflowMembershipSnapshotSchema = z.object({
  dealTeamOpportunityIds: z.array(z.string().min(1)),
  milestoneTeamOpportunityIds: z.array(z.string().min(1)),
  milestoneTeamMilestoneIds: z.array(z.string().min(1))
}).strict()

export const workflowResultsViewRequestSchema = z.object({
  contractVersion: z.literal('1.0'),
  runId: z.string().uuid(),
  filter: z.enum(['all', 'mine']).default('all')
}).strict()

export const workflowItemEligibilitySchema = z.object({
  queueItemId: z.string().min(1),
  eligible: z.boolean(),
  reason: z.string()
}).strict()

export const workflowResultsProjectionSchema = z.object({
  contractVersion: z.literal('1.0'),
  filter: z.enum(['all', 'mine']),
  state: z.enum(['ready', 'pending', 'unavailable', 'legacy']),
  message: z.string().min(1).optional(),
  totalItems: z.number().int().nonnegative(),
  visibleItems: z.number().int().nonnegative(),
  eligibility: z.array(workflowItemEligibilitySchema),
  output: initialWorkflowOutputSchema.optional()
}).strict()

export const workflowResultsViewSchema = workflowResultsProjectionSchema.extend({
  runId: z.string().uuid()
}).strict()

export type WorkflowMembershipSnapshot = z.infer<typeof workflowMembershipSnapshotSchema>
export type WorkflowResultsView = z.infer<typeof workflowResultsViewSchema>
export type WorkflowResultsProjection = z.infer<typeof workflowResultsProjectionSchema>
export type WorkflowResultsViewRequest = z.input<typeof workflowResultsViewRequestSchema>
