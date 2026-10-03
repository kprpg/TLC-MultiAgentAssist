import { z } from 'zod'
import { workflowRunSchema } from '../../common/contracts/index.js'
import { initialWorkflowOutputSchema } from './cohort.js'

export const workflowRunViewSchema = z.object({
    run: workflowRunSchema,
    output: initialWorkflowOutputSchema.optional()
}).strict()

export type WorkflowRunView = z.infer<typeof workflowRunViewSchema>
