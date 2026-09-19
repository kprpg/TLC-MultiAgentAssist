import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const workflowDescriptionSchema = z.object({
    summary: z.string().min(1).max(400),
    reads: z.string().min(1).max(400),
    useIt: z.string().min(1).max(400)
}).strict()

export const workflowDescriptionCatalogSchema = z.object({
    schemaVersion: z.literal(1),
    descriptions: z.record(z.string().regex(/^WF-[0-9]{3}$/), workflowDescriptionSchema)
}).strict()

export type WorkflowDescription = z.infer<typeof workflowDescriptionSchema>
export type WorkflowDescriptionCatalog = z.infer<typeof workflowDescriptionCatalogSchema>

export async function loadWorkflowDescriptionCatalog(filePath: string): Promise<WorkflowDescriptionCatalog> {
    let content: string
    try {
        content = await readFile(filePath, 'utf8')
    } catch (cause) {
        throw new Error(`Unable to read workflow description catalog: ${filePath}`, { cause })
    }

    let candidate: unknown
    try {
        candidate = JSON.parse(content)
    } catch (cause) {
        throw new Error(`Workflow description catalog is not valid JSON: ${filePath}`, { cause })
    }

    return workflowDescriptionCatalogSchema.parse(candidate)
}
