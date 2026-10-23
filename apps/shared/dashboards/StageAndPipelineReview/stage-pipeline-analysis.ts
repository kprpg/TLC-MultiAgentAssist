import {
    stagePipelineMilestoneStatuses, stagePipelineStages,
    type StagePipelineAcr, type StagePipelineMilestone, type StagePipelineMilestoneStatus,
    type StagePipelineOpportunity, type StagePipelineSnapshot, type StagePipelineStage
} from '../../../../packages/common/contracts/stage-pipeline-review.js'

export type ReviewScope = 'azure' | 'microsoft-services' | 'all'
export type ReviewSource = 'all' | 'inbound' | 'exclude-inbound'
export type ReviewAlert = 'overdue' | 'closing90' | 'at-risk-commit' | 'non-azure' | 'competitive'
export type ReviewTab = 'opportunities' | 'actions' | 'consumption' | 'macc' | 'milestones'

export interface ReviewFilters {
    scope: ReviewScope
    source: ReviewSource
    search: string
    customer: string
    status: string
    forecast: string
    stages: readonly StagePipelineStage[]
    solution: string
    quarter: string
    partner: string
    alert: ReviewAlert | ''
    focusOnly: boolean
    hideReviewed: boolean
}

export interface MilestoneFilters {
    statuses: readonly StagePipelineMilestoneStatus[]
    commitment: string
    owner: string
    openOnly: boolean
    overdueOnly: boolean
}

export interface ReviewMarks {
    focus: ReadonlySet<string>
    reviewed: ReadonlySet<string>
}

export interface OpportunityView {
    row: StagePipelineOpportunity
    consumed: number
    open: boolean
    daysToClose: number
    overdueDays: number
    quarter: string
    alerts: ReadonlySet<ReviewAlert>
}

export const reviewAlerts: ReadonlyArray<{ key: ReviewAlert; label: string; hint: string }> = [
    { key: 'overdue', label: 'Overdue close', hint: 're-date or close' },
    { key: 'closing90', label: 'Closing ≤90d', hint: 'drive to close' },
    { key: 'at-risk-commit', label: 'At-risk commit', hint: 'protect forecast' },
    { key: 'non-azure', label: 'Non-Azure consumption', hint: 'check solution area tag' },
    { key: 'competitive', label: 'Competitive threat', hint: 'High / medium · compete plan' }
]

export const scopeSolution: Record<ReviewScope, string> = {
    azure: 'Cloud and AI Platforms',
    'microsoft-services': 'Microsoft Services',
    all: ''
}

export const emptyMilestoneFilters: MilestoneFilters = { statuses: [], commitment: '', owner: '', openOnly: false, overdueOnly: false }

export function defaultReviewFilters(): ReviewFilters {
    return {
        scope: 'azure', source: 'exclude-inbound', search: '', customer: '', status: '', forecast: '',
        stages: [], solution: scopeSolution.azure, quarter: '', partner: '', alert: '', focusOnly: false, hideReviewed: false
    }
}

export function withScope(filters: ReviewFilters, scope: ReviewScope): ReviewFilters {
    return { ...filters, scope, solution: scopeSolution[scope] }
}

export function dayNumber(value: string): number {
    return Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000)
}

export function fiscalQuarterOf(value: string): string {
    const year = Number(value.slice(0, 4))
    const monthNumber = Number(value.slice(5, 7))
    const fiscalYear = monthNumber >= 7 ? year + 1 : year
    const quarter = Math.floor(((monthNumber + 5) % 12) / 3) + 1
    return `FY${String(fiscalYear % 100).padStart(2, '0')} Q${quarter}`
}

export function isOpenMilestone(status: StagePipelineMilestoneStatus): boolean {
    return status === 'On Track' || status === 'At Risk' || status === 'Blocked'
}

export function isMilestonePastDue(row: StagePipelineMilestone, asOf: string): boolean {
    return isOpenMilestone(row.status) && row.date !== null && row.date < asOf
}

export function consumedTotal(row: StagePipelineOpportunity): number {
    return row.consumedRecurring + row.consumedNonRecurring
}

export function deriveOpportunities(snapshot: StagePipelineSnapshot): OpportunityView[] {
    const today = dayNumber(snapshot.asOf)
    const atRisk = new Set(snapshot.milestones
        .filter((milestone) => milestone.status === 'At Risk' || milestone.status === 'Blocked')
        .map((milestone) => milestone.opportunityId))
    return snapshot.opportunities.map((row) => {
        const open = row.status === 'In Progress' || row.status === 'On Hold'
        const daysToClose = dayNumber(row.closeDate) - today
        const overdueDays = open && daysToClose < 0 ? -daysToClose : 0
        const alerts = new Set<ReviewAlert>()
        if (overdueDays > 0) alerts.add('overdue')
        if (open && daysToClose >= 0 && daysToClose <= 90) alerts.add('closing90')
        if (open && row.forecast === 'Committed' && (overdueDays > 0 || atRisk.has(row.id))) alerts.add('at-risk-commit')
        if (open && row.solutionTagReview) alerts.add('non-azure')
        if (open && (row.competitor.threat === 'High' || row.competitor.threat === 'Medium')) alerts.add('competitive')
        return { row, consumed: consumedTotal(row), open, daysToClose, overdueDays, quarter: fiscalQuarterOf(row.closeDate), alerts }
    })
}

