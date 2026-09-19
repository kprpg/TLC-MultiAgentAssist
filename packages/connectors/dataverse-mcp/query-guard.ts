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
    // When set, Dataverse reads scope via a JOIN to msp_dealteam on this user's deal-team opportunities.
    currentUserId?: string
}

// Each scopable entity's TDS column referencing the opportunity, for the msp_dealteam scope JOIN.
const dealTeamOpportunityColumn: Readonly<Record<string, string>> = {
    opportunity: 'opportunityid',
    msp_engagementmilestone: 'msp_opportunityid',
    activitypointer: 'regardingobjectid'
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

/** Strips the OData lookup decoration (`_x_value`) so a logical name is valid in a TDS SQL column list. */
export function toSqlColumn(logicalName: string): string {
    return /^_(.+)_value$/.exec(logicalName)?.[1] ?? logicalName
}

function sqlScalar(value: string | number | boolean): string {
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? '1' : '0'
    return `'${value.replace(/'/g, "''")}'`
}

function sqlOperator(operator: GuardedQueryRequest['filter'][number]['operator']): string {
    switch (operator) {
        case 'ne': return '<>'
        case 'gt': return '>'
        case 'ge': case 'on-or-after': return '>='
        case 'lt': return '<'
        case 'le': case 'on-or-before': return '<='
        case 'in': return 'IN'
        case 'contains': case 'startswith': return 'LIKE'
        default: return '='
    }
}

function sqlValue(
    operator: GuardedQueryRequest['filter'][number]['operator'],
    value: GuardedQueryRequest['filter'][number]['value']
): string {
    if (Array.isArray(value)) return `(${value.map(sqlScalar).join(', ')})`
    if (operator === 'contains') return sqlScalar(`%${value}%`)
    if (operator === 'startswith') return sqlScalar(`${value}%`)
    return sqlScalar(value)
}

function renderSqlScopePredicate(template: string, scope: DataverseDelegatedScope): string {
    const replacements: Readonly<Record<string, readonly string[]>> = {
        delegatedUserAccountIds: scope.delegatedUserAccountIds,
        delegatedUserOpportunityIds: scope.delegatedUserOpportunityIds
    }
    const placeholders = [...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)]
    if (placeholders.length === 0) {
        throw new DataverseQueryGuardError('scope_required', 'Dataverse scope predicate has no delegated-user placeholder.')
    }
    let rendered = template
    for (const match of placeholders) {
        const name = match[1]
        const values = name === undefined ? undefined : replacements[name]
        if (!values || values.length === 0 || values.some((value) => !isSafeIdentifier(value))) {
            throw new DataverseQueryGuardError('scope_required', 'Delegated Dataverse scope is missing or invalid.')
        }
        rendered = rendered.replaceAll(`{${name}}`, `(${values.map((value) => `'${value}'`).join(', ')})`)
    }
    if (/[{}]/.test(rendered)) {
        throw new DataverseQueryGuardError('scope_required', 'Dataverse scope predicate contains an unknown placeholder.')
    }
    return rendered
}

/**
 * Renders a guarded, delegated-scoped TDS `SELECT` string for the Dataverse MCP `read_query`
 * tool (which takes a `querytext` SQL string, not a structured payload). Applies the same
 * entity/field allowlist and delegated-scope requirements as {@link translateDataverseQuery}.
 */
export function renderDataverseSql(
    entityMapInput: DataverseEntityMap,
    queryInput: GuardedQueryRequest,
    delegatedScope: DataverseDelegatedScope,
    maximumRows: number,
    options: { enforceScope?: boolean } = {}
): string {
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
        throw new DataverseQueryGuardError('relationship_denied', 'Dataverse relationship expansion is not allowlisted by the semantic map.')
    }

    const attributes = new Map(entity.attributes.map((attribute) => [attribute.canonical, attribute]))
    const column = (canonical: string): string => {
        const attribute = attributes.get(canonical)
        if (!attribute) throw new DataverseQueryGuardError('field_denied', 'Dataverse field is not allowlisted.')
        return toSqlColumn(attribute.logicalName)
    }

    const top = Math.min(query.top, maximumRows)
    const dealTeamColumn = dealTeamOpportunityColumn[toSqlColumn(entity.logicalName)]
    const useJoinScope = options.enforceScope !== false && Boolean(delegatedScope.currentUserId) && Boolean(dealTeamColumn)
    const qualify = (sqlColumn: string): string => (useJoinScope ? `m.${sqlColumn}` : sqlColumn)

    const selectColumns = query.select.map((canonical) => qualify(column(canonical)))
    const whereClauses = query.filter.map((filter) => `${qualify(column(filter.field))} ${sqlOperator(filter.operator)} ${sqlValue(filter.operator, filter.value)}`)
    if (useJoinScope) {
        const userId = delegatedScope.currentUserId as string
        if (!isSafeIdentifier(userId)) {
            throw new DataverseQueryGuardError('scope_required', 'The delegated user id is missing or invalid.')
        }
        whereClauses.unshift(`dt.msp_dealteamuserid = '${userId}'`, 'dt.statecode = 0')
    } else if (options.enforceScope !== false && entity.userScopePredicate !== undefined) {
        whereClauses.push(renderSqlScopePredicate(entity.userScopePredicate, delegatedScope))
    }
    const orderBy = query.orderBy.map((order) => `${qualify(column(order.field))} ${order.direction.toUpperCase()}`)

    let sql = `SELECT TOP ${top} ${selectColumns.join(', ')} FROM ${toSqlColumn(entity.logicalName)}`
    if (useJoinScope) sql += ` m JOIN msp_dealteam dt ON m.${dealTeamColumn} = dt.msp_parentopportunityid`
    if (whereClauses.length > 0) sql += ` WHERE ${whereClauses.join(' AND ')}`
    if (orderBy.length > 0) sql += ` ORDER BY ${orderBy.join(', ')}`
    return sql
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