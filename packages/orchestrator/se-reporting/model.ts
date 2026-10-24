import {
    seNarrativeBundleSchema, seReportSchema,
    type SeMilestone, type SeNarrativeBundle, type SeReport, type SeReportingInput, type SeTask
} from '../../common/contracts/se-reporting.js'
import { seReportingDates } from '../../common/se-reporting-period.js'
export { seReportingDates } from '../../common/se-reporting-period.js'

export const seHokCategories: Readonly<Record<string, string>> = {
    '861980005': 'PoC/Pilot', '861980004': 'Architecture Design Session',
    '861980001': 'Workshop', '861980002': 'Demo', '861980007': 'Consumption Plan',
    '861980006': 'Blocker Escalation', '606820005': 'Technical Close/Win Plan'
}
const same = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase()
const excludedStatus = (value: string) => ['cancelled', 'hygiene/duplicate'].includes(value.trim().toLowerCase())
const active = (row: Pick<SeMilestone, 'status'>) => ['on track', 'at risk', 'blocked'].includes(row.status.trim().toLowerCase())
const within = (date: string | null, start: string, end: string) => date !== null && date >= start && date <= end
const distinct = <T>(rows: readonly T[], key: (row: T) => string): T[] => [...new Map(rows.map((row) => [key(row).toLowerCase(), row])).values()]
const totalAcr = (rows: readonly Pick<SeMilestone, 'monthlyAcr'>[]): number | null => rows.length && rows.every((row) => row.monthlyAcr === null)
    ? null : rows.reduce((total, row) => total + (row.monthlyAcr ?? 0), 0)

export function seTaskActivityDate(task: SeTask, start: string, end: string): string | null {
    const dates = task.state === 1 && seHokCategories[task.categoryCode] ? [task.actualEnd] : [task.actualEnd, task.activityDate]
    return dates.find((date) => within(date, start, end)) ?? null
}

export function resolveSeScope(input: SeReportingInput) {
    const { contract, owner } = input
    if (!contract.manager.system_user_id && !contract.manager.alias) throw new Error('The live contract must select a manager.')
    const managerRows = input.assignments.filter((row) => contract.manager.system_user_id
        ? same(row.managerId, contract.manager.system_user_id) : same(row.managerAlias, contract.manager.alias))
    const managers = distinct(managerRows, (row) => row.managerId)
    if (managers.length !== 1) throw new Error('The contract-selected manager must resolve to exactly one manager.')
    const manager = managers[0]!
    if (contract.manager.alias && !same(manager.managerAlias, contract.manager.alias)) throw new Error('The live contract manager alias does not match the resolved manager.')
    if (!contract.allowedPillars.some((pillar) => same(pillar, input.pillar))) throw new Error('The selected pillar is outside the live contract.')
    const eligible = managerRows.filter((row) => same(row.reporterId, owner.system_user_id) &&
        same(row.workload, input.pillar) && contract.allowedAtus.includes(row.atu))
    const assignments = distinct(eligible.filter((row) => row.assignmentType === 'Primary' ||
        !eligible.some((primary) => same(primary.accountId, row.accountId) && primary.assignmentType === 'Primary')),
        (row) => `${row.accountId}:${row.atu}`)
    if (!assignments.length) throw new Error('No current eligible assignments exist in this manager reporting population.')
    const byAccount = new Map(assignments.map((row) => [row.accountId.toLowerCase(), row]))
    const seen = new Map<string, SeMilestone>()
    for (const row of input.milestones) {
        if (!same(row.reporterId, owner.system_user_id) || !byAccount.has(row.accountId.toLowerCase()) || excludedStatus(row.status)) continue
        const previous = seen.get(row.id.toLowerCase())
        if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error('Conflicting rows for the same milestone must be reconciled before reporting.')
        seen.set(row.id.toLowerCase(), row)
    }
    const milestones = [...seen.values()]
    const tasks = distinct(input.tasks.filter((task) => same(task.ownerId, owner.system_user_id) &&
        byAccount.has(task.accountId.toLowerCase())), (task) => task.id)
    const evidence = distinct(input.evidence.filter((row) => byAccount.has(row.accountId.toLowerCase())), (row) => row.id)
    return { assignments, milestones, tasks, evidence, manager }
}