export function matchesScope(view: OpportunityView, filters: Pick<ReviewFilters, 'scope' | 'source'>): boolean {
    if (filters.scope !== 'all' && view.row.scope !== filters.scope) return false
    if (filters.source === 'inbound') return view.row.inbound
    if (filters.source === 'exclude-inbound') return !view.row.inbound
    return true
}

type IgnorableFilter = 'stages' | 'alert'

export function filterOpportunityViews(
    views: readonly OpportunityView[], filters: ReviewFilters, marks: ReviewMarks, ignore: readonly IgnorableFilter[] = []
): OpportunityView[] {
    const query = filters.search.trim().toLowerCase()
    return views.filter((view) => {
        const { row } = view
        if (!matchesScope(view, filters)) return false
        if (filters.customer && row.customer !== filters.customer) return false
        if (filters.status && row.status !== filters.status) return false
        if (filters.forecast && row.forecast !== filters.forecast) return false
        if (filters.solution && row.solutionArea !== filters.solution) return false
        if (filters.quarter && view.quarter !== filters.quarter) return false
        if (filters.partner && row.partner !== filters.partner) return false
        if (!ignore.includes('stages') && filters.stages.length > 0 && !filters.stages.includes(row.stage)) return false
        if (!ignore.includes('alert') && filters.alert && !view.alerts.has(filters.alert)) return false
        if (filters.focusOnly && !marks.focus.has(row.id)) return false
        if (filters.hideReviewed && marks.reviewed.has(row.id)) return false
        if (query) {
            const haystack = [row.name, row.customer, row.contact, row.partner ?? '', row.notes, row.number].join('\n').toLowerCase()
            if (!haystack.includes(query)) return false
        }
        return true
    })
}

export function stageCounts(views: readonly OpportunityView[], filters: ReviewFilters, marks: ReviewMarks): Record<StagePipelineStage, number> {
    const counts = Object.fromEntries(stagePipelineStages.map((stage) => [stage, 0])) as Record<StagePipelineStage, number>
    for (const view of filterOpportunityViews(views, filters, marks, ['stages'])) counts[view.row.stage] += 1
    return counts
}

export function inboundCount(views: readonly OpportunityView[], scope: ReviewScope): number {
    return views.filter((view) => (scope === 'all' || view.row.scope === scope) && view.row.inbound).length
}

export function sumConsumed(views: readonly OpportunityView[]): number {
    return views.reduce((sum, view) => sum + view.consumed, 0)
}

export function alertSummary(views: readonly OpportunityView[]): Record<ReviewAlert, { count: number; consumed: number }> {
    const summary = Object.fromEntries(reviewAlerts.map((alert) => [alert.key, { count: 0, consumed: 0 }])) as Record<ReviewAlert, { count: number; consumed: number }>
    for (const view of views) {
        for (const alert of view.alerts) {
            summary[alert].count += 1
            summary[alert].consumed += view.consumed
        }
    }
    return summary
}

export function opportunityKpis(views: readonly OpportunityView[]) {
    return {
        recurring: views.reduce((sum, view) => sum + view.row.consumedRecurring, 0),
        nonRecurring: views.reduce((sum, view) => sum + view.row.consumedNonRecurring, 0),
        opportunities: views.length,
        consuming: views.filter((view) => view.consumed > 0).length,
        overdue: views.filter((view) => view.alerts.has('overdue')).length,
        macc: views.reduce((sum, view) => sum + view.row.maccCommit, 0)
    }
}

export interface ReviewAction {
    id: string
    opportunityId: string
    priority: 'High' | 'Medium' | 'Low'
    title: string
    reason: string
    due: string
}

const priorityOrder = { High: 0, Medium: 1, Low: 2 } as const

