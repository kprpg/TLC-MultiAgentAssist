import { z } from 'zod'

const canonicalFieldSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/)
const guardedQueryValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])).min(1).max(50)
])

export const guardedQueryFilterSchema = z.object({
    field: canonicalFieldSchema,
    operator: z.enum([
        'eq',
        'ne',
        'gt',
        'ge',
        'lt',
        'le',
        'contains',
        'startswith',
        'in',
        'on-or-after',
        'on-or-before'
    ]),
    value: guardedQueryValueSchema
}).strict()

export const guardedQueryOrderSchema = z.object({
    field: canonicalFieldSchema,
    direction: z.enum(['asc', 'desc'])
}).strict()

export const guardedQueryExpandSchema = z.object({
    relationship: canonicalFieldSchema,
    select: z.array(canonicalFieldSchema).min(1).max(12).refine(isUnique, 'Expanded select fields must be unique.')
}).strict()

export const guardedQueryRequestSchema = z.object({
    entity: canonicalFieldSchema,
    select: z.array(canonicalFieldSchema).min(1).max(40).refine(isUnique, 'Select fields must be unique.'),
    filter: z.array(guardedQueryFilterSchema).max(12).default([]),
    orderBy: z.array(guardedQueryOrderSchema).max(3).default([])
        .refine((orders) => isUnique(orders.map((order) => order.field)), 'Order fields must be unique.'),
    top: z.number().int().min(1).max(2_000).default(200),
    expand: z.array(guardedQueryExpandSchema).max(3).default([])
        .refine((expands) => isUnique(expands.map((expand) => expand.relationship)), 'Expanded relationships must be unique.')
}).strict()

function isUnique(values: readonly string[]): boolean {
    return new Set(values).size === values.length
}

export type GuardedQueryFilter = z.infer<typeof guardedQueryFilterSchema>
export type GuardedQueryRequest = z.infer<typeof guardedQueryRequestSchema>