import { describe, expect, it, vi } from 'vitest'
import { createSeReportingFixture, sampleSeProfile } from '../../../packages/common/fixtures/se-reporting.js'
import { LiveSeReportingReader } from '../../../packages/connectors/se-reporting/live.js'
import type { SeDataverseSource } from '../../../packages/connectors/se-reporting/dataverse.js'

const contract = `Schema version: \`2.0\`
\`\`\`yaml
manager:
  manager_system_user_id: "sample-manager-id"
  manager_alias: "sample-manager"
  display_name: "Morgan Sample"
\`\`\`
### ATUs
- atu-one
- atu-two
### Pillars
- infra
### Account Eligibility and Assignment Scope
### Scorecard
Committed On and actualend determine event timing.
### Customer Updates
### Asks for Manager
### Dashboard Sections
See more
`
const fv = '@OData.Community.Display.V1.FormattedValue'

function setup(options: { dropMilestone?: string; failDataverse?: boolean; sourcePreference?: 'powerbi' | 'dataverse' | 'auto'; withDataverse?: boolean; directReports?: string[]; failHierarchy?: boolean }) {
    const input = createSeReportingFixture()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (target, init) => {
        const url = String(target)
        if (url.includes('/me?')) return Response.json({ id: 'graph-user', displayName: input.owner.name, mail: input.owner.email, userPrincipalName: input.owner.email })
        if (url.includes('/shares/')) return Response.json({ id: 'contract-file', name: 'reporting-contract.md', parentReference: { driveId: 'drive-one' }, webUrl: sampleSeProfile.contractUrl, file: {} })
        if (url.includes('/contract-file/content')) return new Response(contract)
        if (url.includes('/me/messages')) return Response.json({ value: [] })
        if (url.includes('/executeQueries')) {
            const query = (JSON.parse(String(init?.body)) as { queries: { query: string }[] }).queries[0]!.query
            const rows = query.includes('FILTER(systemuser') ? [{ ID: input.owner.system_user_id }]
                : query.includes('DISTINCT(SELECTCOLUMNS') ? [{ ID: input.contract.manager.system_user_id }]
                    : query.includes('AccountAssignmentsWithCustomerIds') ? input.assignments.filter((row) => row.managerId === input.contract.manager.system_user_id)
                        : query.includes('TOPN(1, FILTER(PodMilestones') ? [{ 'Committed On': null, 'Completed On': null, 'Created On': null }]
                            : query.includes('FILTER(PodMilestones') ? input.milestones
                                : query.includes('TOPN(1, FILTER(task') ? [{ actualstart: null }] : input.tasks
            return Response.json({ results: [{ tables: [{ rows }] }] })
        }
        throw new Error(`Unexpected synthetic test request: ${new URL(url).pathname}`)
    })
    const milestoneRows = input.milestones.filter((row) => row.id !== options.dropMilestone).map((row) => ({
        msp_engagementmilestoneid: row.id, _msp_opportunityid_value: `opp-${row.id}`, msp_name: row.name,
        [`msp_milestonecategory${fv}`]: row.category, [`msp_milestonestatus${fv}`]: row.status, [`msp_commitmentrecommendation${fv}`]: row.commitment,
        msp_monthlyuse: row.monthlyAcr, msp_milestonedate: row.date, msp_committedon: row.committedOn, msp_completedon: row.completedOn, createdon: row.createdOn
    }))
    const calls: string[] = []
    const dataverse: SeDataverseSource = {
        listMilestoneTeamMilestoneIds: async () => {
            if (options.failDataverse) throw new Error('denied')
            return milestoneRows.map((row) => row.msp_engagementmilestoneid)
        },
        readRows: async (entitySet, params) => {
            calls.push(entitySet)
            const filter = params['$filter'] ?? ''
            if (entitySet === 'systemusers') {
                if (options.failHierarchy) throw new Error('denied')
                return (options.directReports ?? []).map((id) => ({ systemuserid: id, fullname: 'Someone' }))
            }
            if (entitySet === 'msp_engagementmilestones') return milestoneRows.filter((row) => filter.includes(`msp_engagementmilestoneid eq ${row.msp_engagementmilestoneid}`))
            if (entitySet === 'opportunities') return input.milestones.filter((row) => filter.includes(`opportunityid eq opp-${row.id}`)).map((row) => ({ opportunityid: `opp-${row.id}`, _parentaccountid_value: row.accountId }))
            return input.tasks.map((task) => ({
                activityid: task.id, _ownerid_value: task.ownerId, _regardingobjectid_value: task.milestoneId, [`_regardingobjectid_value${fv}`]: task.milestoneName,
                subject: task.subject, msp_taskcategory: task.categoryCode ? Number(task.categoryCode) : null, statecode: task.state, actualend: task.actualEnd, actualstart: task.activityDate
            }))
        }
    }
    const reader = new LiveSeReportingReader({
        getToken: async () => 'synthetic-token', expectedEmail: async () => input.owner.email, fetcher, now: () => new Date('2026-11-01T12:00:00Z'),
        ...(options.withDataverse === false ? {} : { dataverse }), ...(options.sourcePreference ? { sourcePreference: options.sourcePreference } : {})
    })
    const run = async () => {
        const inspection = await reader.inspect(sampleSeProfile)
        return reader.collect(sampleSeProfile, inspection, { period: '2026-10', pillar: 'infra', allowUnavailable: [], runId: 'run-one' })
    }
    const powerBiMilestoneQueries = () => fetcher.mock.calls.filter(([url, init]) => String(url).includes('/executeQueries') && String(init?.body).includes('SELECTCOLUMNS(FILTER(PodMilestones')).length
    const access = async () => {
        const inspection = await reader.inspect(sampleSeProfile)
        return reader.checkAccess(sampleSeProfile, inspection)
    }
    return { run, access, calls, input, powerBiMilestoneQueries }
}

