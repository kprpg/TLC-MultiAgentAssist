import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
    dataverseEntityMapSchema,
    loadDataverseEntityMap
} from '../../../packages/common/configuration/dataverse-entity-map.js'
import { guardedQueryRequestSchema } from '../../../packages/common/contracts/mcp.js'

const validAttribute = {
    canonical: 'name',
    logicalName: 'name',
    label: 'Name',
    dataType: 'string',
    sensitivity: 'internal',
    includeInPrompt: true
} as const

const validEntity = {
    canonical: 'opportunity',
    logicalName: 'opportunity',
    entitySetName: 'opportunities',
    primaryIdAttribute: 'opportunityid',
    primaryNameAttribute: 'name',
    label: 'Opportunity',
    scope: 'opportunity',
    userScopePredicate: 'opportunityid in {delegatedUserOpportunityIds}',
    attributes: [validAttribute]
} as const

const validQuery = {
    entity: 'opportunity',
    select: ['id', 'name'],
    filter: [{ field: 'closeDate', operator: 'on-or-before', value: '2026-09-12' }],
    orderBy: [{ field: 'closeDate', direction: 'asc' }],
    top: 200,
    expand: []
} as const

describe('Dataverse semantic mapping', () => {
    it('loads the checked-in mapping', async () => {
        const filePath = fileURLToPath(new URL('../../../config/dataverse.entity-map.json', import.meta.url))

        await expect(loadDataverseEntityMap(filePath)).resolves.toMatchObject({
            schemaVersion: 1,
            environmentLabel: 'microsoftsales'
        })
    })

    it.each([
        ['missing non-reference scope predicate', { ...validEntity, userScopePredicate: undefined }],
        ['restricted prompt field', {
            ...validEntity,
            attributes: [{ ...validAttribute, sensitivity: 'restricted', includeInPrompt: true }]
        }],
        ['duplicate canonical attributes', { ...validEntity, attributes: [validAttribute, validAttribute] }],
        ['unknown keys', { ...validEntity, unexpected: true }]
    ])('rejects %s', (_label, entity) => {
        expect(dataverseEntityMapSchema.safeParse({
            schemaVersion: 1,
            environmentLabel: 'test',
            refreshedAt: '2026-09-12T00:00:00.000Z',
            entities: [entity]
        }).success).toBe(false)
    })

    it('rejects duplicate entity names', () => {
        expect(dataverseEntityMapSchema.safeParse({
            schemaVersion: 1,
            environmentLabel: 'test',
            refreshedAt: '2026-09-12T00:00:00.000Z',
            entities: [validEntity, validEntity]
        }).success).toBe(false)
    })
})

describe('guarded query contract', () => {
    it('accepts structured projections and bounded operations', () => {
        expect(guardedQueryRequestSchema.parse(validQuery)).toEqual(validQuery)
    })

    it.each([
        ['empty projections', { ...validQuery, select: [] }],
        ['duplicate projections', { ...validQuery, select: ['name', 'name'] }],
        ['unknown operators', { ...validQuery, filter: [{ field: 'name', operator: 'raw', value: 'x' }] }],
        ['oversized row limits', { ...validQuery, top: 2_001 }],
        ['raw query keys', { ...validQuery, odata: '$select=*' }]
    ])('rejects %s', (_label, query) => {
        expect(guardedQueryRequestSchema.safeParse(query).success).toBe(false)
    })
})