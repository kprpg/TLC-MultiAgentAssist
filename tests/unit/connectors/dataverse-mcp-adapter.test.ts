import { describe, expect, it, vi } from 'vitest'
import type { DataverseEntityMap, GuardedQueryRequest } from '../../../packages/common/index.js'
import {
    DataverseMcpAdapterError,
    DataverseMcpReadAdapter,
    FixtureDataverseMcpBroker,
    type DataverseToolBroker
} from '../../../packages/connectors/dataverse-mcp/index.js'

const entityMap: DataverseEntityMap = {
    schemaVersion: 1,
    environmentLabel: 'fixture',
    refreshedAt: '2026-09-12T00:00:00.000Z',
    entities: [{
        canonical: 'opportunity',
        logicalName: 'opportunity',
        entitySetName: 'opportunities',
        primaryIdAttribute: 'opportunityid',
        primaryNameAttribute: 'name',
        label: 'Opportunity',
        scope: 'opportunity',
        userScopePredicate: 'opportunityid in {delegatedUserOpportunityIds}',
        attributes: [
            { canonical: 'id', logicalName: 'opportunityid', label: 'ID', dataType: 'uniqueidentifier', sensitivity: 'internal', includeInPrompt: true },
            { canonical: 'name', logicalName: 'name', label: 'Name', dataType: 'string', sensitivity: 'internal', includeInPrompt: true },
            { canonical: 'closeDate', logicalName: 'estimatedclosedate', label: 'Close date', dataType: 'date', sensitivity: 'internal', includeInPrompt: true }
        ]
    }]
}

const query: GuardedQueryRequest = {
    entity: 'opportunity',
    select: ['id', 'name'],
    filter: [],
    orderBy: [{ field: 'closeDate', direction: 'asc' }],
    top: 1,
    expand: []
}

const context = {
    correlationId: 'correlation-1',
    capability: 'account-pulse',
    scope: { kind: 'portfolio' },
    delegatedScope: {
        delegatedUserAccountIds: [],
        delegatedUserOpportunityIds: ['1', '2']
    }
} as const

function adapter(broker: DataverseToolBroker): DataverseMcpReadAdapter {
    return new DataverseMcpReadAdapter({
        entityMap,
        broker,
        maximumRows: 10,
        now: () => new Date('2026-09-12T12:00:00.000Z'),
        createToolCallId: () => 'tool-call-1'
    })
}

describe('DataverseMcpReadAdapter', () => {
    it('queries the fixture through the guarded payload and returns canonical lineage', async () => {
        const connector = adapter(new FixtureDataverseMcpBroker({
            opportunity: [
                { opportunityid: '2', name: 'Second', estimatedclosedate: '2026-12-01' },
                { opportunityid: '1', name: 'First', estimatedclosedate: '2026-10-01' }
            ]
        }))

        await expect(connector.query(query, context)).resolves.toEqual({
            state: 'partial',
            records: [{ id: '1', name: 'First' }],
            recordCount: 2,
            truncated: true,
            sourceHealth: {
                source: 'dataverse-mcp',
                state: 'partial',
                detail: 'Dataverse MCP returned a row-limited delegated result.',
                checkedAt: '2026-09-12T12:00:00.000Z'
            },
            lineage: { connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'tool-call-1' }
        })
    })

    it('maps MCP text content and strips unrequested fields', async () => {
        const broker: DataverseToolBroker = {
            execute: vi.fn<DataverseToolBroker['execute']>(async () => ({
                kind: 'untrusted-mcp-data',
                data: { content: [{ type: 'text', text: '{"value":[{"opportunityid":"1","name":"First","secret":"hidden"}]}' }] },
                recordCount: 1,
                truncated: false
            }))
        }

        const result = await adapter(broker).query(query, context)

        expect(result.records).toEqual([{ id: '1', name: 'First' }])
        expect(result.state).toBe('complete')
    })

    it.each(['unauthorized', 'scope_denied'])('maps %s failures to an unauthorized result', async (code) => {
        const broker: DataverseToolBroker = {
            execute: vi.fn(async () => { throw Object.assign(new Error('private detail'), { code }) })
        }

        const result = await adapter(broker).query(query, context)

        expect(result).toMatchObject({ state: 'unauthorized', records: [], sourceHealth: { state: 'unauthorized' } })
        expect(result.sourceHealth.detail).not.toContain('private detail')
    })

    it('maps transport failures to an unavailable partial result', async () => {
        const broker: DataverseToolBroker = {
            execute: vi.fn(async () => { throw Object.assign(new Error('private detail'), { code: 'transport' }) })
        }

        await expect(adapter(broker).query(query, context)).resolves.toMatchObject({
            state: 'partial',
            records: [],
            sourceHealth: { state: 'unavailable' }
        })
    })

    it('propagates cancellation', async () => {
        const aborted = Object.assign(new Error('cancelled'), { code: 'aborted' })
        const broker: DataverseToolBroker = { execute: vi.fn(async () => { throw aborted }) }

        await expect(adapter(broker).query(query, context)).rejects.toBe(aborted)
    })

    it('rejects malformed MCP content', async () => {
        const broker: DataverseToolBroker = {
            execute: vi.fn<DataverseToolBroker['execute']>(async () => ({
                kind: 'untrusted-mcp-data',
                data: { content: [{ type: 'text', text: 'not-json' }] },
                recordCount: 0,
                truncated: false
            }))
        }

        await expect(adapter(broker).query(query, context)).rejects.toBeInstanceOf(DataverseMcpAdapterError)
    })

    it('paginates by primary id past the per-call limit and returns the requested order', async () => {
        const rows = Array.from({ length: 25 }, (_unused, index) => {
            const suffix = String(index + 1).padStart(3, '0')
            return { opportunityid: `opp-${suffix}`, name: `Opp ${suffix}`, estimatedclosedate: `2026-${String((index % 12) + 1).padStart(2, '0')}-15` }
        })
        const paginating = new DataverseMcpReadAdapter({
            entityMap,
            broker: new FixtureDataverseMcpBroker({ opportunity: rows }),
            maximumRows: 50,
            now: () => new Date('2026-09-12T12:00:00.000Z'),
            createToolCallId: () => 'tool-call-1'
        })
        const result = await paginating.query(
            { entity: 'opportunity', select: ['id', 'name', 'closeDate'], filter: [], orderBy: [{ field: 'closeDate', direction: 'asc' }], top: 50, expand: [] },
            { ...context, delegatedScope: { delegatedUserAccountIds: [], delegatedUserOpportunityIds: rows.map((row) => row.opportunityid) } }
        )

        expect(result.records).toHaveLength(25)
        const dates = result.records.map((record) => record.closeDate as string)
        expect(dates).toEqual([...dates].sort())
    })
})