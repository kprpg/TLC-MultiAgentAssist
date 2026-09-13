import { z } from 'zod'
import { workflowDefinitionSchema, type WorkflowDefinition } from '../../common/index.js'

const workflowDefinitionsSchema = z.array(workflowDefinitionSchema).min(1)

export class WorkflowRegistry {
    private definitions = new Map<string, WorkflowDefinition>()

    constructor(definitions: unknown) {
        this.replace(definitions)
    }

    replace(definitions: unknown): void {
        const parsed = workflowDefinitionsSchema.parse(definitions)
        const replacement = new Map<string, WorkflowDefinition>()
        for (const definition of parsed) {
            if (replacement.has(definition.id)) {
                throw new WorkflowRegistryError('duplicate_workflow', `Workflow ${definition.id} is defined more than once.`)
            }
            replacement.set(definition.id, definition)
        }
        this.definitions = replacement
    }

    get(workflowId: string): WorkflowDefinition {
        const definition = this.definitions.get(workflowId)
        if (!definition) throw new WorkflowRegistryError('workflow_not_found', `Workflow ${workflowId} is not registered.`)
        return structuredClone(definition)
    }

    list(scope?: WorkflowDefinition['scope']): WorkflowDefinition[] {
        return [...this.definitions.values()]
            .filter((definition) => scope === undefined || definition.scope === scope)
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((definition) => structuredClone(definition))
    }
}

export class WorkflowRegistryError extends Error {
    constructor(readonly code: 'duplicate_workflow' | 'workflow_not_found', message: string) {
        super(message)
        this.name = 'WorkflowRegistryError'
    }
}