import { describe, expect, it, vi } from 'vitest'
import { DataverseSeReader, compareProviders, evaluateParity, type SeDataverseSource } from '../../../packages/connectors/se-reporting/dataverse.js'
import { seMilestoneSchema, seTaskSchema } from '../../../packages/common/contracts/se-reporting.js'

const fv = '@OData.Community.Display.V1.FormattedValue'
const reporter = 'user-me'

function milestoneRow(id: string, opportunityId: string, overrides: Record<string, unknown> = {}) {
    return {
        msp_engagementmilestoneid: id, _msp_opportunityid_value: opportunityId, msp_name: `Milestone ${id}`,
        msp_milestonecategory: 861980002, [`msp_milestonecategory${fv}`]: 'Production',
        msp_milestonestatus: 861980000, [`msp_milestonestatus${fv}`]: 'On Track',
        msp_commitmentrecommendation: 861980003, [`msp_commitmentrecommendation${fv}`]: 'Committed',
        msp_monthlyuse: 2500, msp_milestonedate: '2026-10-15', msp_committedon: '2026-10-02T10:00:00Z', msp_completedon: null, createdon: '2026-09-01T08:00:00Z',
        ...overrides
    }
}

function createSource(data: { milestoneIds?: string[]; milestones?: Array<Record<string, unknown>>; opportunities?: Array<Record<string, unknown>>; tasks?: Array<Record<string, unknown>> }) {
    const calls: Array<{ entitySet: string; params: Record<string, string> }> = []
    const source: SeDataverseSource = {
        listMilestoneTeamMilestoneIds: vi.fn(async () => data.milestoneIds ?? []),
        readRows: vi.fn(async (entitySet, params) => {
            calls.push({ entitySet, params })
            const filter = params['$filter'] ?? ''
            const ids = [...filter.matchAll(/(?:msp_engagementmilestoneid|opportunityid) eq ([\w-]+)/g)].map((match) => match[1]!)
            if (entitySet === 'msp_engagementmilestones') return (data.milestones ?? []).filter((row) => ids.includes(String(row['msp_engagementmilestoneid'])))
            if (entitySet === 'opportunities') return (data.opportunities ?? []).filter((row) => ids.includes(String(row['opportunityid'])))
            if (entitySet === 'tasks') return data.tasks ?? []
            throw new Error(`unexpected ${entitySet}`)
        })
    }
    return { source, calls }
}

describe('DataverseSeReader milestones', () => {
    it('maps the reporter milestone-team inventory onto the SE milestone contract', async () => {
        const { source, calls } = createSource({
            milestoneIds: ['m1', 'm2'],
            milestones: [milestoneRow('m1', 'o1'), milestoneRow('m2', 'o2', { msp_completedon: '2026-10-20T00:00:00Z', msp_monthlyuse: null })],
            opportunities: [{ opportunityid: 'o1', _parentaccountid_value: 'acct-1' }, { opportunityid: 'o2', _parentaccountid_value: 'acct-2' }]
        })
        const result = await new DataverseSeReader(source).readMilestones(reporter)
        expect(result.gaps).toEqual([])
        expect(result.milestones).toHaveLength(2)
        for (const row of result.milestones) expect(seMilestoneSchema.safeParse(row).success).toBe(true)
        expect(result.milestones[0]).toEqual({
            id: 'm1', reporterId: reporter, accountId: 'acct-1', opportunityId: 'o1', name: 'Milestone m1', category: 'Production', status: 'On Track',
            commitment: 'Committed', monthlyAcr: 2500, date: '2026-10-15', committedOn: '2026-10-02', completedOn: null, createdOn: '2026-09-01', blocker: ''
        })
        expect(result.milestones[1]).toMatchObject({ monthlyAcr: null, completedOn: '2026-10-20' })
        expect(calls.find((call) => call.entitySet === 'msp_engagementmilestones')?.params['$filter']).not.toContain('statecode')
    })

    it('records a gap instead of inventing an account when the opportunity path is unresolved', async () => {
        const { source } = createSource({
            milestoneIds: ['m1', 'm2'], milestones: [milestoneRow('m1', 'o1'), milestoneRow('m2', 'o-missing')],
            opportunities: [{ opportunityid: 'o1', _parentaccountid_value: 'acct-1' }]
        })
        const result = await new DataverseSeReader(source).readMilestones(reporter)
        expect(result.milestones.map((row) => row.id)).toEqual(['m1'])
        expect(result.gaps).toEqual(['A milestone with an unresolved opportunity/account path was excluded.'])
    })

    it('returns nothing without querying when the reporter is on no milestone teams, and chunks large id sets', async () => {
        const empty = createSource({})
        expect(await new DataverseSeReader(empty.source).readMilestones(reporter)).toEqual({ milestones: [], gaps: [] })
        expect(empty.source.readRows).not.toHaveBeenCalled()
        const ids = Array.from({ length: 95 }, (_, index) => `m${index}`)
        const { source, calls } = createSource({ milestoneIds: ids, milestones: ids.map((id) => milestoneRow(id, 'o1')), opportunities: [{ opportunityid: 'o1', _parentaccountid_value: 'acct-1' }] })
        const result = await new DataverseSeReader(source).readMilestones(reporter)
        expect(result.milestones).toHaveLength(95)
        expect(calls.filter((call) => call.entitySet === 'msp_engagementmilestones')).toHaveLength(3)
    })

    it('reads the configured risk/blocker field when the profile supplies one', async () => {
        const { source } = createSource({
            milestoneIds: ['m1'], milestones: [milestoneRow('m1', 'o1', { msp_riskcomment: 'Waiting on quota' })],
            opportunities: [{ opportunityid: 'o1', _parentaccountid_value: 'acct-1' }]
        })
        const result = await new DataverseSeReader(source, { riskField: 'msp_riskcomment' }).readMilestones(reporter)
        expect(result.milestones[0]?.blocker).toBe('Waiting on quota')
        expect(() => new DataverseSeReader(source, { riskField: 'bad field' })).toThrow(/risk/i)
    })
})

