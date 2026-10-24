import { describe, expect, it, vi } from 'vitest'
import { createSeReportingFixture, sampleSeProfile } from '../../../packages/common/fixtures/se-reporting.js'
import { LiveSeReportingReader } from '../../../packages/connectors/se-reporting/live.js'

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
function fixture(denyMail = false, recapBody = 'Contoso Energy confirmed the production readiness review.') {
    const input = createSeReportingFixture()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (target, init) => {
        const url = String(target)
        if (url.includes('/me?')) return Response.json({ id: 'graph-user', displayName: input.owner.name, mail: input.owner.email, userPrincipalName: input.owner.email })
        if (url.includes('/shares/')) return Response.json({ id: 'contract-file', name: 'reporting-contract.md', parentReference: { driveId: 'drive-one' }, webUrl: sampleSeProfile.contractUrl, file: {} })
        if (url.includes('/contract-file/content')) return new Response(contract)
        if (url.includes('/executeQueries')) {
            const body = JSON.parse(String(init?.body)) as { queries: { query: string }[] }
            const query = body.queries[0]!.query
            const rows = query.includes('FILTER(systemuser') ? [{ ID: input.owner.system_user_id }]
                : query.includes('DISTINCT(SELECTCOLUMNS') ? [{ ID: input.contract.manager.system_user_id }]
                    : query.includes('AccountAssignmentsWithCustomerIds') ? input.assignments.filter((row) => row.managerId === input.contract.manager.system_user_id)
                        : query.includes('TOPN(1, FILTER(PodMilestones') ? [{ 'Committed On': null, 'Completed On': null, 'Created On': null }]
                            : query.includes('FILTER(PodMilestones') ? input.milestones
                                : query.includes('TOPN(1, FILTER(task') ? [{ actualstart: null }]
                                    : input.tasks
            return Response.json({ results: [{ tables: [{ rows }] }] })
        }
        if (url.includes('/me/messages')) {
            if (denyMail) return new Response(null, { status: 403 })
            return Response.json({ value: [{
                id: 'message-one', subject: 'Contoso Energy architecture recap', receivedDateTime: '2026-10-10T12:00:00Z',
                body: { content: recapBody }, webLink: 'https://outlook.office.com/mail/message-one'
            }, {
                id: 'private-message', subject: 'Contoso Energy compensation review', receivedDateTime: '2026-10-10T12:00:00Z',
                body: { content: 'Private compensation information.' }, webLink: 'https://outlook.office.com/mail/private-message'
            }, {
                id: 'unassigned-message', subject: 'Unassigned customer recap', receivedDateTime: '2026-10-10T12:00:00Z',
                body: { content: 'This is not a currently assigned account.' }, webLink: 'https://outlook.office.com/mail/unassigned-message'
            }] })
        }
        throw new Error(`Unexpected synthetic test request: ${new URL(url).pathname}`)
    })
    const reader = new LiveSeReportingReader({
        getToken: async () => 'synthetic-token', expectedEmail: async () => input.owner.email,
        fetcher, now: () => new Date('2026-11-01T12:00:00Z')
    })
    return { reader, fetcher, input }
}
describe('SE reporting live adapter with deterministic source fixtures', () => {
    it('retrieves the live contract first, resolves current identities and gathers complete scoped facts', async () => {
        const { reader, fetcher } = fixture()
        const inspection = await reader.inspect(sampleSeProfile)
        expect(inspection.owner.email).toBe('alex@example.test')
        expect(inspection.contract.manager.alias).toBe('sample-manager')
        const input = await reader.collect(sampleSeProfile, inspection, { period: '2026-10', pillar: 'infra', allowUnavailable: [], runId: 'run-one' })
        expect(input.mode).toBe('live')
        expect(input.eventDateCoverage).toEqual({ committed: true, completed: true, created: true })
        expect(input.evidence).toHaveLength(1)
        expect(input.evidence[0]?.reference).toBe('https://outlook.office.com/mail/message-one')
        expect(input.evidence.some((row) => row.summary.includes('compensation'))).toBe(false)
        expect(input.tasks).toHaveLength(3)
        const queries = fetcher.mock.calls.filter(([url]) => String(url).includes('/executeQueries')).map(([, init]) => String(init?.body))
        const tasks = queries.find((query) => query.includes('SELECTCOLUMNS(FILTER(task'))
        expect(tasks).toContain('task[actualend] >= DATE(2026,7,1)')
        expect(tasks).toContain('task[actualend] < DATE(2026,11,1)')
        expect(tasks).toContain('LOOKUPVALUE(opportunity[customerid]')
    })
    it('blocks generation until missing enabled-source degradation is explicitly approved', async () => {
        const { reader } = fixture(true)
        const inspection = await reader.inspect(sampleSeProfile)
        const options = { period: '2026-10', pillar: 'infra', allowUnavailable: [], runId: 'run-one' }
        await expect(reader.collect(sampleSeProfile, inspection, options)).rejects.toMatchObject({ code: 'degraded-approval-required' })
        const partial = await reader.collect(sampleSeProfile, inspection, { ...options, allowUnavailable: ['m365_email'] })
        expect(partial.access).toContainEqual(expect.objectContaining({ source: 'm365_email', state: 'unavailable' }))
        expect(partial.evidence).toEqual([])
    })
    it('never uses the bundled contract when the configured live contract is unreachable', async () => {
        const { reader, fetcher } = fixture()
        fetcher.mockImplementationOnce(async () => Response.json({ id: 'graph-user', displayName: 'Alex Sample', mail: 'alex@example.test', userPrincipalName: 'alex@example.test' }))
        fetcher.mockImplementationOnce(async () => new Response(null, { status: 403 }))
        await expect(reader.inspect(sampleSeProfile)).rejects.toMatchObject({ code: 'reporting-source-denied' })
        expect(fetcher).toHaveBeenCalledTimes(2)
    })
    it('uses complete high-signal recap text rather than silently stopping at a preview', async () => {
        const { reader } = fixture(false, `Contoso Energy recap. ${'Supporting customer context. '.repeat(300)}Final customer decision recorded here.`)
        const inspection = await reader.inspect(sampleSeProfile)
        const input = await reader.collect(sampleSeProfile, inspection, { period: '2026-10', pillar: 'infra', allowUnavailable: [], runId: 'run-one' })
        expect(input.evidence[0]?.summary.length).toBeGreaterThan(4000)
        expect(input.evidence[0]?.summary).toContain('Final customer decision recorded here.')
    })
})