function kpis(milestones: SeReport['metric_milestones'], engagements: SeReport['engagement_inventory'], hok: SeReport['hok_inventory'],
    period: string, asOf: string, coverage: SeReport['event_date_coverage']): SeReport['dashboard']['kpis'] {
    const dates = seReportingDates(period)
    const unique = distinct(milestones, (row) => row.id)
    const current = unique.filter(active)
    const fiscal = unique.filter((row) => within(row.date, dates.fiscal.start, dates.fiscal.end))
    const union = unique.filter((row) => active(row) || within(row.completedOn, dates.start, dates.end) || within(row.committedOn, dates.start, dates.end))
    const unknownCommitmentDate = !coverage.committed || unique.some((row) => same(row.commitment, 'Committed') && row.committedOn === null)
    const committed = (start: string) => unknownCommitmentDate ? null : unique.filter((row) => within(row.committedOn, start, dates.end)).length
    const uniqueHok = distinct(hok, (row) => row.id)
    return {
        accounts_engaged: distinct(engagements.filter((row) => within(row.date, dates.start, dates.end)), (row) => row.account_id).length,
        active_milestones: { current: current.length, fiscal_year: fiscal.length, as_of_date: asOf },
        milestone_pipeline_influenced: {
            current: unique.some((row) => !active(row) && (same(row.status, 'Completed') && row.completedOn === null ||
                same(row.commitment, 'Committed') && row.committedOn === null)) ? null : totalAcr(union),
            fiscal_year: totalAcr(fiscal), as_of_date: asOf
        },
        committed_milestones: { period: committed(dates.start), fytd: committed(dates.fiscal.start) },
        hok_activities: {
            period: uniqueHok.filter((row) => within(row.date, dates.start, dates.end)).length,
            fytd: uniqueHok.filter((row) => within(row.date, dates.fiscal.start, dates.end)).length
        }
    }
}

function scorecard(kpi: SeReport['dashboard']['kpis'], milestones: SeReport['metric_milestones'], hok: SeReport['hok_inventory'],
    narratives: SeNarrativeBundle, period: string, coverage: SeReport['event_date_coverage']): SeReport['scorecard'] {
    const dates = seReportingDates(period)
    const unique = distinct(milestones, (row) => row.id)
    const population = (rows: typeof unique) => ({
        milestone_count: rows.length, account_count: distinct(rows, (row) => row.accountId).length,
        monthly_acr: totalAcr(rows), as_of_date: kpi.active_milestones.as_of_date,
        status_breakdown: Object.fromEntries([...new Set(rows.map((row) => row.status))].map((status) => [status, rows.filter((row) => row.status === status).length]))
    })
    const created = unique.filter((row) => within(row.createdOn, dates.start, dates.end))
    const missingCreation = !coverage.created || unique.some((row) => row.createdOn === null)
    return {
        ...kpi,
        active_snapshot: population(unique.filter(active)),
        fiscal_inventory: population(unique.filter((row) => within(row.date, dates.fiscal.start, dates.fiscal.end))),
        owned_pipeline: population(unique.filter((row) => active(row) && ['poc/pilot', 'poc', 'pilot', 'production'].includes(row.category.replace(/\s+/g, '').toLowerCase()))),
        new_pipe_generation: { milestone_count: missingCreation ? null : created.length, monthly_acr: missingCreation ? null : totalAcr(created) },
        top_wins: narratives.technical_themes.filter((row) => row.type === 'win').map((row) => row.text),
        top_risks_blockers: narratives.technical_themes.filter((row) => row.type === 'risk').map((row) => row.text),
        hok_categories: Object.values(seHokCategories).map((category) => ({
            category, period: distinct(hok.filter((row) => row.category === category && within(row.date, dates.start, dates.end)), (row) => row.id).length,
            fytd: distinct(hok.filter((row) => row.category === category && within(row.date, dates.fiscal.start, dates.end)), (row) => row.id).length
        }))
    }
}