export function deriveActions(views: readonly OpportunityView[]): ReviewAction[] {
    const actions: ReviewAction[] = []
    for (const view of views) {
        const { row } = view
        const push = (key: string, priority: ReviewAction['priority'], title: string, reason: string) =>
            actions.push({ id: `${row.id}:${key}`, opportunityId: row.id, priority, title, reason, due: row.closeDate })
        if (view.alerts.has('overdue')) push('overdue', 'High', 'Re-date or close', `Close date passed ${view.overdueDays} days ago.`)
        if (view.alerts.has('at-risk-commit')) push('commit', 'High', 'Protect the committed forecast', 'Committed forecast with an overdue close or at-risk milestone.')
        if (view.open && row.competitor.threat === 'High') push('compete', 'High', 'Build a compete plan', `High competitive threat${row.competitor.name ? ` from ${row.competitor.name}` : ''}.`)
        else if (view.open && row.competitor.threat === 'Medium') push('compete', 'Medium', 'Build a compete plan', `Medium competitive threat${row.competitor.name ? ` from ${row.competitor.name}` : ''}.`)
        if (view.alerts.has('non-azure')) push('tag', 'Medium', 'Check the solution area tag', 'Consumption is recorded against a non-Azure solution area tag.')
        if (view.alerts.has('closing90')) push('close', 'Medium', 'Drive to close', `Closes in ${view.daysToClose} days.`)
        if (view.open && row.idleDays !== null && row.idleDays >= 60 && view.consumed > 0) push('idle', 'Low', 'Re-engage idle consumption', `No consumption movement for ${row.idleDays} days.`)
    }
    return actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
}

export function filterMilestoneRows(rows: readonly StagePipelineMilestone[], filters: MilestoneFilters, asOf: string): StagePipelineMilestone[] {
    return rows.filter((row) => {
        if (filters.statuses.length > 0 && !filters.statuses.includes(row.status)) return false
        if (filters.commitment && row.commitment !== filters.commitment) return false
        if (filters.owner && row.owner !== filters.owner) return false
        if (filters.openOnly && !isOpenMilestone(row.status)) return false
        if (filters.overdueOnly && !isMilestonePastDue(row, asOf)) return false
        return true
    })
}

export function milestonesForOpportunities(snapshot: StagePipelineSnapshot, opportunityIds: ReadonlySet<string>): StagePipelineMilestone[] {
    return snapshot.milestones.filter((row) => opportunityIds.has(row.opportunityId))
}

export function milestoneKpis(rows: readonly StagePipelineMilestone[], asOf: string) {
    const open = rows.filter((row) => isOpenMilestone(row.status))
    return {
        shown: rows.length,
        openAcr: open.reduce((sum, row) => sum + row.estimatedMonthlyAcr, 0),
        committed: open.filter((row) => row.commitment === 'Committed').length,
        uncommitted: open.filter((row) => row.commitment === 'Uncommitted').length,
        atRisk: rows.filter((row) => row.status === 'At Risk' || row.status === 'Blocked').length,
        pastDue: rows.filter((row) => isMilestonePastDue(row, asOf)).length,
        opportunities: new Set(rows.map((row) => row.opportunityId)).size
    }
}

export function milestoneStatusCounts(rows: readonly StagePipelineMilestone[]): Record<StagePipelineMilestoneStatus, number> {
    const counts = Object.fromEntries(stagePipelineMilestoneStatuses.map((status) => [status, 0])) as Record<StagePipelineMilestoneStatus, number>
    for (const row of rows) counts[row.status] += 1
    return counts
}

export interface AcrPoint {
    month: string
    label: string
    actual: number
    baseline: number
    committed: number
    uncommitted: number
    stage1: number
    target: number
    total: number
    lastActual: boolean
}

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function acrSeries(acr: StagePipelineAcr, customer: string): { points: AcrPoint[]; accounts: number } {
    const accounts = acr.accounts.filter((account) => !customer || account.customer === customer)
    const first = acr.accounts[0]
    const points = (first?.months ?? []).map((month, index) => {
        const sum = (key: 'actual' | 'baseline' | 'committed' | 'uncommitted' | 'stage1' | 'target') =>
            accounts.reduce((total, account) => total + (account.months[index]?.[key] ?? 0), 0)
        const year = Number(month.month.slice(0, 4))
        const monthNumber = Number(month.month.slice(5, 7))
        const values = {
            actual: sum('actual'), baseline: sum('baseline'), committed: sum('committed'),
            uncommitted: sum('uncommitted'), stage1: sum('stage1'), target: sum('target')
        }
        return {
            month: month.month,
            label: `FY${String((monthNumber >= 7 ? year + 1 : year) % 100).padStart(2, '0')}-${monthNames[monthNumber - 1] ?? ''}`,
            ...values,
            total: values.actual + values.baseline + values.committed + values.uncommitted + values.stage1,
            lastActual: month.month === acr.lastActualMonth
        }
    })
    return { points, accounts: accounts.length }
}