const msx = (access: Array<{ source: string; detail: string }>) => access.find((row) => row.source === 'msx')!.detail

describe('SE reporting hierarchy sanity check', () => {
    it('confirms the reporter is a direct report of the contract manager without exposing identities', async () => {
        const { access, input } = setup({ directReports: ['someone-else', 'sample-reporter-id'] })
        const detail = msx(await access())
        expect(detail).toMatch(/hierarchy: the reporter is a direct report of the contract manager \(2 direct reports\)/i)
        expect(detail).not.toContain(input.owner.system_user_id)
    })

    it('flags a hierarchy that disagrees with the assignment source but keeps assignments authoritative', async () => {
        const detail = msx(await setup({ directReports: ['someone-else'] }).access())
        expect(detail).toMatch(/not a direct report.*assignments from the semantic model remain authoritative/i)
    })

    it('reports an unreadable hierarchy and skips the check when Dataverse is not configured', async () => {
        expect(msx(await setup({ failHierarchy: true }).access())).toMatch(/hierarchy could not be read/i)
        expect(msx(await setup({ withDataverse: false }).access())).not.toMatch(/hierarchy/i)
    })
})

describe('SE reporting MSX provider selection', () => {
    it('keeps Power BI as the default even when Dataverse is available', async () => {
        const { run, calls, powerBiMilestoneQueries } = setup({})
        const result = await run()
        expect(powerBiMilestoneQueries()).toBe(1)
        expect(calls).toEqual([])
        expect(msx(result.access)).not.toMatch(/Dataverse/)
    })

    it('uses only Dataverse when it is selected explicitly', async () => {
        const { run, input, powerBiMilestoneQueries } = setup({ sourcePreference: 'dataverse' })
        const result = await run()
        expect(powerBiMilestoneQueries()).toBe(0)
        expect(result.milestones.map((row) => row.id).sort()).toEqual(input.milestones.map((row) => row.id).sort())
        expect(result.tasks).toHaveLength(input.tasks.length)
        expect(msx(result.access)).toMatch(/Dataverse/)
        expect(result.eventDateCoverage).toEqual({ committed: true, completed: true, created: true })
    })

    it('uses Dataverse in auto mode only when its inventories match Power BI', async () => {
        const matched = await setup({ sourcePreference: 'auto' }).run()
        expect(msx(matched.access)).toMatch(/from Dataverse.*parity/i)
        const diverged = await setup({ sourcePreference: 'auto', dropMilestone: 'active-two' }).run()
        expect(msx(diverged.access)).toMatch(/parity was not met.*Power BI/i)
        expect(diverged.milestones.map((row) => row.id)).toContain('active-two')
    })

    it('falls back to Power BI when Dataverse cannot be read in auto mode', async () => {
        const result = await setup({ sourcePreference: 'auto', failDataverse: true }).run()
        expect(msx(result.access)).toMatch(/Dataverse was unavailable.*Power BI/i)
        expect(result.milestones.length).toBeGreaterThan(0)
    })

    it('ignores the preference when no Dataverse access is configured', async () => {
        const { run, powerBiMilestoneQueries } = setup({ sourcePreference: 'dataverse', withDataverse: false })
        await run()
        expect(powerBiMilestoneQueries()).toBe(1)
    })
})