export function buildSeReports(input: SeReportingInput): SeReport[] {
    const scope = resolveSeScope(input)
    const dates = seReportingDates(input.period)
    const periodTasks = scope.tasks.filter((row) => seTaskActivityDate(row, dates.start, dates.end) !== null)
    const periodEvidence = scope.evidence.filter((row) => row.qualifies && within(row.date, dates.start, dates.end))
    const qualifyingAccounts = new Set([
        ...periodTasks.map((row) => row.accountId.toLowerCase()), ...periodEvidence.map((row) => row.accountId.toLowerCase()),
        ...scope.milestones.filter((row) => within(row.date, dates.fiscal.start, dates.fiscal.end)).map((row) => row.accountId.toLowerCase())
    ])
    const atus = [...new Set(scope.assignments.filter((row) => qualifyingAccounts.has(row.accountId.toLowerCase())).map((row) => row.atu))].sort()
    return atus.map((atu) => {
        const assignments = scope.assignments.filter((row) => row.atu === atu)
        const accounts = new Map(assignments.map((row) => [row.accountId.toLowerCase(), row]))
        const accountContext = (accountId: string) => {
            const assignment = accounts.get(accountId.toLowerCase())
            if (!assignment) throw new Error('Report content references an ineligible account.')
            return { account_id: assignment.accountId, customer: assignment.accountName, atu, ownership: assignment.assignmentType === 'Primary' ? 'Primary' as const : 'Secondary' as const }
        }
        const metricMilestones = scope.milestones.filter((row) => accounts.has(row.accountId.toLowerCase())).map((row) => {
            const { blocker: _rawBlocker, ...facts } = row
            void _rawBlocker
            return { ...facts, atu, customer: accountContext(row.accountId).customer, ownership: accountContext(row.accountId).ownership }
        })
        const inventory = metricMilestones.filter((row) => within(row.date, dates.fiscal.start, dates.fiscal.end))
            .sort((a, b) => a.customer.localeCompare(b.customer) || (b.monthlyAcr ?? -Infinity) - (a.monthlyAcr ?? -Infinity) || a.id.localeCompare(b.id))
        const engagements = [
            ...periodTasks.filter((row) => accounts.has(row.accountId.toLowerCase())).map((row) => ({
                id: row.id, account_id: row.accountId, atu, date: seTaskActivityDate(row, dates.start, dates.end)!
            })),
            ...periodEvidence.filter((row) => accounts.has(row.accountId.toLowerCase())).map((row) => ({ id: row.id, account_id: row.accountId, atu, date: row.date! }))
        ]
        const hok = scope.tasks.filter((row) => row.state === 1 && row.actualEnd && seHokCategories[row.categoryCode] &&
            accounts.has(row.accountId.toLowerCase()) && within(row.actualEnd, dates.fiscal.start, dates.end))
            .map((row) => ({ id: row.id, account_id: row.accountId, atu, date: row.actualEnd!, category: seHokCategories[row.categoryCode]! }))
        const filterItems = (items: readonly { account_id: string }[]) => items.filter((row) => accounts.has(row.account_id.toLowerCase()))
            .map((row) => ({ ...row, ...accountContext(row.account_id) }))
        const narratives = seNarrativeBundleSchema.parse(Object.fromEntries(Object.entries(input.narratives).map(([key, rows]) => [key, filterItems(rows)])))
        const secondaryTasks = periodTasks.filter((task) => accounts.has(task.accountId.toLowerCase()) && accountContext(task.accountId).ownership === 'Secondary')
        const collaboration = distinct(secondaryTasks, (task) => `${task.accountId}:${task.milestoneId}`).map((task) => ({
            atu, account_id: task.accountId, account: accountContext(task.accountId).customer, ownership: 'Secondary' as const,
            milestone_id: task.milestoneId, milestone: task.milestoneName,
            support_description: secondaryTasks.filter((row) => same(row.accountId, task.accountId) && same(row.milestoneId, task.milestoneId)).map((row) => row.subject).join('; '),
            hok_count: hok.filter((row) => within(row.date, dates.start, dates.end) && scope.tasks.some((source) => source.id === row.id && same(source.milestoneId, task.milestoneId))).length
        }))
        for (const assignment of assignments.filter((row) => row.assignmentType === 'Backup')) {
            const evidence = periodEvidence.filter((row) => same(row.accountId, assignment.accountId))
            if (evidence.length && !collaboration.some((row) => same(row.account_id, assignment.accountId))) {
                collaboration.push({ atu, account_id: assignment.accountId, account: assignment.accountName, ownership: 'Secondary',
                    milestone_id: '', milestone: '', support_description: narratives.customer_updates.find((row) => same(row.account_id, assignment.accountId))?.summary ?? 'Source-backed customer activity recorded this period.', hok_count: 0 })
            }
        }
        const kpi = kpis(metricMilestones, engagements, hok, input.period, input.asOf, input.eventDateCoverage)
        const fileStem = `${input.pillar}-${input.owner.alias}`
        return seReportSchema.parse({
            ...narratives, schema_version: '2.0', data_mode: input.mode, artifact_type: 'person_pillar_report',
            report_id: `${atu}-${input.period}-${fileStem}`, manager_profile: input.profileId, run_id: input.runId,
            period: input.period, report_period: { start: dates.start, end: dates.end, label: input.period, status: 'full_month' },
            fiscal_year: dates.fiscal, atu, pillar: input.pillar, included_pillars: [input.pillar],
            atu_scope: { type: 'single_atu', included_atus: [atu] }, owner: input.owner,
            manager: { name: input.contract.manager.name, alias: scope.manager.managerAlias, system_user_id: scope.manager.managerId },
            account_scope: {
                assignment_source: 'AccountAssignmentsWithCustomerIds', manager_system_user_id: scope.manager.managerId,
                manager_alias: scope.manager.managerAlias, eligible_assignment_types: ['Primary', 'Backup'],
                primary_accounts: assignments.filter((row) => row.assignmentType === 'Primary').map((row) => accountContext(row.accountId)),
                secondary_accounts: assignments.filter((row) => row.assignmentType === 'Backup').map((row) => accountContext(row.accountId)),
                excluded_signals_summary: [{ reason: 'no_current_primary_or_backup_assignment_or_invalid_status', count: input.milestones.length - scope.milestones.length }],
                mapping_gaps: input.mappingGaps
            },
            status: 'draft', review: { status: 'draft', approved_by: null, approved_at: null, asks_captured: false },
            schema_contract: {
                source: input.contract.testMode ? 'explicit_test_contract' : 'manager_profile.shared_contract',
                version: input.contract.version, path: input.contract.url, content_hash: input.contract.hash,
                fallback_used: false, test_mode: input.contract.testMode
            },
            source_profile: input.profileId, sources_requested: input.access.filter((row) => row.state !== 'disabled').map((row) => row.source),
            source_references: scope.evidence.filter((row) => accounts.has(row.accountId.toLowerCase())).map((row) => ({ id: row.id, source: row.source, url: row.reference })),
            sources_used: input.access.filter((row) => row.state === 'available').map((row) => row.source),
            sources_unavailable: input.access.filter((row) => row.state === 'unavailable').map((row) => ({ source: row.source, reason: row.detail })),
            source_coverage: input.access,
            generation: { generated_at: input.generatedAt, generator: 'tlc-se-reporting', retained_intermediate_evidence: false },
            companion_files: { json: `${fileStem}.json`, html: `${fileStem}.html` }, source_reports: [],
            executive_summary: {
                headline: `${input.owner.name} · ${input.period} · ${atu}`,
                overall_status: narratives.customer_updates.map((row) => row.summary).slice(0, 3).join(' ') || 'No source-backed customer outcome summary was recorded for this period.',
                running_hot: narratives.customer_updates.filter((row) => row.status === 'running_hot').map((row) => `${row.customer}: ${row.summary}`),
                needs_attention: narratives.customer_updates.filter((row) => row.status === 'with_blocker').map((row) => `${row.customer}: ${row.impact}`),
                next_month_focus: narratives.next_month_priorities.map((row) => row.text)
            },
            scorecard: scorecard(kpi, metricMilestones, hok, narratives, input.period, input.eventDateCoverage),
            event_date_coverage: input.eventDateCoverage,
            dashboard: { kpis: kpi, customer_update_filters: ['All', 'running_hot', 'with_blocker', 'advisory', 'watchlist'] },
            milestone_inventory: inventory, metric_milestones: metricMilestones, engagement_inventory: engagements, hok_inventory: hok,
            cross_collaboration: {
                summary: { account_count: distinct(collaboration, (row) => row.account_id).length, milestone_count: collaboration.filter((row) => row.milestone_id).length, hok_count: collaboration.reduce((sum, row) => sum + (row.hok_count ?? 0), 0) },
                items: collaboration
            },
            asks_for_manager: []
        })
    })
}

