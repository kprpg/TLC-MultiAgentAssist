import { describe, expect, it, vi } from 'vitest'
import { LiveMomentumCollector, type MomentumSource } from '../../../packages/connectors/msx/momentum-focus.js'

const me = '11111111-1111-4111-8111-111111111111'
const opportunityId = '22222222-2222-4222-8222-222222222222'
const milestoneId = '33333333-3333-4333-8333-333333333333'
const accountId = '44444444-4444-4444-8444-444444444444'
const currencyId = '55555555-5555-4555-8555-555555555555'
function setup(overrides: { opportunity?: Record<string, unknown>; milestone?: Record<string, unknown>; deny?: string } = {}) {
    const readRows = vi.fn(async (entity: string, parameters: Record<string, string>): Promise<Record<string, unknown>[]> => {
        if (!parameters['$top']) throw new Error('Every Momentum source read must be bounded.')
        if (entity === overrides.deny) throw Object.assign(new Error('Synthetic denied source'), { status: 403 })
        if (entity === 'systemusers') return []
        if (entity === 'opportunities') return [{
            opportunityid: opportunityId, name: 'Synthetic raw opportunity', _parentaccountid_value: accountId,
            '_parentaccountid_value@OData.Community.Display.V1.FormattedValue': 'Synthetic account',
            _ownerid_value: me, statecode: 0, msp_activesalesstage: '1 - Listen & Consult',
            estimatedvalue: 12_345, _transactioncurrencyid_value: currencyId, ...overrides.opportunity
        }]
        if (entity === 'msp_engagementmilestones') return [{
            msp_engagementmilestoneid: milestoneId, _msp_opportunityid_value: opportunityId,
            msp_name: 'Synthetic raw milestone', msp_milestonestatus: 861980002, msp_monthlyuse: 500,
            ...overrides.milestone
        }]
        if (entity === 'transactioncurrencies') return [{ transactioncurrencyid: currencyId, isocurrencycode: 'USD' }]
        if (entity === 'tasks') return [{
            activityid: 'task-one', _regardingobjectid_value: milestoneId, createdon: '2026-10-25T10:00:00Z',
            modifiedon: '2026-10-27T10:00:00Z', statecode: 1
        }]
        if (entity === 'annotations') return []
        return []
    })
    const source: MomentumSource = {
        getHlsAccountIds: vi.fn(async (ids: string[]) => ids),
        getCurrentUserId: vi.fn(async () => me), listDealTeamOpportunityIds: vi.fn(async () => [opportunityId]),
        listMilestoneTeamOpportunityIds: vi.fn(async () => []),
        listMilestoneTeamMilestoneIds: vi.fn(async () => [milestoneId]), readRows
    }
    return { source, readRows, collector: new LiveMomentumCollector(source, { now: () => new Date('2026-10-28T12:00:00Z') }) }
}
describe('bounded MSX Momentum collection (MF-005, MF-008, MF-009)', () => {
    it('defaults to HLS and excludes other/unclassified customers before reading their milestones or signals', async () => {
        const { collector, source, readRows } = setup()
        vi.mocked(source.getHlsAccountIds!).mockResolvedValue([])
        const data = await collector.load('portfolio')
        expect(data.records).toEqual([])
        expect(source.getHlsAccountIds).toHaveBeenCalledWith([accountId])
        expect(readRows.mock.calls.some(([entity]) => ['tasks', 'annotations', 'msp_engagementmilestones'].includes(entity))).toBe(false)
        expect(data.customerIndustry).toBe('hls')
        expect(data.sources).toContainEqual(expect.objectContaining({ source: 'industry', count: 0 }))
    })
    it('only removes the industry restriction when All authorized customers is explicitly requested', async () => {
        const { collector, source } = setup()
        expect((await collector.load('portfolio', 'all')).records).toHaveLength(2)
        expect(source.getHlsAccountIds).not.toHaveBeenCalled()
    })
    it('does not include unidentified parent accounts in HLS-only results', async () => {
        const { collector } = setup({ opportunity: { _parentaccountid_value: null } })
        expect((await collector.load('portfolio')).records).toEqual([])
    })
    it('fails closed when the provider cannot verify HLS membership', async () => {
        const { collector, source } = setup()
        delete source.getHlsAccountIds
        await expect(collector.load('portfolio')).rejects.toThrow(/HLS/i)
    })
    it('retains undated/unknown fields and never reuses normalized stage age or inferred currency', async () => {
        const { collector } = setup({ opportunity: { msp_activesalesstage: null, estimatedvalue: null } })
        const data = await collector.load('portfolio')
        expect(data.records[0]).toMatchObject({ stage: null, dueDate: null, value: { amount: null, currency: 'USD' } })
        expect(data.records[1]).toMatchObject({ dueDate: null, stage: null, value: { basis: 'monthly-usage', amount: 500, currency: null }, blocked: true })
        expect(data.records[0]!.history.state).toBe('unavailable')
    })
    it('does not silently classify an unknown source state or milestone status as active', async () => {
        const { collector } = setup({ opportunity: { statecode: null }, milestone: { msp_milestonestatus: null } })
        const data = await collector.load('portfolio')
        expect(data.records).toHaveLength(2)
        expect(data.records[0]).toMatchObject({ status: null, active: null, sourceQuality: 'partial' })
        expect(data.records[1]).toMatchObject({ status: null, active: null, sourceQuality: 'partial' })
    })
    it('uses canonical IDs and batches metadata reads without deep evidence per row or text content', async () => {
        const { collector, readRows } = setup()
        const data = await collector.load('portfolio')
        expect(data.records[0]!.onMyTeam).toBe(true)
        expect(data.records[1]!.onMyTeam).toBe(true)
        expect(data.records[1]!.events).toMatchObject([{ kind: 'task', sourceAt: '2026-10-25T10:00:00Z' }])
        expect(data.records.flatMap((row) => row.events).every((event) => !['stage-advanced', 'proof-completed'].includes(event.kind))).toBe(true)
        for (const [entity, parameters] of readRows.mock.calls) {
            expect(parameters['$top']).toBeDefined()
            if (entity === 'tasks' || entity === 'annotations') expect(parameters['$select']).not.toMatch(/description|notetext|subject/)
            if (entity === 'opportunities') expect(parameters['$filter']).toContain(opportunityId)
        }
        expect(readRows.mock.calls.length).toBeLessThan(12)
    })
    it('discloses a denied enrichment without inventing zero complete coverage', async () => {
        const { collector } = setup({ deny: 'tasks' })
        const data = await collector.load('portfolio')
        expect(data.complete).toBe(false)
        expect(data.sources).toContainEqual(expect.objectContaining({ source: 'activities', state: 'denied' }))
        expect(data.records.every((row) => row.sourceQuality !== 'complete')).toBe(true)
    })
    it('does not widen the portfolio for an SSP/SE preset or arbitrary IDs and rejects invalid scope identities', async () => {
        const { collector, source } = setup()
        vi.mocked(source.listDealTeamOpportunityIds).mockResolvedValue(['invalid-id or statecode eq 0'])
        await expect(collector.load('portfolio')).rejects.toThrow()
    })
    it('rechecks membership and drops inaccessible historical records on every read', async () => {
        const { collector, source } = setup()
        expect((await collector.load('portfolio')).records).toHaveLength(2)
        vi.mocked(source.listDealTeamOpportunityIds).mockResolvedValue([])
        expect((await collector.load('portfolio')).records).toEqual([])
    })
    it('marks capped collections and never treats only the first page as a complete cohort', async () => {
        const { source } = setup()
        vi.mocked(source.listDealTeamOpportunityIds).mockResolvedValue([opportunityId, '66666666-6666-4666-8666-666666666666'])
        const collector = new LiveMomentumCollector(source, { limits: { opportunities: 1, milestones: 1, signals: 1 } })
        expect((await collector.load('portfolio')).sources.some((source) => source.state === 'capped')).toBe(true)
    })
    it('excludes hidden accounts and never requests their activities', async () => {
        const { source, readRows } = setup()
        const data = await new LiveMomentumCollector(source, { excludedAccountIds: async () => [accountId] }).load('portfolio')
        expect(data.records).toEqual([])
        expect(readRows.mock.calls.some(([entity]) => entity === 'tasks')).toBe(false)
    })
    it('surfaces a current linked milestone blocker on its parent opportunity with a canonical evidence reference', async () => {
        const { collector } = setup()
        const data = await collector.load('portfolio')
        expect(data.records[0]).toMatchObject({ blocked: true, blockingMilestoneIds: [milestoneId] })
    })
    it('deduplicates source milestone rows before financial aggregation', async () => {
        const { collector, readRows } = setup()
        const original = readRows.getMockImplementation()!
        readRows.mockImplementation(async (entity, parameters) => {
            const rows = await original(entity, parameters)
            return entity === 'msp_engagementmilestones' ? [...rows, ...rows] : rows
        })
        expect((await collector.load('portfolio')).records.filter((row) => row.entity === 'milestone')).toHaveLength(1)
    })
    it('bounds concentrated per-record signals and qualifies the clipped cohort instead of failing the whole read', async () => {
        const { collector, readRows } = setup()
        const original = readRows.getMockImplementation()!
        readRows.mockImplementation(async (entity, parameters) => entity === 'tasks'
            ? Array.from({ length: 1_100 }, (_, index) => ({ activityid: `task-${index}`, _regardingobjectid_value: milestoneId, createdon: '2026-10-25T10:00:00Z' }))
            : original(entity, parameters))
        const data = await collector.load('portfolio')
        expect(data.complete).toBe(false)
        expect(data.records.find((row) => row.entity === 'milestone')!.events).toHaveLength(1_000)
        expect(data.sources).toContainEqual(expect.objectContaining({ source: 'activities', state: 'capped' }))
    })
})