export function acrCoverage(points: readonly AcrPoint[]) {
    const last = points.at(-1)
    if (!last || last.target <= 0) return null
    const base = last.actual + last.baseline
    const withCommitted = base + last.committed
    const withUncommitted = withCommitted + last.uncommitted
    const all = withUncommitted + last.stage1
    return {
        target: last.target, base, withCommitted, withUncommitted, all,
        basePct: Math.round((base / last.target) * 100),
        committedPct: Math.round((withCommitted / last.target) * 100),
        uncommittedPct: Math.round((withUncommitted / last.target) * 100),
        allPct: Math.round((all / last.target) * 100),
        ahead: all - last.target
    }
}

export function formatMoney(value: number): string {
    const sign = value < 0 ? '-' : ''
    const abs = Math.abs(value)
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
    if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}K`
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
}

export function formatDollars(value: number): string {
    return `${value < 0 ? '-' : ''}$${Math.round(Math.abs(value)).toLocaleString('en-US')}`
}

export function csvCell(value: string | number | null): string {
    if (value === null) return ''
    const raw = typeof value === 'number' ? String(value) : /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
    return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
    return [headers, ...rows].map((line) => line.map(csvCell).join(',')).join('\r\n')
}

export function opportunityCsv(views: readonly OpportunityView[]): string {
    return toCsv(
        ['Customer', 'Opportunity', 'Number', 'Stage', 'Forecast', 'Close', 'Days to close', 'Consumed', 'Idle days', 'Partner', 'Competitor', 'Threat'],
        views.map(({ row, consumed, daysToClose }) => [row.customer, row.name, row.number, row.stage, row.forecast, row.closeDate, daysToClose, consumed, row.idleDays, row.partner, row.competitor.name, row.competitor.threat])
    )
}

export function milestoneCsv(rows: readonly StagePipelineMilestone[], opportunities: ReadonlyMap<string, StagePipelineOpportunity>): string {
    return toCsv(
        ['Account', 'Opportunity', 'Opportunity number', 'Milestone', 'Milestone number', 'Est. ACR / mo', 'Commitment', 'Status', 'Milestone date', 'Comment', 'Owner'],
        rows.map((row) => {
            const parent = opportunities.get(row.opportunityId)
            return [parent?.customer ?? '', parent?.name ?? '', parent?.number ?? '', row.name, row.number, row.estimatedMonthlyAcr, row.commitment, row.status, row.date, row.comment, row.owner]
        })
    )
}

export function msxRecordUrl(entity: 'opportunity' | 'msp_engagementmilestone', id: string): string {
    const url = new URL('https://microsoftsales.crm.dynamics.com/main.aspx')
    url.searchParams.set('pagetype', 'entityrecord')
    url.searchParams.set('etn', entity)
    url.searchParams.set('id', id)
    return url.toString()
}

export function distinctSorted(values: Iterable<string | null>): string[] {
    return [...new Set([...values].filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b))
}

export function activeFilterChips(filters: ReviewFilters): Array<{ key: string; label: string; value: string }> {
    const chips: Array<{ key: string; label: string; value: string }> = []
    if (filters.solution) chips.push({ key: 'solution', label: 'Solution', value: filters.solution })
    for (const stage of filters.stages) chips.push({ key: `stage:${stage}`, label: 'Stage', value: stage })
    if (filters.source === 'exclude-inbound') chips.push({ key: 'source', label: 'Opportunity', value: 'Excluding Inbound' })
    if (filters.source === 'inbound') chips.push({ key: 'source', label: 'Opportunity', value: 'Inbound only' })
    if (filters.customer) chips.push({ key: 'customer', label: 'Customer', value: filters.customer })
    if (filters.status) chips.push({ key: 'status', label: 'Status', value: filters.status })
    if (filters.forecast) chips.push({ key: 'forecast', label: 'Forecast', value: filters.forecast })
    if (filters.quarter) chips.push({ key: 'quarter', label: 'Quarter', value: filters.quarter })
    if (filters.partner) chips.push({ key: 'partner', label: 'Partner', value: filters.partner })
    if (filters.alert) chips.push({ key: 'alert', label: 'Alert', value: reviewAlerts.find((alert) => alert.key === filters.alert)?.label ?? filters.alert })
    if (filters.search.trim()) chips.push({ key: 'search', label: 'Search', value: filters.search.trim() })
    return chips
}

export function clearFilterChip(filters: ReviewFilters, key: string): ReviewFilters {
    if (key.startsWith('stage:')) return { ...filters, stages: filters.stages.filter((stage) => stage !== key.slice(6)) }
    switch (key) {
        case 'solution': return { ...filters, solution: '' }
        case 'source': return { ...filters, source: 'all' }
        case 'customer': return { ...filters, customer: '' }
        case 'status': return { ...filters, status: '' }
        case 'forecast': return { ...filters, forecast: '' }
        case 'quarter': return { ...filters, quarter: '' }
        case 'partner': return { ...filters, partner: '' }
        case 'alert': return { ...filters, alert: '' }
        case 'search': return { ...filters, search: '' }
        default: return filters
    }
}
