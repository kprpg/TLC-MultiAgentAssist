import { describe, expect, it, vi } from 'vitest'
import { dataverseEntityMapSchema, type GuardedQueryRequest } from '../../../packages/common/index.js'
import entityMapJson from '../../../config/dataverse.entity-map.json' with { type: 'json' }
import { DataverseMcpReadAdapter, type DataverseBrokerResult } from '../../../packages/connectors/dataverse-mcp/index.js'

const query: GuardedQueryRequest = {
    entity: 'opportunity', select: ['id', 'name'], filter: [],
    orderBy: [{ field: 'name', direction: 'asc' }], top: 50, expand: []
}
const context = {
    correlationId: 'test', capability: 'account-pulse' as const, scope: { kind: 'portfolio' as const },
    delegatedScope: { delegatedUserAccountIds: [], delegatedUserOpportunityIds: ['opp-1'] }
}
const page = (count: number, start = 0): DataverseBrokerResult => ({
    kind: 'untrusted-mcp-data',
    data: { rows: Array.from({ length: count }, (_, index) => ({
        opportunityid: `opp-${String(index + start).padStart(3, '0')}`, name: `Opportunity ${index + start}`
    })) },
    recordCount: count, truncated: false
})

function adapter(execute: () => Promise<DataverseBrokerResult>) {
    return new DataverseMcpReadAdapter({ entityMap: dataverseEntityMapSchema.parse(entityMapJson), broker: { execute } })
}

describe('Dataverse page progress', () => {
    it('publishes the first 20 rows while the second page is still pending', async () => {
        let release!: (result: DataverseBrokerResult) => void
        const execute = vi.fn().mockResolvedValueOnce(page(20)).mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
        const onProgress = vi.fn()
        const pending = adapter(execute).query(query, { ...context, onProgress })
        await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))

        expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
            state: 'partial', recordCount: 20, truncated: true,
            sourceHealth: expect.objectContaining({ state: 'partial' })
        }))
        const first = onProgress.mock.calls[0]?.[0]
        release(page(2, 20))
        const result = await pending

        expect(result).toMatchObject({ state: 'complete', recordCount: 22, truncated: false })
        expect(first.records).toHaveLength(20)
        expect(result.records).toHaveLength(22)
    })

    it('retains fetched rows with explicit incomplete coverage when a later page is unavailable', async () => {
        const execute = vi.fn().mockResolvedValueOnce(page(20))
            .mockRejectedValueOnce(Object.assign(new Error('private source error'), { code: 'transport' }))
        const result = await adapter(execute).query(query, context)

        expect(result).toMatchObject({ state: 'partial', recordCount: 20, truncated: true, sourceHealth: { state: 'partial' } })
        expect(result.records).toHaveLength(20)
        expect(result.sourceHealth.detail).toContain('incomplete')
        expect(result.sourceHealth.detail).not.toContain('private source error')
    })

    it('discards fetched rows if delegated access is revoked on a later page', async () => {
        const execute = vi.fn().mockResolvedValueOnce(page(20))
            .mockRejectedValueOnce(Object.assign(new Error('private source error'), { code: 'unauthorized' }))
        const result = await adapter(execute).query(query, context)

        expect(result).toMatchObject({ state: 'unauthorized', records: [], sourceHealth: { state: 'unauthorized' } })
    })

    it('does not start another page after cancellation', async () => {
        const controller = new AbortController()
        const execute = vi.fn().mockResolvedValue(page(20))
        const pending = adapter(execute).query(query, {
            ...context, signal: controller.signal,
            onProgress: () => controller.abort(new DOMException('Cancelled.', 'AbortError'))
        })

        await expect(pending).rejects.toThrow('Cancelled.')
        expect(execute).toHaveBeenCalledTimes(1)
    })
})