export function consolidateSeReports(reports: SeReport[]): SeReport {
    const first = reports[0]
    if (!first) throw new Error('A person summary requires at least one completed ATU report.')
    if (reports.some((report) => report.artifact_type !== 'person_pillar_report' || report.run_id !== first.run_id ||
        report.period !== first.period || !same(report.owner.system_user_id, first.owner.system_user_id) ||
        report.manager.system_user_id !== first.manager.system_user_id || report.schema_contract.content_hash !== first.schema_contract.content_hash)) {
        throw new Error('A person summary must use the same reporter and same run.')
    }
    const { atu: _atu, pillar: _pillar, ...base } = first
    void _atu; void _pillar
    const metricMilestones = reports.flatMap((report) => report.metric_milestones)
    const engagements = reports.flatMap((report) => report.engagement_inventory)
    const hok = reports.flatMap((report) => report.hok_inventory)
    const coverage = {
        committed: reports.every((report) => report.event_date_coverage.committed),
        completed: reports.every((report) => report.event_date_coverage.completed),
        created: reports.every((report) => report.event_date_coverage.created)
    }
    const kpi = kpis(metricMilestones, engagements, hok, first.period, first.dashboard.kpis.active_milestones.as_of_date, coverage)
    const narratives = seNarrativeBundleSchema.parse(Object.fromEntries(seNarrativeBundleSchema.keyof().options.map((key) => [key, reports.map((report) => report[key]).flat()])))
    const collaboration = reports.flatMap((report) => report.cross_collaboration.items)
    const approved = reports.every((report) => report.status !== 'draft')
    return seReportSchema.parse({
        ...base, ...narratives, artifact_type: 'person_monthly_summary',
        report_id: `person-${first.owner.alias}-${first.period}`, atu_scope: { type: 'multi_atu', included_atus: [...new Set(reports.flatMap((row) => row.atu_scope.included_atus))].sort() },
        included_pillars: [...new Set(reports.flatMap((row) => row.included_pillars))],
        account_scope: {
            ...first.account_scope,
            primary_accounts: reports.flatMap((report) => report.account_scope.primary_accounts),
            secondary_accounts: reports.flatMap((report) => report.account_scope.secondary_accounts)
        },
        status: approved ? 'approved' : 'draft',
        review: { ...first.review, status: approved ? 'approved' : 'draft', approved_by: approved ? first.review.approved_by : null, approved_at: approved ? first.review.approved_at : null },
        source_reports: reports.map((report) => `${report.atu}/${report.period}/${report.companion_files.json}`),
        source_references: distinct(reports.flatMap((report) => report.source_references), (row) => row.id),
        asks_for_manager: reports.flatMap((report) => report.asks_for_manager),
        companion_files: { json: 'person-summary.json', html: 'person-summary.html' },
        executive_summary: {
            headline: `${first.owner.name} · ${first.period}`,
            overall_status: reports.map((report) => report.executive_summary.overall_status).join(' '),
            running_hot: reports.flatMap((report) => report.executive_summary.running_hot),
            needs_attention: reports.flatMap((report) => report.executive_summary.needs_attention),
            next_month_focus: reports.flatMap((report) => report.executive_summary.next_month_focus)
        },
        scorecard: scorecard(kpi, metricMilestones, hok, narratives, first.period, coverage),
        event_date_coverage: coverage, dashboard: { ...first.dashboard, kpis: kpi },
        milestone_inventory: distinct(reports.flatMap((report) => report.milestone_inventory), (row) => `${row.atu}:${row.id}`)
            .sort((a, b) => a.atu.localeCompare(b.atu) || a.customer.localeCompare(b.customer) || (b.monthlyAcr ?? -Infinity) - (a.monthlyAcr ?? -Infinity)),
        metric_milestones: metricMilestones, engagement_inventory: engagements, hok_inventory: hok,
        cross_collaboration: {
            summary: { account_count: distinct(collaboration, (row) => row.account_id).length, milestone_count: distinct(collaboration.filter((row) => row.milestone_id), (row) => row.milestone_id).length, hok_count: distinct(hok.filter((row) => within(row.date, first.report_period.start, first.report_period.end) && collaboration.some((item) => same(item.account_id, row.account_id))), (row) => row.id).length },
            items: collaboration
        }
    })
}

