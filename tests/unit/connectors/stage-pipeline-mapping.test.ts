import { describe, expect, it } from 'vitest'
import {
    deriveAcrPipe, fiscalMonths, mapMilestoneRow, mapOpportunityRow, parseMoneyText, parseStage, type DataverseRow
} from '../../../packages/connectors/msx/stage-pipeline-mapping.js'

const fv = '@OData.Community.Display.V1.FormattedValue'
const asOf = '2026-10-21'

function opportunityRow(overrides: DataverseRow = {}): DataverseRow {
    return {
        opportunityid: 'opp-1', name: 'Azure SQL modernization', statecode: 0, msp_opportunitynumber: '7-ABC123',
        _parentaccountid_value: 'acct-1', [`_parentaccountid_value${fv}`]: 'CONTOSO HEALTH',
        [`_ownerid_value${fv}`]: 'Pat Seller', _ownerid_value: 'user-1',
        [`_parentcontactid_value${fv}`]: 'Casey Contact',
        msp_activesalesstage: 'Inspire & Design', msp_currentsalesstagemodifiedon: '2026-10-01', msp_daysinstage: 0,
        msp_estcompletiondate: '2026-12-31', estimatedclosedate: '2027-01-15',
        msdyn_forecastcategory: 100000003, [`msdyn_forecastcategory${fv}`]: 'Committed',
        msp_forecastcomments: 'AB - 12/Oct - validating plan',
        msp_forecastcomments_lastmodifiedon_datetime: '2026-08-22T10:00:00Z',
        msp_consumptionconsumedrecurring: 12000, msp_consumptionconsumednonrecurring: 500,
        msp_solutionarea: 394380000, [`msp_solutionarea${fv}`]: 'Cloud and AI Platforms',
        msp_sourcesubtypecode: 861981141,
        msp_competethreatlevel: 861980003, [`_msp_primarycompetitor_value${fv}`]: 'Competitor X',
        [`_msp_partneraccountid_value${fv}`]: 'Example Partner',
        ...overrides
    }
}

