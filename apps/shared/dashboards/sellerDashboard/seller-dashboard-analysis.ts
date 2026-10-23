import type {
    SellerDashboardMilestone, SellerDashboardOpportunity, SellerDashboardReport
} from '../../../../packages/common/contracts/seller-dashboard.js'

export interface SellerDashboardFilters {
    account: string
    quarter: string
    bucket: string
    metric: string
    state: string
    search: string
}

export const emptySellerDashboardFilters: SellerDashboardFilters = {
    account: '', quarter: 'all', bucket: '', metric: '', state: '', search: ''
}

export function sellerFiscalQuarters(fiscalYear: number) {
    return [
        { value: 'q1', label: `FY${fiscalYear % 100} Q1 · Jul–Sep`, start: `${fiscalYear - 1}-07-01`, end: `${fiscalYear - 1}-09-30` },
        { value: 'q2', label: `FY${fiscalYear % 100} Q2 · Oct–Dec`, start: `${fiscalYear - 1}-10-01`, end: `${fiscalYear - 1}-12-31` },
        { value: 'q3', label: `FY${fiscalYear % 100} Q3 · Jan–Mar`, start: `${fiscalYear}-01-01`, end: `${fiscalYear}-03-31` },
        { value: 'q4', label: `FY${fiscalYear % 100} Q4 · Apr–Jun`, start: `${fiscalYear}-04-01`, end: `${fiscalYear}-06-30` }
    ]
}

export function defaultSellerDashboardFilters(report: SellerDashboardReport): SellerDashboardFilters {
    const quarter = sellerFiscalQuarters(report.plan.fiscalYear).find((row) => row.start <= report.period.today && row.end >= report.period.today)
    return { ...emptySellerDashboardFilters, quarter: quarter?.value ?? 'all' }
}

export function sellerCommitment(value: string): 'committed' | 'uncommitted' | 'unknown' {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'committed') return 'committed'
    if (['uncommitted', 'not committed', 'non-committed', 'non committed'].includes(normalized)) return 'uncommitted'
    return 'unknown'
}

export function sellerStage(opportunity: SellerDashboardOpportunity): number | null {
    const match = /^\s*(?:stage\s*)?([1-5])(?:\D|$)/i.exec(opportunity.stage)
    return match?.[1] ? Number(match[1]) : null
}

export function sellerIsActive(milestone: SellerDashboardMilestone): boolean {
    return milestone.active === true && ['on track', 'at risk', 'blocked'].includes(milestone.status.trim().toLowerCase())
}

export function sellerIsProduction(milestone: SellerDashboardMilestone): boolean {
    return sellerIsActive(milestone) && milestone.category.trim().toLowerCase() === 'production' &&
        milestone.currency.trim().toUpperCase() === 'USD' && milestone.monthly !== null && milestone.monthly > 0
}

export function sellerRecordTiming(value: string | null, today: string, end: string) {
    return value === null ? 'undated' : value < today ? 'overdue' : value > end ? 'future' : 'in-quarter'
}

