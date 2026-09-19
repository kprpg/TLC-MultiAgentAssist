import type { DataverseBrokerRequest, DataverseBrokerResult, DataverseToolBroker } from './adapter.js'

type FixtureFilter = { field: string; operator: string; value: string | number | boolean | Array<string | number> }
type FixtureOrder = { field: string; direction: 'asc' | 'desc' }
type FixtureQuery = { top: number; from: string; filters: FixtureFilter[]; orderBy: FixtureOrder[] }

export class FixtureDataverseMcpBroker implements DataverseToolBroker {
    constructor(private readonly rowsByTable: Readonly<Record<string, Array<Record<string, unknown>>>>) { }

    async execute(request: DataverseBrokerRequest): Promise<DataverseBrokerResult> {
        if (request.serverId !== 'dataverse' || request.tool !== 'read_query') {
            throw new Error('Fixture Dataverse MCP broker only supports read_query.')
        }
        const querytext = (request.arguments as { querytext?: unknown }).querytext
        if (typeof querytext !== 'string') throw new Error('Fixture Dataverse MCP query requires a querytext string.')
        const query = parseFixtureSql(querytext)
        const sourceRows = this.rowsByTable[query.from] ?? []
        const filteredRows = sourceRows.filter((row) => query.filters.every((filter) => matchesFilter(row, filter)))
        const orderedRows = [...filteredRows].sort((left, right) => compareRows(left, right, query.orderBy))
        const selectedRows = orderedRows.slice(0, query.top)
        return {
            kind: 'untrusted-mcp-data',
            data: { rows: selectedRows },
            recordCount: filteredRows.length,
            truncated: filteredRows.length > selectedRows.length
        }
    }
}

function parseFixtureSql(sql: string): FixtureQuery {
    const head = /^\s*SELECT\s+TOP\s+(\d+)\s+.+?\s+FROM\s+(\w+)/i.exec(sql)
    if (!head) throw new Error(`Fixture Dataverse MCP could not parse the query: ${sql}`)
    const whereMatch = /\sWHERE\s+(.+?)(?:\s+ORDER\s+BY\s|$)/i.exec(sql)
    const orderMatch = /\sORDER\s+BY\s+(.+)$/i.exec(sql)
    return {
        top: Number(head[1]),
        from: head[2] ?? '',
        filters: whereMatch?.[1] ? parseWhere(whereMatch[1]) : [],
        orderBy: orderMatch?.[1] ? parseOrderBy(orderMatch[1]) : []
    }
}

function parseWhere(clause: string): FixtureFilter[] {
    return clause.split(/\s+AND\s+/i)
        .map((part) => parseCondition(part.trim()))
        .filter((condition): condition is FixtureFilter => condition !== undefined)
}

function parseCondition(text: string): FixtureFilter | undefined {
    const inMatch = /^(\w+)\s+in\s+\((.*)\)$/i.exec(text)
    if (inMatch?.[1]) {
        return { field: inMatch[1], operator: 'in', value: (inMatch[2] ?? '').split(',').map((value) => parseValue(value.trim())) as Array<string | number> }
    }
    const opMatch = /^(\w+)\s*(<=|>=|<>|<|>|=)\s*(.+)$/.exec(text)
    if (opMatch?.[1] && opMatch[2] && opMatch[3] !== undefined) {
        return { field: opMatch[1], operator: sqlOperatorToStructured(opMatch[2]), value: parseValue(opMatch[3].trim()) }
    }
    return undefined
}

function parseOrderBy(clause: string): FixtureOrder[] {
    return clause.split(',').map((part) => {
        const [field, direction] = part.trim().split(/\s+/)
        return { field: field ?? '', direction: direction?.toLowerCase() === 'desc' ? 'desc' : 'asc' }
    })
}

function parseValue(token: string): string | number {
    const unquoted = token.replace(/^'(.*)'$/, '$1')
    if (unquoted === token && token !== '' && !Number.isNaN(Number(token))) return Number(token)
    return unquoted
}

function sqlOperatorToStructured(operator: string): string {
    switch (operator) {
        case '<>': return 'ne'
        case '<=': return 'le'
        case '>=': return 'ge'
        case '<': return 'lt'
        case '>': return 'gt'
        default: return 'eq'
    }
}

function matchesFilter(row: Record<string, unknown>, filter: FixtureFilter): boolean {
    const actual = row[filter.field]
    switch (filter.operator) {
        case 'eq': return actual === filter.value
        case 'ne': return actual !== filter.value
        case 'gt': return compareValues(actual, filter.value) > 0
        case 'ge': return compareValues(actual, filter.value) >= 0
        case 'lt': return compareValues(actual, filter.value) < 0
        case 'le': return compareValues(actual, filter.value) <= 0
        case 'in': return Array.isArray(filter.value) && filter.value.includes(actual as string | number)
        default: return false
    }
}

function compareRows(left: Record<string, unknown>, right: Record<string, unknown>, orderBy: FixtureOrder[]): number {
    for (const order of orderBy) {
        const comparison = compareValues(left[order.field], right[order.field])
        if (comparison !== 0) return order.direction === 'asc' ? comparison : -comparison
    }
    return 0
}

function compareValues(left: unknown, right: unknown): number {
    if ((typeof left === 'string' || typeof left === 'number') &&
        (typeof right === 'string' || typeof right === 'number')) {
        return left < right ? -1 : left > right ? 1 : 0
    }
    return 0
}