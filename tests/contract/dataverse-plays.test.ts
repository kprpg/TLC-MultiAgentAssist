import { describe, expect, it } from 'vitest'
import { dataverseEntityMapSchema, guardedQueryRequestSchema } from '../../packages/common/index.js'
import entityMapJson from '../../config/dataverse.entity-map.json' with { type: 'json' }
import { buildInitialWorkflowQuery } from '../../packages/orchestrator/workflows/index.js'

describe('guarded Play query compatibility', () => {
    it('uses the existing strict query contract for the fixed parent projection', () => {
        const query = buildInitialWorkflowQuery('WF-002', { asOf: '2026-09-12' })
        expect(guardedQueryRequestSchema.parse(query)).toEqual(query)
        expect(query.expand).toEqual([{ relationship: 'opportunity', select: ['accountId', 'name'] }])
        expect(() => guardedQueryRequestSchema.parse({ ...query, rawSql: 'SELECT * FROM opportunity' })).toThrow()
    })

    it('uses the microsoftsales status values captured in the reviewed tenant metadata', () => {
        const mapping = dataverseEntityMapSchema.parse(entityMapJson)
        const status = mapping.entities.find((entity) => entity.canonical === 'engagementMilestone')
            ?.attributes.find((attribute) => attribute.canonical === 'status')
        expect(status).toMatchObject({
            logicalName: 'msp_milestonestatus', dataType: 'optionset',
            optionSet: {
                'On Track': 861980000, 'At Risk': 861980001, Blocked: 861980002, Completed: 861980003,
                Cancelled: 861980004, 'Lost to Competitor': 861980005, 'Hygiene/Duplicate': 861980006
            }
        })
    })
})
