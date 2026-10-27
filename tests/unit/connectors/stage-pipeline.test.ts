import { describe, expect, it, vi } from 'vitest'
import {
    LiveStagePipelineConnector, StagePipelineSourceError, type StagePipelineSource
} from '../../../packages/connectors/msx/stage-pipeline.js'
import { stagePipelineSnapshotSchema, type StagePipelineRequestInput } from '../../../packages/common/contracts/stage-pipeline-review.js'
import { stagePipelineRequestSchema } from '../../../packages/common/contracts/stage-pipeline-review.js'
import type { DataverseRow } from '../../../packages/connectors/msx/stage-pipeline-mapping.js'

const fv = '@OData.Community.Display.V1.FormattedValue'
const now = () => new Date('2026-10-21T12:00:00Z')

function opportunity(id: string, overrides: DataverseRow = {}): DataverseRow {
    return {
        opportunityid: id, name: `Opportunity ${id}`, statecode: 0, msp_opportunitynumber: `7-${id}`,
        _parentaccountid_value: `account-${id}`, [`_parentaccountid_value${fv}`]: `CUSTOMER ${id}`,
        [`_ownerid_value${fv}`]: 'Pat Seller', msp_activesalesstage: 'Inspire & Design',
        msp_estcompletiondate: '2026-12-31', msdyn_forecastcategory: 100000001, [`msdyn_forecastcategory${fv}`]: 'Pipeline',
        msp_consumptionconsumedrecurring: 1000, msp_solutionarea: 394380000, msp_competethreatlevel: 861980001,
        ...overrides
    }
}
function milestone(id: string, opportunityId: string, overrides: DataverseRow = {}): DataverseRow {
    return {
        msp_engagementmilestoneid: id, _msp_opportunityid_value: opportunityId, msp_name: `ms ${id}`, msp_milestonestatus: 861980000,
        msp_commitmentrecommendation: 861980000, msp_monthlyuse: 1000, msp_milestonedate: '2026-12-01', ...overrides
    }
}

type Data = {
    me?: string
    dealTeam?: Record<string, string[]>
    milestoneTeam?: Record<string, string[]>
    reports?: DataverseRow[]
    opportunities?: DataverseRow[]
    milestones?: DataverseRow[]
    failMilestoneTeamFor?: string[]
    failDealTeamFor?: string[]
}

function createSource(data: Data = {}) {
    const calls: Array<{ entitySet: string; params: Record<string, string> }> = []
    const source: StagePipelineSource = {
        getCurrentUserId: vi.fn(async () => data.me ?? 'user-me'),
        listDealTeamOpportunityIds: vi.fn(async (userId: string) => {
            if (data.failDealTeamFor?.includes(userId)) throw Object.assign(new Error('denied'), { status: 403 })
            return data.dealTeam?.[userId] ?? []
        }),
        listMilestoneTeamOpportunityIds: vi.fn(async (userId: string) => {
            if (data.failMilestoneTeamFor?.includes(userId)) throw Object.assign(new Error('denied'), { status: 403 })
            return data.milestoneTeam?.[userId] ?? []
        }),
        readRows: vi.fn(async (entitySet: string, params: Record<string, string>) => {
            calls.push({ entitySet, params })
            const filter = params['$filter'] ?? ''
            if (entitySet === 'systemusers' && filter.includes('_parentsystemuserid_value')) return data.reports ?? []
            if (entitySet === 'systemusers') return [{ systemuserid: data.me ?? 'user-me', fullname: 'Pat Seller' }]
            const ids = [...filter.matchAll(/(?:opportunityid|_msp_opportunityid_value) eq ([\w-]+)/g)].map((match) => match[1]!)
            if (entitySet === 'opportunities') return (data.opportunities ?? []).filter((row) => ids.includes(String(row['opportunityid'])))
            if (entitySet === 'msp_engagementmilestones') return (data.milestones ?? []).filter((row) => ids.includes(String(row['_msp_opportunityid_value'])))
            throw new Error(`Unexpected entity set ${entitySet}`)
        })
    }
    return { source, calls }
}

const request = (input: Partial<StagePipelineRequestInput> = {}) => stagePipelineRequestSchema.parse({ contractVersion: '1.1', operation: 'get', ...input })

