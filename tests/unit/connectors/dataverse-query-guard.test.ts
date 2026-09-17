import { describe, expect, it } from 'vitest'
import type { DataverseEntityMap, GuardedQueryRequest } from '../../../packages/common/index.js'
import {
    DataverseQueryGuardError,
    renderDataverseSql,
    toSqlColumn,
    translateDataverseQuery
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
    filter: [{ field: 'closeDate', operator: 'on-or-before', value: '2026-12-31' }],
    orderBy: [{ field: 'closeDate', direction: 'asc' }],
    top: 200,
    expand: []
}

const delegatedScope = {
    delegatedUserAccountIds: [],
    delegatedUserOpportunityIds: ['00000000-0000-0000-0000-000000000001']
}

describe('translateDataverseQuery', () => {
    it('maps canonical fields, injects delegated scope, and applies the row cap', () => {
        expect(translateDataverseQuery(entityMap, query, delegatedScope, 50)).toEqual({
            entitySetName: 'opportunities',
            select: ['opportunityid', 'name'],
            filter: [{ field: 'estimatedclosedate', operator: 'le', value: '2026-12-31' }],
            orderBy: [{ field: 'estimatedclosedate', direction: 'asc' }],
            top: 50,
            expand: [],
            userScopePredicate: 'opportunityid in (00000000-0000-0000-0000-000000000001)'
        })
    })

    it.each([
        ['unknown entity', { ...query, entity: 'contact' }, 'entity_denied'],
        ['unknown selected field', { ...query, select: ['id', 'ownerEmail'] }, 'field_denied'],
        ['unknown filter field', { ...query, filter: [{ field: 'ownerEmail', operator: 'eq', value: 'x' }] }, 'field_denied'],
        ['unknown order field', { ...query, orderBy: [{ field: 'ownerEmail', direction: 'asc' }] }, 'field_denied'],
        ['unconfigured expansion', { ...query, expand: [{ relationship: 'owner', select: ['email'] }] }, 'relationship_denied']
    ])('rejects %s before query execution', (_label, candidate, code) => {
        expect(() => translateDataverseQuery(entityMap, candidate as GuardedQueryRequest, delegatedScope, 50))
            .toThrowError(expect.objectContaining({ code }))
    })

    it.each([
        ['empty scope', []],
        ['unsafe scope identifier', ['id) or statecode eq 0']]
    ])('rejects %s', (_label, delegatedUserOpportunityIds) => {
        expect(() => translateDataverseQuery(
            entityMap,
            query,
            { ...delegatedScope, delegatedUserOpportunityIds },
            50
        )).toThrowError(DataverseQueryGuardError)
    })
})

describe('renderDataverseSql', () => {
    it('renders a guarded, delegated-scoped TDS SELECT with quoted scope ids', () => {
        expect(renderDataverseSql(entityMap, query, delegatedScope, 50)).toBe(
            "SELECT TOP 50 opportunityid, name FROM opportunity WHERE estimatedclosedate <= '2026-12-31' AND opportunityid in ('00000000-0000-0000-0000-000000000001') ORDER BY estimatedclosedate ASC"
        )
    })

    it('strips OData lookup decoration from lookup column names', () => {
        expect(toSqlColumn('_parentaccountid_value')).toBe('parentaccountid')
        expect(toSqlColumn('name')).toBe('name')
    })

    it('rejects an empty delegated scope', () => {
        expect(() => renderDataverseSql(entityMap, query, { ...delegatedScope, delegatedUserOpportunityIds: [] }, 50))
            .toThrowError(expect.objectContaining({ code: 'scope_required' }))
    })

    it('omits the delegated scope predicate when scope enforcement is disabled', () => {
        expect(renderDataverseSql(entityMap, query, { delegatedUserAccountIds: [], delegatedUserOpportunityIds: [] }, 50, { enforceScope: false })).toBe(
            "SELECT TOP 50 opportunityid, name FROM opportunity WHERE estimatedclosedate <= '2026-12-31' ORDER BY estimatedclosedate ASC"
        )
    })

    it('scopes via a deal-team JOIN on the current user id when provided', () => {
        expect(renderDataverseSql(entityMap, query, { ...delegatedScope, currentUserId: '8a496494-f17e-e511-80e1-3863bb35ce00' }, 50)).toBe(
            "SELECT TOP 50 m.opportunityid, m.name FROM opportunity m JOIN msp_dealteam dt ON m.opportunityid = dt.msp_parentopportunityid WHERE dt.msp_dealteamuserid = '8a496494-f17e-e511-80e1-3863bb35ce00' AND dt.statecode = 0 AND m.estimatedclosedate <= '2026-12-31' ORDER BY m.estimatedclosedate ASC"
        )
    })

    it('rejects an unsafe current user id in JOIN scope', () => {
        expect(() => renderDataverseSql(entityMap, query, { ...delegatedScope, currentUserId: "x' or '1'='1" }, 50))
            .toThrowError(expect.objectContaining({ code: 'scope_required' }))
    })
})