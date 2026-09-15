import type { DataverseBrokerRequest, DataverseBrokerResult, DataverseToolBroker } from './adapter.js'
import type { DataverseReadQueryArguments } from './query-guard.js'

export class FixtureDataverseMcpBroker implements DataverseToolBroker {
    constructor(private readonly rowsByEntitySet: Readonly<Record<string, Array<Record<string, unknown>>>>) { }

    async execute(request: DataverseBrokerRequest): Promise<DataverseBrokerResult> {
        if (request.serverId !== 'dataverse' || request.tool !== 'read_query') {
            throw new Error('Fixture Dataverse MCP broker only supports read_query.')
        }
        const query = request.arguments as DataverseReadQueryArguments
        if (!query.userScopePredicate) throw new Error('Fixture Dataverse MCP query requires delegated scope.')
        const sourceRows = this.rowsByEntitySet[query.entitySetName] ?? []
        const filteredRows = sourceRows.filter((row) => query.filter.every((filter) => matchesFilter(row, filter)))
        const orderedRows = [...filteredRows].sort((left, right) => compareRows(left, right, query.orderBy))
        const selectedRows = orderedRows.slice(0, query.top).map((row) => Object.fromEntries(
            query.select.map((field) => [field, row[field] ?? null])
        ))
        return {
            kind: 'untrusted-mcp-data',
            data: { rows: selectedRows },
            recordCount: filteredRows.length,
            truncated: filteredRows.length > selectedRows.length
        }
    }
}

function matchesFilter(
    row: Record<string, unknown>,
    filter: DataverseReadQueryArguments['filter'][number]
): boolean {
    const actual = row[filter.field]
    switch (filter.operator) {
        case 'eq': return actual === filter.value
        case 'ne': return actual !== filter.value
        case 'gt': return compareValues(actual, filter.value) > 0
        case 'ge': return compareValues(actual, filter.value) >= 0
        case 'lt': return compareValues(actual, filter.value) < 0
        case 'le': return compareValues(actual, filter.value) <= 0
        case 'contains': return typeof actual === 'string' && typeof filter.value === 'string' && actual.includes(filter.value)
        case 'startswith': return typeof actual === 'string' && typeof filter.value === 'string' && actual.startsWith(filter.value)
        case 'in': return Array.isArray(filter.value) && filter.value.includes(actual as string | number)
        default: return false
    }
}

function compareRows(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    orderBy: DataverseReadQueryArguments['orderBy']
): number {
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