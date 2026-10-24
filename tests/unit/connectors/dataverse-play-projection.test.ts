import { describe, expect, it, vi } from 'vitest'
import { dataverseEntityMapSchema, type GuardedQueryRequest } from '../../../packages/common/index.js'
import entityMapJson from '../../../config/dataverse.entity-map.json' with { type: 'json' }
import { DataverseMcpReadAdapter, renderDataverseSql } from '../../../packages/connectors/dataverse-mcp/index.js'

const entityMap = dataverseEntityMapSchema.parse(entityMapJson)
const scope = {
    currentUserId: 'user-1', delegatedUserAccountIds: [], delegatedUserOpportunityIds: [],
    excludedAccountIds: ['account-hidden']
}

function query(entity = 'engagementMilestone'): GuardedQueryRequest {
    return {
        entity, select: ['id', 'opportunityId'], filter: [], orderBy: [],
        top: 20, expand: [{ relationship: 'opportunity', select: ['accountId', 'name'] }]
    }
}

describe('allowlisted Play parent projection', () => {
    it.each([
        ['engagementMilestone', 'msp_engagementmilestone', 'msp_opportunityid'],
        ['activity', 'activitypointer', 'regardingobjectid']
    ])('projects only the parent of the scoped %s row in the same read', (entity, table, foreignKey) => {
        const sql = renderDataverseSql(entityMap, query(entity), scope, 20)

        expect(sql).toContain('scopeop.parentaccountid AS accountId')
        expect(sql).toContain('scopeop.name AS opportunityName')
        expect(sql).toContain(`FROM ${table} m JOIN msp_dealteam dt ON m.${foreignKey} = dt.msp_parentopportunityid`)
        expect(sql).toContain(`JOIN opportunity scopeop ON m.${foreignKey} = scopeop.opportunityid`)
        expect(sql).toContain("dt.msp_dealteamuserid = 'user-1'")
        expect(sql).toContain('dt.statecode = 0')
        expect(sql).toContain("scopeop.parentaccountid NOT IN ('account-hidden')")
    })

    it('preserves milestone rows without a readable parent when no hidden-account exclusion is needed', () => {
        const sql = renderDataverseSql(entityMap, query(), { ...scope, excludedAccountIds: [] }, 20)
        expect(sql).toContain('LEFT JOIN opportunity scopeop')
    })

    it('retains explicit delegated opportunity scope when no current user JOIN is available', () => {
        const sql = renderDataverseSql(entityMap, query(), {
            delegatedUserAccountIds: [], delegatedUserOpportunityIds: ['opp-1'], excludedAccountIds: ['account-hidden']
        }, 20)
        expect(sql).toContain("msp_opportunityid in ('opp-1')")
        expect(sql).toContain('JOIN opportunity scopeop ON m.msp_opportunityid = scopeop.opportunityid')
        expect(sql).toContain("scopeop.parentaccountid NOT IN ('account-hidden')")
    })

    it.each([
        { ...query(), expand: [{ relationship: 'owner', select: ['name'] }] },
        { ...query(), expand: [{ relationship: 'opportunity', select: ['comments'] }] },
        { ...query(), expand: [{ relationship: 'opportunity', select: ['ownerId'] }] },
        { ...query('opportunity'), select: ['id'] }
    ])('rejects unapproved relationship or parent fields', (candidate) => {
        expect(() => renderDataverseSql(entityMap, candidate, scope, 20)).toThrow()
    })

    it('also requires projected fields to be present in the configured parent allowlist', () => {
        const restrictedMap = {
            ...entityMap, entities: entityMap.entities.map((entity) => entity.canonical === 'opportunity'
                ? { ...entity, attributes: entity.attributes.filter((attribute) => attribute.canonical !== 'accountId') }
                : entity)
        }
        expect(() => renderDataverseSql(restrictedMap, query(), scope, 20)).toThrow()
    })

    it('maps the projected parent aliases without issuing a second query', async () => {
        const execute = vi.fn().mockResolvedValue({
            kind: 'untrusted-mcp-data',
            data: { rows: [{ msp_engagementmilestoneid: 'ms-1', msp_opportunityid: 'opp-1', accountId: 'account-1', opportunityName: 'Fixture opportunity' }] },
            recordCount: 1, truncated: false
        })
        const adapter = new DataverseMcpReadAdapter({ entityMap, broker: { execute } })
        const result = await adapter.query(query(), {
            correlationId: 'test', capability: 'account-pulse', scope: { kind: 'portfolio' }, delegatedScope: scope
        })

        expect(result.records).toEqual([{ id: 'ms-1', opportunityId: 'opp-1', accountId: 'account-1', opportunityName: 'Fixture opportunity' }])
        expect(execute).toHaveBeenCalledTimes(1)
    })
})
