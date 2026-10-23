import { describe, expect, it } from 'vitest'
import { createSeReportingFixture } from '../../../packages/common/fixtures/se-reporting.js'
import { buildSeReports, consolidateSeReports, resolveSeScope, validateSeNarratives } from '../../../packages/orchestrator/se-reporting/model.js'

describe('SE reporting contract populations', () => {
    it('applies manager, reporter, workload and assignment gates with Primary precedence', () => {
        const input = createSeReportingFixture()
        const scope = resolveSeScope(input)
        expect(scope.assignments).toHaveLength(2)
        expect(scope.assignments.find((row) => row.accountId === 'account-one')?.assignmentType).toBe('Primary')
        expect(scope.assignments.find((row) => row.accountId === 'account-two')?.assignmentType).toBe('Backup')
        expect(scope.milestones.some((row) => row.id === 'foreign-milestone')).toBe(false)
        expect(scope.milestones.some((row) => row.status === 'Cancelled')).toBe(false)
    })

    it('uses snapshot, fiscal inventory, dated events and actual HoK completions independently', () => {
        const [report] = buildSeReports(createSeReportingFixture())
        expect(report?.dashboard.kpis).toEqual({
            accounts_engaged: 1,
            active_milestones: { current: 1, fiscal_year: 2, as_of_date: '2026-10-20' },
            milestone_pipeline_influenced: { current: 1500, fiscal_year: 1500, as_of_date: '2026-10-20' },
            committed_milestones: { period: 1, fytd: 1 },
            hok_activities: { period: 1, fytd: 1 }
        })
        expect(report?.milestone_inventory.map((row) => row.id)).toEqual(['active-one', 'completed-one'])
        expect(report?.asks_for_manager).toEqual([])
        expect(report?.status).toBe('draft')
    })

    it('creates a slice from fiscal-year pipeline without inventing monthly activity', () => {
        const input = createSeReportingFixture()
        input.tasks = []
        input.evidence = []
        const reports = buildSeReports(input)
        expect(reports).toHaveLength(2)
        expect(reports.every((report) => report.dashboard.kpis.accounts_engaged === 0)).toBe(true)
        expect(reports[1]?.cross_collaboration.items).toEqual([])
    })

    it('does not infer commitment timing from current state or HoK completion from due dates', () => {
        const input = createSeReportingFixture()
        for (const row of input.milestones) row.committedOn = null
        for (const task of input.tasks) task.actualEnd = null
        const [report] = buildSeReports(input)
        expect(report?.dashboard.kpis.committed_milestones.period).toBeNull()
        expect(report?.dashboard.kpis.hok_activities.period).toBe(0)
    })

    it('deduplicates the active/completed/committed union and preserves missing amounts', () => {
        const input = createSeReportingFixture()
        input.milestones[0]!.completedOn = '2026-10-10'
        input.milestones.push({ ...input.milestones[0]! })
        const [report] = buildSeReports(input)
        expect(report?.dashboard.kpis.milestone_pipeline_influenced.current).toBe(1500)
        input.milestones[0]!.monthlyAcr = null
        input.milestones.at(-1)!.monthlyAcr = null
        expect(buildSeReports(input)[0]?.dashboard.kpis.milestone_pipeline_influenced.current).toBe(500)
    })

    it('builds person summaries only from same-run reports and preserves ATU context', () => {
        const reports = buildSeReports(createSeReportingFixture())
        const summary = consolidateSeReports(reports)
        expect(summary.artifact_type).toBe('person_monthly_summary')
        expect(summary.source_reports).toHaveLength(2)
        expect(summary.dashboard.kpis.active_milestones.current).toBe(2)
        expect(summary.milestone_inventory.map((row) => row.atu)).toEqual(['atu-one', 'atu-one', 'atu-two'])
        const foreign = structuredClone(reports[0]!)
        foreign.owner.system_user_id = 'someone-else'
        expect(() => consolidateSeReports([reports[0]!, foreign])).toThrow(/same reporter|same run/i)
    })

    it('blocks missing/ambiguous manager resolution and unmatched reporting populations', () => {
        const input = createSeReportingFixture()
        input.contract.manager.system_user_id = ''
        input.contract.manager.alias = ''
        expect(() => resolveSeScope(input)).toThrow(/manager/i)
        const other = createSeReportingFixture()
        other.owner.system_user_id = 'not-assigned'
        expect(() => resolveSeScope(other)).toThrow(/assignment|population/i)
    })

    it('keeps genuine multi-ATU account context while deduplicating person-level milestone amounts', () => {
        const input = createSeReportingFixture()
        input.assignments.push({ ...input.assignments[0]!, atu: 'atu-two' })
        const reports = buildSeReports(input)
        expect(reports[1]?.milestone_inventory.some((row) => row.id === 'active-one')).toBe(true)
        const summary = consolidateSeReports(reports)
        expect(summary.dashboard.kpis.active_milestones.current).toBe(2)
        expect(summary.dashboard.kpis.milestone_pipeline_influenced.current).toBe(3500)
    })

    it('keeps missing event-date capabilities unavailable even with no current committed rows', () => {
        const input = createSeReportingFixture()
        input.eventDateCoverage.committed = false
        for (const row of input.milestones) row.commitment = 'Uncommitted'
        expect(buildSeReports(input)[0]?.dashboard.kpis.committed_milestones.period).toBeNull()
        expect(buildSeReports(input)[0]?.scorecard.active_snapshot.status_breakdown).toEqual({ 'On Track': 1 })
    })

    it('rejects invented narrative references and amounts and does not accept generated manager asks', () => {
        const input = createSeReportingFixture()
        input.narratives.customer_updates[0]!.source_refs = ['invented-evidence']
        expect(() => validateSeNarratives(input.narratives, input)).toThrow(/unsupported source/)
        const clean = createSeReportingFixture()
        expect(() => validateSeNarratives({ ...clean.narratives, asks_for_manager: ['model-authored ask'] }, clean)).toThrow()
    })

    it('keeps Secondary collaboration HoK counts within the reporting month, not all FYTD', () => {
        const input = createSeReportingFixture()
        const task = input.tasks[0]!
        input.tasks.push({ ...task, id: 'secondary-october', milestoneId: 'active-two', accountId: 'account-two' },
            { ...task, id: 'secondary-september', milestoneId: 'active-two', accountId: 'account-two', actualEnd: '2026-09-10' })
        const reports = buildSeReports(input)
        expect(reports[1]?.cross_collaboration.items[0]?.hok_count).toBe(1)
        expect(consolidateSeReports(reports).cross_collaboration.summary.hok_count).toBe(1)
    })

    it('counts completed owned HoK separately from current milestone status', () => {
        const input = createSeReportingFixture()
        input.milestones[0]!.status = 'Cancelled'
        const [report] = buildSeReports(input)
        expect(report?.dashboard.kpis.active_milestones.current).toBe(0)
        expect(report?.dashboard.kpis.hok_activities.period).toBe(1)
        expect(report?.milestone_inventory.some((row) => row.id === 'active-one')).toBe(false)
    })

    it('does not require milestone access-team membership for completed tasks the reporter owns', () => {
        const input = createSeReportingFixture()
        input.milestones = input.milestones.filter((row) => row.id !== 'active-one')
        const [report] = buildSeReports(input)
        expect(report?.dashboard.kpis.hok_activities.period).toBe(1)
        expect(report?.dashboard.kpis.accounts_engaged).toBe(1)
        expect(report?.dashboard.kpis.active_milestones.current).toBe(0)
    })

    it('does not retain raw MSX blocker bodies in canonical report inventories', () => {
        const input = createSeReportingFixture()
        input.milestones[0]!.blocker = 'RAW_SOURCE_BODY_DO_NOT_RETAIN'
        expect(JSON.stringify(buildSeReports(input))).not.toContain('RAW_SOURCE_BODY_DO_NOT_RETAIN')
    })

    it('uses the contract-selected manager display name rather than a source-specific label', () => {
        const input = createSeReportingFixture()
        input.contract.manager.name = 'Contract Manager Name'
        expect(buildSeReports(input)[0]?.manager.name).toBe('Contract Manager Name')
    })
})