describe('DataverseSeReader tasks', () => {
    const window = { fiscalStart: '2026-07-01', start: '2026-10-01', endExclusive: '2026-11-01' }
    const taskRow = (id: string, milestoneId: string, overrides: Record<string, unknown> = {}) => ({
        activityid: id, _ownerid_value: reporter, _regardingobjectid_value: milestoneId, [`_regardingobjectid_value${fv}`]: `Milestone ${milestoneId}`,
        subject: 'Architecture review', msp_taskcategory: 861980004, statecode: 1, actualend: '2026-10-10', actualstart: '2026-10-09', ...overrides
    })

    it('reads owned tasks inside the fiscal and period windows and resolves accounts through the milestone path', async () => {
        const { source, calls } = createSource({
            milestoneIds: ['m1'], milestones: [milestoneRow('m1', 'o1')], opportunities: [{ opportunityid: 'o1', _parentaccountid_value: 'acct-1' }],
            tasks: [taskRow('t1', 'm1'), taskRow('t2', 'm1', { subject: 'Compensation review', actualend: null })]
        })
        const result = await new DataverseSeReader(source).readTasks(reporter, window)
        expect(result.tasks).toHaveLength(1)
        expect(seTaskSchema.safeParse(result.tasks[0]).success).toBe(true)
        expect(result.tasks[0]).toEqual({
            id: 't1', ownerId: reporter, milestoneId: 'm1', milestoneName: 'Milestone m1', accountId: 'acct-1', subject: 'Architecture review',
            categoryCode: '861980004', state: 1, actualEnd: '2026-10-10', activityDate: '2026-10-09'
        })
        const filter = calls.find((call) => call.entitySet === 'tasks')!.params['$filter']!
        expect(filter).toContain(`_ownerid_value eq ${reporter}`)
        expect(filter).toContain('actualend ge 2026-07-01')
        expect(filter).toContain('actualend lt 2026-11-01')
        expect(filter).toContain('actualstart ge 2026-10-01')
    })

    it('excludes tasks that do not resolve to a known account and records the gap', async () => {
        const { source } = createSource({ milestoneIds: [], tasks: [taskRow('t1', 'unknown-milestone')] })
        const result = await new DataverseSeReader(source).readTasks(reporter, window)
        expect(result.tasks).toEqual([])
        expect(result.gaps).toEqual(['A task with an unresolved milestone/opportunity/account path was excluded.'])
    })

    it('rejects an invalid owner id', async () => {
        const { source } = createSource({})
        await expect(new DataverseSeReader(source).readTasks('1) or (1 eq 1', window)).rejects.toThrow(/user id/i)
    })
})

describe('DataverseSeReader hierarchy', () => {
    it('lists enabled direct reports of a manager with a bounded read', async () => {
        const { source, calls } = createSource({})
        ;(source.readRows as ReturnType<typeof vi.fn>).mockImplementationOnce(async (entitySet: string, params: Record<string, string>) => {
            calls.push({ entitySet, params })
            return [{ systemuserid: 'user-a', fullname: 'Report A' }, { systemuserid: 'user-b' }, { fullname: 'no id' }]
        })
        const reports = await new DataverseSeReader(source).readDirectReports('manager-1')
        expect(reports).toEqual([{ id: 'user-a', displayName: 'Report A' }, { id: 'user-b', displayName: 'Unnamed user' }])
        expect(calls[0]).toMatchObject({ entitySet: 'systemusers' })
        expect(calls[0]!.params['$filter']).toBe('_parentsystemuserid_value eq manager-1 and isdisabled eq false')
        await expect(new DataverseSeReader(source).readDirectReports('1) or (1 eq 1')).rejects.toThrow(/user id/i)
    })
})

describe('provider parity', () => {
    it('compares id sets case-insensitively and reports the match ratio', () => {
        expect(compareProviders(['A', 'b', 'c'], ['a', 'B', 'd'])).toEqual({ dataverse: 3, powerbi: 3, common: 2, onlyDataverse: 1, onlyPowerBi: 1, ratio: 0.5 })
        expect(compareProviders([], [])).toMatchObject({ ratio: 1, common: 0 })
    })

    it('accepts parity only above the thresholds and reports counts, never ids', () => {
        const ids = (count: number, prefix = 'm') => Array.from({ length: count }, (_, index) => `${prefix}${index}`)
        const good = evaluateParity({ milestones: [ids(200), ids(200)], tasks: [ids(100, 't'), ids(100, 't')] })
        expect(good.ok).toBe(true)
        const bad = evaluateParity({ milestones: [ids(200), ids(190)], tasks: [ids(100, 't'), ids(100, 't')] })
        expect(bad.ok).toBe(false)
        expect(bad.detail).toMatch(/milestones .*95/i)
        expect(JSON.stringify(bad)).not.toContain('m199')
    })
})