describe('LiveStagePipelineConnector', () => {
    it('builds a valid live snapshot for the seller portfolio from deal-team and milestone-team opportunities', async () => {
        const { source, calls } = createSource({
            dealTeam: { 'user-me': ['o1', 'o2'] }, milestoneTeam: { 'user-me': ['o2', 'o3'] },
            opportunities: [opportunity('o1'), opportunity('o2', { msp_solutionarea: 861980005 }), opportunity('o3', { msp_activesalesstage: 'Qualify Lead' }), opportunity('o9')],
            milestones: [milestone('m1', 'o1'), milestone('m2', 'o1', { msp_milestonestatus: 999 }), milestone('m3', 'o3')]
        })
        const snapshot = await new LiveStagePipelineConnector(source, { now }).load(request())
        expect(stagePipelineSnapshotSchema.parse(snapshot)).toEqual(snapshot)
        expect(snapshot).toMatchObject({
            mode: 'live', state: 'fresh', scope: 'mine', reports: [], owner: 'Pat Seller', asOf: '2026-10-21', fiscalYear: 2027
        })
        expect(snapshot).not.toHaveProperty('capabilities')
        expect(snapshot.opportunities.map((row) => row.id)).toEqual(['o1'])
        expect(snapshot.opportunities[0]).toMatchObject({ editable: true, customer: 'CUSTOMER o1' })
        expect(snapshot.milestones.map((row) => row.id)).toEqual(['m1'])
        expect(snapshot.acr.source).toBe('derived-pipeline-only')
        const byName = Object.fromEntries(snapshot.sources.map((row) => [row.source, row]))
        expect(byName['opportunities']).toMatchObject({ state: 'partial', count: 1 })
        expect(byName['opportunities']?.detail).toMatch(/2 .*excluded/i)
        expect(byName['milestones']).toMatchObject({ state: 'partial' })
        expect(byName['macc']).toMatchObject({ state: 'unavailable' })
        expect(byName['acr']).toMatchObject({ state: 'unavailable' })
        expect(calls.find((call) => call.entitySet === 'opportunities')?.params['$filter']).toMatch(/^statecode eq 0 and \(opportunityid eq o1 or /)
        expect(source.getCurrentUserId).toHaveBeenCalledTimes(1)
    })

    it('chunks large id sets into 40-id requests', async () => {
        const ids = Array.from({ length: 85 }, (_, index) => `o${index}`)
        const { source, calls } = createSource({ dealTeam: { 'user-me': ids }, opportunities: ids.map((id) => opportunity(id)) })
        const snapshot = await new LiveStagePipelineConnector(source, { now }).load(request())
        expect(snapshot.opportunities).toHaveLength(85)
        const sizes = calls.filter((call) => call.entitySet === 'opportunities').map((call) => (call.params['$filter']!.match(/opportunityid eq /g) ?? []).length)
        expect(sizes.sort((a, b) => b - a)).toEqual([40, 40, 5])
    })

    it('reads direct reports for the reports scope and only trusts discovered report ids', async () => {
        const { source } = createSource({
            reports: [{ systemuserid: 'user-a', fullname: 'Report A' }, { systemuserid: 'user-b', fullname: 'Report B' }],
            dealTeam: { 'user-me': ['o1'], 'user-a': ['o2'], 'user-b': ['o3'], 'user-x': ['o9'] },
            opportunities: ['o1', 'o2', 'o3', 'o9'].map((id) => opportunity(id))
        })
        const connector = new LiveStagePipelineConnector(source, { now })
        const all = await connector.load(request({ scope: 'reports' }))
        expect(all.scope).toBe('reports')
        expect(all.reports).toEqual([{ id: 'user-a', displayName: 'Report A' }, { id: 'user-b', displayName: 'Report B' }])
        expect(all.opportunities.map((row) => row.id).sort()).toEqual(['o2', 'o3'])
        expect(all.opportunities.every((row) => row.editable === false)).toBe(true)
        expect(all.sources.find((row) => row.source === 'hierarchy')).toMatchObject({ state: 'complete', count: 2 })

        const subset = await connector.load(request({ scope: 'reports', reportIds: ['user-a', 'user-x'] }))
        expect(subset.opportunities.map((row) => row.id)).toEqual(['o2'])
        expect(subset.reports.map((row) => row.id)).toEqual(['user-a', 'user-b'])
        expect(source.listDealTeamOpportunityIds).not.toHaveBeenCalledWith('user-x')
    })

    it('never marks anything editable and never reads the seller portfolio in the reports scope', async () => {
        const { source } = createSource({
            reports: [{ systemuserid: 'user-a', fullname: 'Report A' }],
            dealTeam: { 'user-me': ['o1', 'o2'], 'user-a': ['o2', 'o3'] },
            opportunities: ['o1', 'o2', 'o3'].map((id) => opportunity(id))
        })
        const snapshot = await new LiveStagePipelineConnector(source, { now }).load(request({ scope: 'reports' }))
        expect(snapshot.opportunities.map((row) => [row.id, row.editable])).toEqual([['o2', false], ['o3', false]])
        expect(source.listDealTeamOpportunityIds).not.toHaveBeenCalledWith('user-me')
        expect(source.listMilestoneTeamOpportunityIds).not.toHaveBeenCalledWith('user-me')
    })

    it('unions the seller and report portfolios and marks only the seller portfolio editable', async () => {
        const { source } = createSource({
            reports: [{ systemuserid: 'user-a', fullname: 'Report A' }],
            dealTeam: { 'user-me': ['o1', 'o2'], 'user-a': ['o2', 'o3'] },
            opportunities: ['o1', 'o2', 'o3'].map((id) => opportunity(id))
        })
        const snapshot = await new LiveStagePipelineConnector(source, { now }).load(request({ scope: 'both' }))
        expect(snapshot.opportunities.map((row) => [row.id, row.editable])).toEqual([['o1', true], ['o2', true], ['o3', false]])
    })

    it('degrades to partial when a report portfolio cannot be read', async () => {
        const { source } = createSource({
            reports: [{ systemuserid: 'user-a', fullname: 'Report A' }, { systemuserid: 'user-b', fullname: 'Report B' }],
            dealTeam: { 'user-a': ['o2'], 'user-b': ['o3'] }, failMilestoneTeamFor: ['user-a'], failDealTeamFor: ['user-b'],
            opportunities: ['o2', 'o3'].map((id) => opportunity(id))
        })
        const snapshot = await new LiveStagePipelineConnector(source, { now }).load(request({ scope: 'reports' }))
        expect(snapshot.opportunities.map((row) => row.id)).toEqual(['o2'])
        const health = snapshot.sources.find((row) => row.source === 'opportunities')
        expect(health).toMatchObject({ state: 'partial' })
        expect(health?.detail).toMatch(/2 .*report/i)
    })

    it('reports a missing hierarchy as an explicit empty scope rather than failure', async () => {
        const { source } = createSource({ reports: [] })
        const snapshot = await new LiveStagePipelineConnector(source, { now }).load(request({ scope: 'reports' }))
        expect(snapshot.reports).toEqual([])
        expect(snapshot.opportunities).toEqual([])
        expect(snapshot.sources.find((row) => row.source === 'hierarchy')).toMatchObject({ state: 'complete', count: 0 })
    })

    it.each([[401, 'unauthorized'], [403, 'forbidden'], [429, 'throttled'], [500, 'source-unavailable']] as const)(
        'maps HTTP %i failures of the seller portfolio to %s', async (status, code) => {
            const { source } = createSource()
            source.listDealTeamOpportunityIds = vi.fn(async () => { throw Object.assign(new Error('failed'), { status }) })
            await expect(new LiveStagePipelineConnector(source, { now }).load(request())).rejects.toMatchObject({ name: 'StagePipelineSourceError', code })
        })

    it('does not fail the seller portfolio when only the milestone-team read is denied', async () => {
        const { source } = createSource({
            dealTeam: { 'user-me': ['o1'] }, failMilestoneTeamFor: ['user-me'], opportunities: [opportunity('o1')]
        })
        const snapshot = await new LiveStagePipelineConnector(source, { now }).load(request())
        expect(snapshot.opportunities).toHaveLength(1)
        expect(snapshot.sources.find((row) => row.source === 'opportunities')).toMatchObject({ state: 'partial' })
    })

    it('reports truncation instead of silently clipping the row caps', async () => {
        const { source } = createSource({
            dealTeam: { 'user-me': ['o1', 'o2', 'o3'] }, opportunities: ['o1', 'o2', 'o3'].map((id) => opportunity(id)),
            milestones: [milestone('m1', 'o1'), milestone('m2', 'o1'), milestone('m3', 'o2')]
        })
        const snapshot = await new LiveStagePipelineConnector(source, { now, limits: { opportunities: 2, milestones: 2 } }).load(request())
        expect(snapshot.opportunities).toHaveLength(2)
        expect(snapshot.milestones).toHaveLength(2)
        expect(snapshot.sources.find((row) => row.source === 'opportunities')).toMatchObject({ state: 'partial' })
        expect(snapshot.sources.find((row) => row.source === 'opportunities')?.detail).toMatch(/limited|truncated/i)
        expect(snapshot.sources.find((row) => row.source === 'milestones')).toMatchObject({ state: 'partial' })
    })

    it('never exposes source error text from private rows', async () => {
        const { source } = createSource()
        source.listDealTeamOpportunityIds = vi.fn(async () => { throw new Error('secret customer name Contoso') })
        const failure = await new LiveStagePipelineConnector(source, { now }).load(request()).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(StagePipelineSourceError)
        expect((failure as Error).message).not.toMatch(/Contoso|secret/)
    })
})