describe('stage and pipeline Dataverse mapping', () => {
    it('maps the five MCEM stages and rejects pre-stages without coercion', () => {
        expect(parseStage('Listen & Consult')).toBe('Listen & Consult')
        expect(parseStage('4-Inspire & Design')).toBe('Inspire & Design')
        expect(parseStage(' manage & optimize ')).toBe('Manage & Optimize')
        expect(parseStage('Qualify Lead')).toBeUndefined()
        expect(parseStage('Select Lead')).toBeUndefined()
        expect(parseStage(null)).toBeUndefined()
    })

    it('maps an open Azure opportunity with derived idle days and stage age', () => {
        const result = mapOpportunityRow(opportunityRow(), { asOf, editableIds: new Set(['opp-1']), inboundCodes: new Set([861981141]) })
        expect(result.kind).toBe('row')
        if (result.kind !== 'row') return
        expect(result.row).toMatchObject({
            id: 'opp-1', number: '7-ABC123', customer: 'CONTOSO HEALTH', name: 'Azure SQL modernization', owner: 'Pat Seller', editable: true,
            contact: 'Casey Contact', scope: 'azure', solutionArea: 'Cloud and AI Platforms', inbound: true,
            stage: 'Inspire & Design', status: 'In Progress', forecast: 'Committed', closeDate: '2026-12-31',
            daysInStage: 20, idleDays: 60, consumedRecurring: 12000, consumedNonRecurring: 500,
            partner: 'Example Partner', competitor: { name: 'Competitor X', threat: 'High' }
        })
        expect(result.row.notes).toBe('AB - 12/Oct - validating plan')
    })

    it('prefers a positive days-in-stage and uses null idle days when nothing is consumed or never commented', () => {
        const base = { asOf, editableIds: new Set<string>(), inboundCodes: new Set<number>() }
        const positive = mapOpportunityRow(opportunityRow({ msp_daysinstage: 7 }), base)
        expect(positive.kind === 'row' && positive.row.daysInStage).toBe(7)
        const idle = mapOpportunityRow(opportunityRow({ msp_consumptionconsumedrecurring: 0, msp_consumptionconsumednonrecurring: null }), base)
        expect(idle.kind === 'row' && idle.row.idleDays).toBeNull()
        const never = mapOpportunityRow(opportunityRow({ msp_forecastcomments_lastmodifiedon_datetime: null }), base)
        expect(never.kind === 'row' && never.row.idleDays).toBeNull()
        const notEditable = mapOpportunityRow(opportunityRow(), base)
        expect(notEditable.kind === 'row' && notEditable.row.editable).toBe(false)
    })

    it('falls back to estimated close date, formatted forecast and treats a None competitor as absent', () => {
        const base = { asOf, editableIds: new Set<string>(), inboundCodes: new Set<number>() }
        const result = mapOpportunityRow(opportunityRow({
            msp_estcompletiondate: null, msdyn_forecastcategory: 100000001, [`msdyn_forecastcategory${fv}`]: 'Pipeline',
            [`_msp_primarycompetitor_value${fv}`]: 'None', msp_competethreatlevel: 861980001, msp_sourcesubtypecode: null,
            [`_msp_partneraccountid_value${fv}`]: undefined
        }), base)
        expect(result.kind).toBe('row')
        if (result.kind !== 'row') return
        expect(result.row).toMatchObject({
            closeDate: '2027-01-15', forecast: 'Pipeline', inbound: false, partner: null,
            competitor: { name: null, threat: 'None' }
        })
    })

    it('maps by forecast code when the formatted value is missing and uses other competitor text', () => {
        const base = { asOf, editableIds: new Set<string>(), inboundCodes: new Set<number>() }
        const row = opportunityRow({
            [`msdyn_forecastcategory${fv}`]: undefined, msdyn_forecastcategory: 100000002,
            [`_msp_primarycompetitor_value${fv}`]: undefined, msp_othercompetitor: 'Other Vendor', msp_competethreatlevel: 861980002
        })
        const result = mapOpportunityRow(row, base)
        expect(result.kind === 'row' && result.row.forecast).toBe('Best case')
        expect(result.kind === 'row' && result.row.competitor).toEqual({ name: 'Other Vendor', threat: 'Medium' })
    })

    it('maps Microsoft Services scope and excludes unsupported areas, pre-stages and rows without an account', () => {
        const base = { asOf, editableIds: new Set<string>(), inboundCodes: new Set<number>() }
        const services = mapOpportunityRow(opportunityRow({ msp_solutionarea: 861980011, [`msp_solutionarea${fv}`]: 'Microsoft Services' }), base)
        expect(services.kind === 'row' && services.row.scope).toBe('microsoft-services')
        expect(mapOpportunityRow(opportunityRow({ msp_solutionarea: 861980005 }), base)).toEqual({ kind: 'excluded', reason: 'solution-area' })
        const unknownArea = mapOpportunityRow(opportunityRow({ msp_solutionarea: 861980013, [`msp_solutionarea${fv}`]: 'Unknown' }), base)
        expect(unknownArea.kind === 'row' && [unknownArea.row.scope, unknownArea.row.solutionTagReview]).toEqual(['azure', true])
        expect(mapOpportunityRow(opportunityRow({ msp_activesalesstage: 'Qualify Lead' }), base)).toEqual({ kind: 'excluded', reason: 'stage' })
        expect(mapOpportunityRow(opportunityRow({ _parentaccountid_value: null }), base)).toEqual({ kind: 'excluded', reason: 'account' })
    })

    it('maps won and lost state and never invents On Hold', () => {
        const base = { asOf, editableIds: new Set<string>(), inboundCodes: new Set<number>() }
        const won = mapOpportunityRow(opportunityRow({ statecode: 1 }), base)
        const lost = mapOpportunityRow(opportunityRow({ statecode: 2 }), base)
        expect(won.kind === 'row' && won.row.status).toBe('Won')
        expect(lost.kind === 'row' && lost.row.status).toBe('Lost')
    })

    it('clips oversize free text and names to the contract limits instead of rejecting the snapshot', () => {
        const long = 'x'.repeat(40_000)
        const base = { asOf, editableIds: new Set<string>(), inboundCodes: new Set<number>() }
        const result = mapOpportunityRow(opportunityRow({ msp_forecastcomments: long, name: 'n'.repeat(900), [`_ownerid_value${fv}`]: 'o'.repeat(400) }), base)
        expect(result.kind === 'row' && [result.row.notes.length, result.row.name.length, result.row.owner.length]).toEqual([30_000, 500, 200])
        const milestone = mapMilestoneRow({
            msp_engagementmilestoneid: 'ms-1', _msp_opportunityid_value: 'opp-1', msp_name: 'm'.repeat(900), msp_milestonestatus: 861980000,
            msp_forecastcomments: long, [`_ownerid_value${fv}`]: 'o'.repeat(40_000)
        })
        expect(milestone && [milestone.comment.length, milestone.name.length, milestone.owner.length]).toEqual([30_000, 500, 30_000])
    })

    it('maps milestone option codes onto the contract', () => {
        const row = {
            msp_engagementmilestoneid: 'ms-1', msp_milestonenumber: '7-M0001', _msp_opportunityid_value: 'opp-1', msp_name: 'production',
            msp_milestonestatus: 861980001, msp_commitmentrecommendation: 861980003, msp_monthlyuse: 5000, msp_milestonedate: '2026-11-30',
            msp_forecastcomments: 'on plan', [`_ownerid_value${fv}`]: 'Owner A', [`msp_workload${fv}`]: 'Azure SQL'
        }
        expect(mapMilestoneRow(row)).toEqual({
            id: 'ms-1', number: '7-M0001', opportunityId: 'opp-1', name: 'production', workload: 'Azure SQL', estimatedMonthlyAcr: 5000,
            commitment: 'Committed', status: 'At Risk', date: '2026-11-30', comment: 'on plan', owner: 'Owner A'
        })
        expect(mapMilestoneRow({ ...row, msp_milestonestatus: 861980005, msp_commitmentrecommendation: 861980000, msp_monthlyuse: null, msp_milestonedate: null, msp_forecastcomments: null }))
            .toMatchObject({ status: 'Lost to Competitor', commitment: 'Uncommitted', estimatedMonthlyAcr: 0, date: null, comment: '' })
        expect(mapMilestoneRow({ ...row, msp_milestonestatus: 999 })).toBeUndefined()
        expect(mapMilestoneRow({ ...row, _msp_opportunityid_value: null })).toBeUndefined()
    })

    it('parses MACC money strings strictly', () => {
        expect(parseMoneyText('$1,234,567.50')).toBe(1_234_567.5)
        expect(parseMoneyText('12.5M')).toBe(12_500_000)
        expect(parseMoneyText('750K')).toBe(750_000)
        expect(parseMoneyText(' 8000000 ')).toBe(8_000_000)
        expect(parseMoneyText('($500)')).toBe(-500)
        expect(parseMoneyText('N/A')).toBeNull()
        expect(parseMoneyText('12 apples')).toBeNull()
        expect(parseMoneyText('')).toBeNull()
        expect(parseMoneyText(null)).toBeNull()
    })

    it('lists the twelve fiscal months from July', () => {
        const months = fiscalMonths(2027)
        expect(months).toHaveLength(12)
        expect(months[0]).toBe('2026-07')
        expect(months[11]).toBe('2027-06')
    })

    it('derives cumulative committed, uncommitted and Stage 1 pipe layers without inventing actuals or targets', () => {
        const opportunities = [
            { id: 'opp-a', customer: 'ALPHA', stage: 'Listen & Consult' as const, status: 'In Progress' as const },
            { id: 'opp-b', customer: 'ALPHA', stage: 'Empower & Achieve' as const, status: 'In Progress' as const },
            { id: 'opp-c', customer: 'BETA', stage: 'Inspire & Design' as const, status: 'In Progress' as const },
            { id: 'opp-d', customer: 'BETA', stage: 'Inspire & Design' as const, status: 'Won' as const }
        ]
        const milestone = (id: string, opportunityId: string, status: 'On Track' | 'Completed' | 'Cancelled', commitment: 'Committed' | 'Uncommitted', date: string | null, acr: number) => ({
            id, number: id, opportunityId, name: id, workload: 'Azure', estimatedMonthlyAcr: acr, commitment, status, date, comment: '', owner: ''
        })
        const milestones = [
            milestone('m1', 'opp-a', 'On Track', 'Uncommitted', '2026-09-15', 1_000),
            milestone('m2', 'opp-b', 'On Track', 'Committed', '2026-08-01', 2_000),
            milestone('m3', 'opp-b', 'On Track', 'Uncommitted', '2026-12-10', 3_000),
            milestone('m4', 'opp-c', 'Cancelled', 'Committed', '2026-08-01', 9_999),
            milestone('m5', 'opp-c', 'Completed', 'Committed', '2026-08-01', 9_999),
            milestone('m6', 'opp-c', 'On Track', 'Uncommitted', '2025-01-01', 400),
            milestone('m7', 'opp-c', 'On Track', 'Committed', '2028-01-01', 800),
            milestone('m8', 'opp-d', 'On Track', 'Committed', '2026-08-01', 777),
            milestone('m9', 'opp-c', 'On Track', 'Committed', null, 555)
        ]
        const acr = deriveAcrPipe({ fiscalYear: 2027, opportunities, milestones })
        expect(acr).toMatchObject({ source: 'derived-pipeline-only', syncedAt: null, lastActualMonth: null })
        expect(acr.accounts.map((account) => account.customer)).toEqual(['ALPHA', 'BETA'])
        const alpha = acr.accounts[0]!
        expect(alpha.months).toHaveLength(12)
        expect(alpha.months.every((month) => month.actual === null && month.baseline === null && month.target === null)).toBe(true)
        // Aug committed 2,000/month starting 2026-08 (index 1)
        expect(alpha.months[0]).toMatchObject({ month: '2026-07', committed: 0, uncommitted: 0, stage1: 0 })
        expect(alpha.months[1]).toMatchObject({ month: '2026-08', committed: 2_000 })
        expect(alpha.months[2]).toMatchObject({ month: '2026-09', committed: 4_000, stage1: 1_000 })
        expect(alpha.months[3]).toMatchObject({ month: '2026-10', committed: 6_000, stage1: 2_000 })
        expect(alpha.months[5]).toMatchObject({ month: '2026-12', uncommitted: 3_000 })
        expect(alpha.months[11]).toMatchObject({ month: '2027-06', committed: 22_000, uncommitted: 21_000, stage1: 10_000 })
        const beta = acr.accounts[1]!
        // Pre-FY dated milestone starts in the first month; post-FY and undated and closed rows are excluded.
        expect(beta.months[0]).toMatchObject({ uncommitted: 400, committed: 0 })
        expect(beta.months[11]).toMatchObject({ uncommitted: 4_800, committed: 0 })
    })
})