export function validateSeNarratives(raw: unknown, input: SeReportingInput): SeNarrativeBundle {
    const narratives = seNarrativeBundleSchema.parse(raw)
    const scope = resolveSeScope(input)
    const accounts = new Map(scope.assignments.map((row) => [row.accountId.toLowerCase(), row]))
    const references = new Map([
        ...scope.milestones.map((row) => [row.id, row.accountId] as const),
        ...scope.tasks.map((row) => [row.id, row.accountId] as const),
        ...scope.evidence.map((row) => [row.id, row.accountId] as const)
    ])
    for (const items of Object.values(narratives)) {
        for (const item of items) {
            const account = accounts.get(item.account_id.toLowerCase())
            if (!account || !item.source_refs.length || item.source_refs.some((reference) => !same(references.get(reference) ?? '', item.account_id))) {
                throw new Error('A narrative contains an ineligible account or unsupported source reference.')
            }
            item.customer = account.accountName
            item.atu = account.atu
            item.ownership = account.assignmentType === 'Primary' ? 'Primary' : 'Secondary'
        }
    }
    for (const item of narratives.priority_initiatives) {
        const amounts = scope.milestones.filter((row) => same(row.accountId, item.account_id)).map((row) => row.monthlyAcr)
        if (item.fy26_acr_year !== null || item.known_amounts.some((value) => !amounts.includes(value))) {
            throw new Error('A narrative contains an unsupported financial amount.')
        }
    }
    return narratives
}
