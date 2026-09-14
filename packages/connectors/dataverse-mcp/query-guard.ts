import {
    dataverseEntityMapSchema,
    guardedQueryRequestSchema,
    type DataverseAttributeMapping,
    type DataverseEntityMap,
    type GuardedQueryRequest
} from '../../common/index.js'

export type DataverseDelegatedScope = {
    delegatedUserAccountIds: readonly string[]
    delegatedUserOpportunityIds: readonly string[]
}

export type DataverseReadQueryArguments = {
    entitySetName: string
    select: string[]
    filter: Array<{ field: string; operator: string; value: string | number | boolean | Array<string | number> }>
    orderBy: Array<{ field: string; direction: 'asc' | 'desc' }>
    top: number
    expand: never[]
    userScopePredicate?: string
}

export type DataverseQueryGuardErrorCode =
    | 'entity_denied'
    | 'field_denied'
    | 'relationship_denied'
    | 'scope_required'

export class DataverseQueryGuardError extends Error {
    constructor(
        readonly code: DataverseQueryGuardErrorCode,
        message: string
    ) {
        super(message)
        this.name = 'DataverseQueryGuardError'
    }
}

export function translateDataverseQuery(
    entityMapInput: DataverseEntityMap,
    queryInput: GuardedQueryRequest,
    delegatedScope: DataverseDelegatedScope,
    maximumRows: number
): DataverseReadQueryArguments {
    const entityMap = dataverseEntityMapSchema.parse(entityMapInput)
    const query = guardedQueryRequestSchema.parse(queryInput)
    if (!Number.isInteger(maximumRows) || maximumRows < 1) {
        throw new Error('Dataverse maximum row count must be a positive integer.')
    }

    const entity = entityMap.entities.find((candidate) => candidate.canonical === query.entity)
    if (!entity) {
        throw new DataverseQueryGuardError('entity_denied', 'Dataverse entity is not allowlisted.')
    }
    if (query.expand.length > 0) {
        throw new DataverseQueryGuardError(
            'relationship_denied',
            'Dataverse relationship expansion is not allowlisted by the semantic map.'
        )
    }

    const attributes = new Map(entity.attributes.map((attribute) => [attribute.canonical, attribute]))
    const resolveAttribute = (canonical: string): DataverseAttributeMapping => {
        const attribute = attributes.get(canonical)
        if (!attribute) {
            throw new DataverseQueryGuardError('field_denied', 'Dataverse field is not allowlisted.')
        }
        return attribute
    }

    const userScopePredicate = entity.userScopePredicate === undefined
        ? undefined
        : renderScopePredicate(entity.userScopePredicate, delegatedScope)

    return {
        entitySetName: entity.entitySetName,
        select: query.select.map((field) => resolveAttribute(field).logicalName),
        filter: query.filter.map((filter) => ({
            field: resolveAttribute(filter.field).logicalName,
            operator: normalizeOperator(filter.operator),
            value: filter.value
        })),
        orderBy: query.orderBy.map((order) => ({
            field: resolveAttribute(order.field).logicalName,
            direction: order.direction
        })),
        top: Math.min(query.top, maximumRows),
        expand: [],
        ...(userScopePredicate ? { userScopePredicate } : {})
    }
}

function renderScopePredicate(template: string, scope: DataverseDelegatedScope): string {
    const replacements: Readonly<Record<string, readonly string[]>> = {
        delegatedUserAccountIds: scope.delegatedUserAccountIds,
        delegatedUserOpportunityIds: scope.delegatedUserOpportunityIds
    }
    let rendered = template
    const placeholders = [...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)]
    if (placeholders.length === 0) {
        throw new DataverseQueryGuardError('scope_required', 'Dataverse scope predicate has no delegated-user placeholder.')
    }

    for (const match of placeholders) {
        const name = match[1]
        const values = name === undefined ? undefined : replacements[name]
        if (!values || values.length === 0 || values.some((value) => !isSafeIdentifier(value))) {
            throw new DataverseQueryGuardError('scope_required', 'Delegated Dataverse scope is missing or invalid.')
        }
        rendered = rendered.replaceAll(`{${name}}`, `(${values.join(',')})`)
    }
    if (/[{}]/.test(rendered)) {
        throw new DataverseQueryGuardError('scope_required', 'Dataverse scope predicate contains an unknown placeholder.')
    }
    return rendered
}

function isSafeIdentifier(value: string): boolean {
    return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value)
}

function normalizeOperator(operator: GuardedQueryRequest['filter'][number]['operator']): string {
    if (operator === 'on-or-after') return 'ge'
    if (operator === 'on-or-before') return 'le'
    return operator
}