export function sellerDaysSince(value: string | undefined, today: string): number | null {
    return value ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${value.slice(0, 10)}T00:00:00Z`)) / 86_400_000) : null
}

export function filterSellerDashboard(report: SellerDashboardReport, filters: SellerDashboardFilters) {
    const selectedQuarter = sellerFiscalQuarters(report.plan.fiscalYear).find((row) => row.value === filters.quarter)
    const range = selectedQuarter ?? { start: `${report.plan.fiscalYear - 1}-07-01`, end: `${report.plan.fiscalYear}-06-30` }
    const metrics = report.official.metrics.filter((row) => (!filters.bucket || row.bucket === filters.bucket) && (!filters.metric || row.name === filters.metric))
    const metricNames = new Set(metrics.map((row) => row.name))
    const metricFiltered = Boolean(filters.bucket || filters.metric)
    const search = filters.search.trim().toLocaleLowerCase()
    const matchesSearch = (values: readonly string[]): boolean => !search || values.some((value) => value.toLocaleLowerCase().includes(search))
    const withinQuarter = (value: string | null): boolean => value === null || (value >= range.start && value <= range.end)
    const qualityFor = (account: SellerDashboardReport['accounts'][number]) =>
        report.sources.pipeline.status === 'unavailable' ? 'unavailable' : account.pipeline.status
    let accounts = report.accounts.filter((row) =>
        (!filters.account || row.tpid === filters.account) && row.metrics.some((metric) => metricNames.has(metric.metric)))
    if (['partial', 'unavailable', 'no-pipeline', 'no-quarter'].includes(filters.state)) {
        accounts = accounts.filter((account) => {
            const quality = qualityFor(account)
            if (filters.state === 'partial' || filters.state === 'unavailable') return quality === filters.state
            if (quality !== 'complete') return false
            const opportunities = report.opportunities.filter((row) => row.tpid === account.tpid)
            const milestones = report.milestones.filter((row) => row.tpid === account.tpid)
            if (filters.state === 'no-pipeline') return opportunities.length + milestones.length === 0
            return !opportunities.some((row) => row.state === 'Open' && row.closeDate !== null && withinQuarter(row.closeDate) &&
                row.closeDate >= report.period.today) &&
                !milestones.some((row) => sellerIsProduction(row) && row.date !== null && withinQuarter(row.date) && row.date >= report.period.today)
        })
    }
    const accountIds = new Set(accounts.map((row) => row.tpid))
    let milestones = report.milestones.filter((row) => accountIds.has(row.tpid) && withinQuarter(row.date) &&
        (!metricFiltered || row.metricCandidates.some((metric) => metricNames.has(metric))))
    let opportunities = report.opportunities.filter((row) => accountIds.has(row.tpid) && withinQuarter(row.closeDate))
    if (metricFiltered) {
        const parentIds = new Set(milestones.map((row) => row.opportunityId))
        opportunities = opportunities.filter((row) => parentIds.has(row.id))
    }
    const stateMatches = (value: string | null): boolean => {
        const timing = sellerRecordTiming(value, report.period.today, report.period.end)
        return !['in-quarter', 'overdue', 'future', 'undated'].includes(filters.state) || timing === filters.state
    }
    milestones = milestones.filter((row) => stateMatches(row.date) &&
        (filters.state !== 'committed' || sellerCommitment(row.commitment) === 'committed') &&
        (filters.state !== 'uncommitted' || sellerCommitment(row.commitment) === 'uncommitted') &&
        (filters.state !== 'production' || sellerIsProduction(row)) &&
        matchesSearch([row.account, row.name, row.opportunityName, row.owner, row.workload, row.number, row.status]))
    opportunities = opportunities.filter((row) => stateMatches(row.closeDate) &&
        matchesSearch([row.account, row.name, row.owner, row.number, row.salesPlay, row.intent]))
    if (['committed', 'uncommitted', 'production'].includes(filters.state)) {
        const parentIds = new Set(milestones.map((row) => row.opportunityId))
        opportunities = opportunities.filter((row) => parentIds.has(row.id))
    }
    if (search || ['in-quarter', 'overdue', 'future', 'undated', 'committed', 'uncommitted', 'production'].includes(filters.state)) {
        const recordAccounts = new Set([...opportunities, ...milestones].map((row) => row.tpid))
        accounts = accounts.filter((row) => recordAccounts.has(row.tpid) || (search && matchesSearch([row.name, row.tpid]) && !filters.state))
    }
    return { accounts, opportunities, milestones, metrics, range }
}

export type SellerDashboardView = ReturnType<typeof filterSellerDashboard>

export function sellerAccountGaps(view: Pick<SellerDashboardView, 'accounts' | 'metrics'>) {
    const names = new Set(view.metrics.map((row) => row.name))
    const buckets = Array.from(new Set(view.metrics.map((row) => row.bucket)))
    return buckets.map((bucket) => {
        const rows = view.accounts.flatMap((account) => account.metrics.filter((metric) => metric.bucket === bucket && names.has(metric.metric)))
        const quota = rows.reduce((sum, row) => sum + row.quota, 0)
        const actual = rows.some((row) => row.actual === null) ? null : rows.reduce((sum, row) => sum + (row.actual ?? 0), 0)
        return { bucket, quota, actual, gap: actual === null ? null : Math.max(quota - actual, 0) }
    })
}

export function sellerPipelineSummary(view: Pick<SellerDashboardView, 'opportunities' | 'milestones'>, today: string, periodEnd: string) {
    const open = view.opportunities.filter((row) => row.state === 'Open')
    const monetary = open.filter((row) => row.currency === 'USD' && row.estimatedValue !== null)
    const qualified = monetary.filter((row) => (sellerStage(row) ?? 0) >= 2)
    const early = monetary.filter((row) => sellerStage(row) === 1)
    const active = view.milestones.filter(sellerIsActive)
    const production = active.filter(sellerIsProduction)
    const remaining = production.filter((row) => row.date !== null && row.date >= today && row.date <= periodEnd)
    const sumMonthly = (rows: readonly SellerDashboardMilestone[]): number => rows.reduce((sum, row) => sum + (row.monthly ?? 0), 0)
    const committed = remaining.filter((row) => sellerCommitment(row.commitment) === 'committed' && row.status !== 'Blocked')
    const uncommitted = remaining.filter((row) => sellerCommitment(row.commitment) === 'uncommitted')
    const nominal = qualified.reduce((sum, row) => sum + (row.estimatedValue ?? 0), 0)
    const byAccount = new Map<string, number>()
    for (const row of qualified) byAccount.set(row.tpid, (byAccount.get(row.tpid) ?? 0) + (row.estimatedValue ?? 0))
    return {
        openCount: open.length, qualifiedCount: qualified.length, qualifiedNominal: nominal,
        earlyCount: early.length, earlyNominal: early.reduce((sum, row) => sum + (row.estimatedValue ?? 0), 0),
        committedMonthly: sumMonthly(committed), uncommittedMonthly: sumMonthly(uncommitted),
        unknownCommitmentMonthly: sumMonthly(remaining.filter((row) => sellerCommitment(row.commitment) === 'unknown')),
        overdueCount: active.filter((row) => row.date !== null && row.date < today).length,
        blockedMonthly: sumMonthly(production.filter((row) => row.status === 'Blocked')),
        candidateCount: remaining.length,
        concentration: nominal > 0 ? Math.max(0, ...byAccount.values()) / nominal * 100 : null
    }
}

export function sellerIllustrativeCredit(monthly: number, start: string, end: string): number | null {
    if (!Number.isFinite(monthly) || monthly <= 0 || start > end) return null
    let current = new Date(`${start}T00:00:00Z`)
    const last = Date.parse(`${end}T00:00:00Z`)
    if (!Number.isFinite(current.getTime()) || !Number.isFinite(last)) return null
    let credit = 0
    while (current.getTime() <= last) {
        const monthEnd = Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)
        const days = new Date(monthEnd).getUTCDate()
        const boundary = Math.min(monthEnd, last)
        credit += monthly * ((boundary - current.getTime()) / 86_400_000 + 1) / days
        current = new Date(monthEnd + 86_400_000)
    }
    return credit
}

const scenarioMetrics = new Set(['ACR - Core', 'Databases', 'Fabric + XCR - Power BI Consumed Revenue'])

export function sellerMetricScenario(report: SellerDashboardReport, view: SellerDashboardView, metric: SellerDashboardView['metrics'][number]) {
    const candidates = view.milestones.filter((row) => sellerIsProduction(row) &&
        row.date !== null && row.date >= report.period.today && row.date <= report.period.end &&
        row.date >= view.range.start && row.date <= view.range.end)
    const mapped = candidates.filter((row) => row.metricCandidates.includes(metric.name))
    const uncertain = candidates.some((row) => row.metricCandidates.length === 0) ||
        mapped.some((row) => sellerCommitment(row.commitment) === 'unknown') ||
        report.coverage.some((row) => row.metric === metric.name && row.mappingReviewRequired)
    if (!scenarioMetrics.has(metric.name) || !metric.scenarioAllowed || !metric.mappingSupported ||
        report.sources.pipeline.status !== 'complete' || view.accounts.some((row) => row.pipeline.status !== 'complete') || uncertain) {
        return { committed: null, uncommitted: null, remaining: null, state: 'Unknown / unsupported credit assumptions' }
    }
    let committed = 0
    let uncommitted = 0
    for (const row of mapped) {
        if (row.monthly === null || row.date === null) continue
        const credit = sellerIllustrativeCredit(row.monthly, row.date, report.period.end)
        if (credit === null) continue
        if (sellerCommitment(row.commitment) === 'committed') committed += credit
        else uncommitted += credit
    }
    return { committed, uncommitted, remaining: Math.max(metric.gap - committed - uncommitted, 0), state: 'Illustrative only · not a forecast' }
}

export function sellerMoney(value: number | null | undefined, compact = false, currency = 'USD'): string {
    if (value === null || value === undefined) return 'Unknown'
    return new Intl.NumberFormat('en-US', {
        style: 'currency', currency, ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })
    }).format(value)
}

export function sellerPercent(value: number | null): string {
    return value === null ? 'Unknown' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`
}

export function sellerRatio(numerator: number, denominator: number): number | null {
    return denominator > 0 ? numerator / denominator * 100 : null
}

export function sellerDate(value: string | null | undefined): string {
    return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : 'Unknown date'
}
