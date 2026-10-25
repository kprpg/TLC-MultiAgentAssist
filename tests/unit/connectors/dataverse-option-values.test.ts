import { describe, expect, it, vi } from 'vitest'
import { dataverseEntityMapSchema } from '../../../packages/common/index.js'
import entityMapJson from '../../../config/dataverse.entity-map.json' with { type: 'json' }
import { DataverseMcpReadAdapter, renderDataverseSql, translateDataverseQuery } from '../../../packages/connectors/dataverse-mcp/index.js'
import { buildInitialWorkflowQuery } from '../../../packages/orchestrator/workflows/index.js'

const entityMap = dataverseEntityMapSchema.parse(entityMapJson)
const delegatedScope = { delegatedUserAccountIds: [], delegatedUserOpportunityIds: ['opp-1'] }

describe('Dataverse numeric choice filtering', () => {
    it.each(['WF-002', 'WF-003'] as const)('filters %s on the indexed status value, not the localized label', (workflowId) => {
        const query = buildInitialWorkflowQuery(workflowId, { asOf: '2026-09-12' })
        const sql = renderDataverseSql(entityMap, query, delegatedScope, 20)

        expect(sql).toContain('m.msp_milestonestatus <> 861980003')
        expect(sql).not.toContain('msp_milestonestatusname')
        expect(sql).not.toContain("'Completed'")
    })

    it('renders numeric IN values for governance risk statuses', () => {
        const sql = renderDataverseSql(entityMap,
            buildInitialWorkflowQuery('WF-005', { asOf: '2026-09-12' }), delegatedScope, 20)
        expect(sql).toContain('m.msp_milestonestatus IN (861980001, 861980002)')
    })

    it('uses the same choice translation for structured queries', () => {
        const query = { ...buildInitialWorkflowQuery('WF-002', { asOf: '2026-09-12' }), expand: [] }
        const translated = translateDataverseQuery(entityMap, query, delegatedScope, 20)
        expect(translated.filter).toContainEqual({ field: 'msp_milestonestatus', operator: 'ne', value: 861980003 })
    })

    it.each(['Unreviewed status', 123, true])('rejects an unmapped choice filter instead of guessing: %s', (value) => {
        const query = {
            ...buildInitialWorkflowQuery('WF-002', { asOf: '2026-09-12' }),
            filter: [{ field: 'status', operator: 'eq' as const, value }]
        }
        expect(() => renderDataverseSql(entityMap, query, delegatedScope, 20)).toThrow()
    })

    it('maps numeric response values back to the existing canonical labels and preserves null', async () => {
        const execute = vi.fn().mockResolvedValue({
            kind: 'untrusted-mcp-data',
            data: { rows: [
                { msp_engagementmilestoneid: 'ms-1', msp_milestonestatus: 861980001 },
                { msp_engagementmilestoneid: 'ms-2', msp_milestonestatus: 861980003 },
                { msp_engagementmilestoneid: 'ms-3', msp_milestonestatus: null }
            ] },
            recordCount: 3, truncated: false
        })
        const adapter = new DataverseMcpReadAdapter({ entityMap, broker: { execute } })
        const result = await adapter.query({
            entity: 'engagementMilestone', select: ['id', 'status'], filter: [], orderBy: [], top: 20, expand: []
        }, { correlationId: 'test', capability: 'account-pulse', scope: { kind: 'portfolio' }, delegatedScope })

        expect(result.records.map((record) => record['status'])).toEqual(['At Risk', 'Completed', null])
    })

    it('surfaces new unmapped response codes rather than inventing a status label', async () => {
        const adapter = new DataverseMcpReadAdapter({
            entityMap, broker: { execute: vi.fn().mockResolvedValue({
                kind: 'untrusted-mcp-data', data: { rows: [{ msp_milestonestatus: 123 }] },
                recordCount: 1, truncated: false
            }) }
        })
        await expect(adapter.query({
            entity: 'engagementMilestone', select: ['status'], filter: [], orderBy: [], top: 20, expand: []
        }, { correlationId: 'test', capability: 'account-pulse', scope: { kind: 'portfolio' }, delegatedScope }))
            .rejects.toThrow('unmapped choice value')
    })
})
