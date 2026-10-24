import type { z } from 'zod'
import { workflowDefinitionSchema, type WorkflowDefinition } from '../../common/index.js'
import { WorkflowRegistryError } from './registry.js'
import type { WorkflowConnectorExecutor, WorkflowResultAssembler } from './runtime.js'

/**
 * Binds one approved workflow's definition, connector handler, result assembler and output schema together.
 * Registering it requires no change to host transports or to existing workflow implementations.
 */
export interface WorkflowRegistration {
    definition: WorkflowDefinition
    executor: WorkflowConnectorExecutor
    assembler: WorkflowResultAssembler
    outputSchema: z.ZodType<Record<string, unknown>>
}

export type RegisteredWorkflowOutputs = ReadonlyMap<string, { outputSchemaRef: string; schema: z.ZodType<Record<string, unknown>> }>

export interface WorkflowComposition {
    definitions: WorkflowDefinition[]
    executor: WorkflowConnectorExecutor
    assembler: WorkflowResultAssembler
    outputs: RegisteredWorkflowOutputs
}

export function composeWorkflows(
    base: { definitions: readonly WorkflowDefinition[]; executor: WorkflowConnectorExecutor; assembler: WorkflowResultAssembler },
    registrations: readonly WorkflowRegistration[] = []
): WorkflowComposition {
    const taken = new Set(base.definitions.map(({ id }) => id))
    const registered = new Map<string, WorkflowRegistration>()
    for (const registration of registrations) {
        const definition = workflowDefinitionSchema.parse(registration.definition)
        if (taken.has(definition.id)) {
            throw new WorkflowRegistryError('invalid_registration', `Workflow ${definition.id} is already registered.`)
        }
        if (definition.executionMode === 'agentic') {
            throw new WorkflowRegistryError('invalid_registration', `Workflow ${definition.id} cannot use agentic execution; only deterministic and composite plans are supported.`)
        }
        if (definition.auth.allowedWrite) {
            throw new WorkflowRegistryError('invalid_registration', `Workflow ${definition.id} must be read-only; writes use the reviewed mutation path.`)
        }
        taken.add(definition.id)
        registered.set(definition.id, { ...registration, definition })
    }
    return {
        definitions: [...base.definitions, ...[...registered.values()].map(({ definition }) => definition)],
        executor: {
            execute: (step, context) => (registered.get(context.workflowId)?.executor ?? base.executor).execute(step, context)
        },
        assembler: {
            assemble: (context) => {
                const registration = registered.get(context.definition.id)
                if (!registration) return base.assembler.assemble(context)
                return registration.outputSchema.parse(registration.assembler.assemble(context))
            }
        },
        outputs: new Map([...registered].map(([id, { definition, outputSchema }]) =>
            [id, { outputSchemaRef: definition.outputSchemaRef, schema: outputSchema }]))
    }
}
