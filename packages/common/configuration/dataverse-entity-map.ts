import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const canonicalNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/)
const logicalNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/)
const attributeLogicalNameSchema = z.string().regex(/^_?[a-z][a-z0-9_]*$/)

export const dataverseAttributeMappingSchema = z.object({
    canonical: canonicalNameSchema,
    logicalName: attributeLogicalNameSchema,
    label: z.string().min(1),
    dataType: z.enum([
        'string',
        'number',
        'boolean',
        'date',
        'datetime',
        'money',
        'lookup',
        'optionset',
        'uniqueidentifier'
    ]),
    optionSet: z.record(z.string(), z.number().int()).optional(),
    sensitivity: z.enum(['public', 'internal', 'restricted']),
    includeInPrompt: z.boolean(),
    format: z.string().min(1).optional()
}).strict().superRefine((attribute, context) => {
    if (attribute.sensitivity === 'restricted' && attribute.includeInPrompt) {
        context.addIssue({
            code: 'custom',
            path: ['includeInPrompt'],
            message: 'Restricted attributes cannot be included in model prompts.'
        })
    }
})

export const dataverseEntityMappingSchema = z.object({
    canonical: canonicalNameSchema,
    logicalName: logicalNameSchema,
    entitySetName: logicalNameSchema,
    primaryIdAttribute: logicalNameSchema,
    primaryNameAttribute: logicalNameSchema,
    label: z.string().min(1),
    scope: z.enum(['opportunity', 'account', 'portfolio', 'reference']),
    deepLinkTemplate: z.string().url().optional(),
    userScopePredicate: z.string().min(1).optional(),
    attributes: z.array(dataverseAttributeMappingSchema).min(1)
}).strict().superRefine((entity, context) => {
    if (entity.scope !== 'reference' && !entity.userScopePredicate) {
        context.addIssue({
            code: 'custom',
            path: ['userScopePredicate'],
            message: 'Non-reference entities require a delegated-user scope predicate.'
        })
    }

    addDuplicateIssue(entity.attributes.map((attribute) => attribute.canonical), ['attributes'], 'canonical names', context)
    addDuplicateIssue(entity.attributes.map((attribute) => attribute.logicalName), ['attributes'], 'logical names', context)
})

export const dataverseEntityMapSchema = z.object({
    schemaVersion: z.literal(1),
    environmentLabel: z.string().min(1),
    refreshedAt: z.string().datetime(),
    entities: z.array(dataverseEntityMappingSchema).min(1)
}).strict().superRefine((mapping, context) => {
    addDuplicateIssue(mapping.entities.map((entity) => entity.canonical), ['entities'], 'canonical names', context)
    addDuplicateIssue(mapping.entities.map((entity) => entity.logicalName), ['entities'], 'logical names', context)
})

function addDuplicateIssue(
    values: readonly string[],
    path: (string | number)[],
    label: string,
    context: z.RefinementCtx
): void {
    if (new Set(values).size !== values.length) {
        context.addIssue({
            code: 'custom',
            path,
            message: `Dataverse mapping ${label} must be unique.`
        })
    }
}

export type DataverseAttributeMapping = z.infer<typeof dataverseAttributeMappingSchema>
export type DataverseEntityMapping = z.infer<typeof dataverseEntityMappingSchema>
export type DataverseEntityMap = z.infer<typeof dataverseEntityMapSchema>

export async function loadDataverseEntityMap(filePath: string): Promise<DataverseEntityMap> {
    let content: string
    try {
        content = await readFile(filePath, 'utf8')
    } catch (cause) {
        throw new Error(`Unable to read Dataverse entity map: ${filePath}`, { cause })
    }

    let candidate: unknown
    try {
        candidate = JSON.parse(content)
    } catch (cause) {
        throw new Error(`Dataverse entity map is not valid JSON: ${filePath}`, { cause })
    }

    return dataverseEntityMapSchema.parse(candidate)
}