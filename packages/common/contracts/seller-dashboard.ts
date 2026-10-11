import { z } from 'zod'

export const sellerDashboardContractVersion = '1.0' as const

const text = z.string().max(30_000)
const name = z.string().min(1).max(500)
const identifier = z.string().min(1).max(200)
const tpid = z.string().regex(/^[1-9][0-9]{0,19}$/)
const amount = z.number().finite()
const nonnegative = amount.nonnegative()
const count = z.number().int().nonnegative()
const date = z.iso.date()
const timestamp = z.iso.datetime({ offset: true })
const quality = z.enum(['complete', 'partial', 'unavailable'])
const timing = z.enum(['overdue', 'in-quarter', 'future', 'undated'])

const bucketSchema = z.object({
    name, weight: amount.min(0).max(1), unit: z.literal('USD'),
    attainment: amount, actual: amount, quota: amount, recurring: amount,
    calcActual: amount, calcQuota: nonnegative, gap: nonnegative
}).strict()

const metricSchema = z.object({
    name, bucket: name, unit: z.literal('USD'),
    mappingSupported: z.boolean(), scenarioAllowed: z.boolean(),
    attainment: amount, actual: amount, quota: amount, recurring: amount,
    calcActual: amount, calcQuota: amount, gap: nonnegative,
    closedGap: nonnegative, closedAttainment: amount.nullable(),
    accountActualDifference: amount, accountQuotaDifference: amount
}).strict()

const accountMetricSchema = z.object({
    metric: name, bucket: name, quota: nonnegative, actual: amount.nullable(),
    variance: amount.nullable(), gap: nonnegative.nullable()
}).strict()

const accountSchema = z.object({
    tpid, name, metrics: z.array(accountMetricSchema).max(100),
    pipeline: z.object({
        status: quality, openCount: count, inQuarterCount: count,
        inQuarterValue: amount, productionCount: count, inQuarterProductionCount: count,
        committedMonthly: amount, uncommittedMonthly: amount,
        noPipeline: z.boolean(), noInQuarterPipeline: z.boolean()
    }).strict(),
    nextAction: text
}).strict()

const opportunitySchema = z.object({
    id: identifier, number: text, tpid, account: name, name,
    owner: text, stage: text, solutionArea: text, salesPlay: text, intent: text,
    estimatedValue: amount.nullable(), currency: text, monthlyRunRate: amount.nullable(),
    closeDate: date.nullable(), state: text, forecastComments: text,
    timing, relevance: text, modifiedAt: timestamp.optional(),
    estimatedBilledRevenue: amount.nullable().optional(),
    estimatedSqlRevenue: amount.nullable().optional()
}).strict()

const milestoneSchema = z.object({
    id: identifier, number: text, opportunityId: identifier, opportunityName: name,
    tpid, account: name, name, owner: text, category: text, status: text,
    commitment: text, monthly: amount.nullable(), date: date.nullable(),
    workload: text, forecastComments: text, currency: text, active: z.boolean().nullable(),
    timing, metricCandidates: z.array(name).max(100), mappingBasis: text,
    classification: text, scenarioCredit: amount.nullable(),
    modifiedAt: timestamp.optional(), commitmentChangedAt: timestamp.optional(),
    region: text.optional(), riskDetails: text.optional()
}).strict()

const coverageSchema = z.object({
    metric: name, bucket: name, gap: nonnegative, candidateCount: count,
    committedMonthly: amount, uncommittedMonthly: amount,
    verifiedPeriodCredit: z.null(), state: text,
    mappingSupported: z.boolean(), mappingReviewRequired: z.boolean(),
    scenarioAllowed: z.boolean(), scenarioCommittedCredit: amount.nullable(),
    scenarioUncommittedCredit: amount.nullable(), scenarioRemainingGap: amount.nullable(),
    nextAction: text
}).strict()

export const sellerDashboardReportSchema = z.object({
    schemaVersion: z.literal(1), generatedAt: timestamp,
    plan: z.object({
        currency: z.literal('USD'), unit: z.literal('USD'),
        fiscalYear: z.number().int().min(2000).max(2200),
        sourceUnitsVerified: z.boolean(),
        metricMapping: z.array(z.object({
            metric: name, bucket: name, hintSupported: z.boolean(),
            state: text, scenarioAllowed: z.boolean()
        }).strict()).max(100),
        unmappedProductionCandidates: count
    }).strict(),
    period: z.object({ label: name, start: date, end: date, today: date }).strict(),
    sources: z.object({
        earnings: z.object({
            status: z.enum(['live', 'stale']), generatedAt: timestamp,
            refreshedAt: timestamp.nullable(), months: z.array(name).max(12),
            ageDays: z.number().int().nullable()
        }).strict(),
        pipeline: z.object({
            status: quality, asOf: timestamp.nullable(), errors: z.array(text).max(1000)
        }).strict(),
        quota: z.object({ name, rows: count, accounts: count.max(200) }).strict()
    }).strict(),
    warnings: z.array(text).max(1000),
    official: z.object({
        weightedAttainment: amount, closedMonthAttainment: amount.nullable(),
        closedThrough: name.nullable(),
        buckets: z.array(bucketSchema).min(1).max(100),
        metrics: z.array(metricSchema).min(1).max(100)
    }).strict(),
    accounts: z.array(accountSchema).min(1).max(200),
    opportunities: z.array(opportunitySchema).max(50_000),
    milestones: z.array(milestoneSchema).max(50_000),
    coverage: z.array(coverageSchema).max(100),
    actions: z.array(z.object({
        account: name, tpid, metric: name,
        priority: z.enum(['High', 'Medium', 'Low']), issue: text, action: text, owner: text
    }).strict()).max(20_000),
    methodology: z.array(text).max(100)
}).strict().superRefine((report, context) => {
    const reject = (message: string): void => context.addIssue({ code: 'custom', message })
    const unique = (values: readonly string[], label: string): void => {
        if (new Set(values).size !== values.length) reject(`Duplicate ${label}.`)
    }
    const close = (left: number, right: number): boolean => Math.abs(left - right) <= 0.01
    const { buckets, metrics } = report.official
    unique(buckets.map((row) => row.name), 'bucket')
    unique(metrics.map((row) => row.name), 'metric')
    unique(report.accounts.map((row) => row.tpid), 'account')
    unique(report.opportunities.map((row) => row.id), 'opportunity')
    unique(report.milestones.map((row) => row.id), 'milestone')
    unique(report.coverage.map((row) => row.metric), 'coverage metric')
    if (Math.abs(buckets.reduce((sum, row) => sum + row.weight, 0) - 1) > 0.000001) {
        reject('Official bucket weights must sum to one.')
    }
    if (report.period.start > report.period.end) reject('Invalid official reporting interval.')
    if (report.period.today < report.period.start ||
        Date.parse(report.period.today) > Date.parse(report.period.end) + 31 * 86_400_000) {
        reject('As-of date is outside the supported official reporting interval.')
    }
    if (report.period.start < `${report.plan.fiscalYear - 1}-07-01` ||
        report.period.end > `${report.plan.fiscalYear}-06-30`) reject('Reporting interval is outside the fiscal year.')
    for (const row of [...buckets, ...metrics]) {
        if (!close(row.gap, Math.max(row.calcQuota - row.calcActual, 0))) {
            reject('Posted gap does not reconcile to signed calculated amounts.')
        }
    }
    const metricMap = new Map(metrics.map((row) => [row.name, row]))
    const bucketNames = new Set(buckets.map((row) => row.name))
    if (metrics.some((row) => !bucketNames.has(row.bucket))) reject('Unknown metric bucket.')
    if (report.plan.metricMapping.length !== metrics.length ||
        report.plan.metricMapping.some((row) => metricMap.get(row.metric)?.bucket !== row.bucket)) {
        reject('Plan metric mapping does not reconcile.')
    }
    unique(report.plan.metricMapping.map((row) => row.metric), 'plan mapping')
    const accountMap = new Map(report.accounts.map((row) => [row.tpid, row]))
    const opportunityMap = new Map(report.opportunities.map((row) => [row.id, row]))
    if (report.sources.quota.accounts !== report.accounts.length) reject('Quota account count does not reconcile.')
    for (const account of report.accounts) {
        unique(account.metrics.map((row) => row.metric), 'account metric')
        for (const row of account.metrics) {
            if (metricMap.get(row.metric)?.bucket !== row.bucket) reject('Unknown account metric mapping.')
            if (row.actual === null) {
                if (row.gap !== null || row.variance !== null) reject('Missing actuals cannot establish an account gap.')
            } else if (row.gap === null || row.variance === null ||
                !close(row.gap, Math.max(row.quota - row.actual, 0)) ||
                !close(row.variance, row.actual - row.quota)) reject('Account amounts do not reconcile.')
        }
        if (account.pipeline.status !== 'complete' &&
            (account.pipeline.noPipeline || account.pipeline.noInQuarterPipeline)) {
            reject('Incomplete retrieval cannot establish absent pipeline.')
        }
        if (report.sources.pipeline.status === 'unavailable' && account.pipeline.status !== 'unavailable') {
            reject('Unavailable global retrieval cannot establish complete account data.')
        }
    }
    for (const row of [...report.opportunities, ...report.milestones]) {
        if (accountMap.get(row.tpid)?.name !== row.account) reject('Pipeline is outside the quota roster.')
        const value = 'date' in row ? row.date : row.closeDate
        const expectedTiming = value === null ? 'undated' : value < report.period.today ? 'overdue'
            : value > report.period.end ? 'future' : 'in-quarter'
        if (row.timing !== expectedTiming) reject('Pipeline timing does not match source dates.')
    }
    for (const row of report.milestones) {
        const parent = opportunityMap.get(row.opportunityId)
        if (!parent || parent.tpid !== row.tpid) reject('Milestone parent attribution is invalid.')
        if (row.metricCandidates.some((metric) => !metricMap.has(metric))) reject('Unknown candidate metric.')
        if (parent?.state === 'Lost' && row.active === true) reject('A lost parent cannot supply active consumption.')
        if (row.active === null && accountMap.get(row.tpid)?.pipeline.status === 'complete') {
            reject('Unknown milestone activity requires incomplete source quality.')
        }
    }
    for (const row of report.coverage) {
        const metric = metricMap.get(row.metric)
        if (!metric || metric.bucket !== row.bucket || !close(row.gap, metric.gap)) reject('Coverage does not reconcile to the official metric.')
    }
    for (const row of report.actions) {
        if (!accountMap.has(row.tpid) || !metricMap.has(row.metric)) reject('Action is outside the reporting scope.')
    }
})

const supplementSourceSchema = z.object({
    name, status: quality, asOf: timestamp, start: date, end: date, detail: text
}).strict().refine((source) => source.start <= source.end, 'Invalid supplemental source interval.')

export const sellerDashboardSupplementSchema = z.object({
    schemaVersion: z.literal(1),
    consumption: z.object({
        source: supplementSourceSchema,
        accounts: z.array(z.object({
            tpid, actual: nonnegative, previousActual: nonnegative.nullable(),
            averageDaily: nonnegative, projected: nonnegative.nullable(), daysPosted: count,
            pillars: z.array(z.object({ name, actual: nonnegative }).strict()).max(100)
        }).strict()).max(200),
        services: z.array(z.object({
            id: identifier, tpid, name, pillar: name,
            previousDaily: nonnegative, currentDaily: nonnegative, isNew: z.boolean()
        }).strict()).max(50_000),
        subscriptions: z.array(z.object({
            id: identifier, tpid, name, created: date, averageDaily: nonnegative
        }).strict()).max(50_000),
        sqlReclassification: z.array(z.object({
            id: identifier, tpid, workload: name,
            monthlyOpportunity: nonnegative, evidence: text
        }).strict()).max(50_000)
    }).strict().nullable(),
    conversion: z.object({
        source: supplementSourceSchema,
        accounts: z.array(z.object({
            tpid, territory: text,
            startingMonthly: nonnegative, convertedMonthly: nonnegative,
            inQuarterMonthly: nonnegative, shiftedOutMonthly: nonnegative,
            startingCount: count, convertedCount: count
        }).strict()).max(200)
    }).strict().nullable()
}).strict().superRefine((supplement, context) => {
    const reject = (message: string): void => context.addIssue({ code: 'custom', message })
    const consumption = supplement.consumption
    if (consumption) {
        if (new Set(consumption.accounts.map((row) => row.tpid)).size !== consumption.accounts.length) {
            reject('Duplicate consumption account.')
        }
        for (const row of consumption.accounts) {
            if (row.daysPosted > 31 || (row.daysPosted === 0 && row.actual !== 0)) reject('Invalid posted consumption days.')
            if (Math.abs(row.pillars.reduce((sum, pillar) => sum + pillar.actual, 0) - row.actual) > 0.01) {
                reject('Pillar consumption does not reconcile to the account.')
            }
        }
    }
    const conversion = supplement.conversion
    if (conversion) {
        if (new Set(conversion.accounts.map((row) => row.tpid)).size !== conversion.accounts.length) {
            reject('Duplicate conversion account.')
        }
        for (const row of conversion.accounts) {
            if (row.convertedCount > row.startingCount || row.convertedMonthly > row.startingMonthly ||
                Math.abs(row.inQuarterMonthly + row.shiftedOutMonthly - row.convertedMonthly) > 0.01) {
                reject('Conversion does not reconcile to the historical baseline.')
            }
        }
    }
})

export const sellerDashboardSnapshotSchema = z.object({
    contractVersion: z.literal(sellerDashboardContractVersion), kind: z.literal('snapshot'),
    mode: z.enum(['sample', 'live']), state: z.enum(['ready', 'stale']), message: text,
    report: sellerDashboardReportSchema, supplement: sellerDashboardSupplementSchema.nullable()
}).strict().superRefine((snapshot, context) => {
    const tpids = new Set(snapshot.report.accounts.map((row) => row.tpid))
    const consumption = snapshot.supplement?.consumption
    const rows = [
        ...consumption?.accounts ?? [], ...consumption?.services ?? [],
        ...consumption?.subscriptions ?? [], ...consumption?.sqlReclassification ?? [],
        ...snapshot.supplement?.conversion?.accounts ?? []
    ]
    if (rows.some((row) => !tpids.has(row.tpid))) {
        context.addIssue({ code: 'custom', message: 'Supplemental data is outside the quota roster.' })
    }
    for (const source of [consumption, snapshot.supplement?.conversion]) {
        if (source?.source.status === 'complete' && source.accounts.length !== tpids.size) {
            context.addIssue({ code: 'custom', message: 'A complete supplemental source must cover the quota account roster.' })
        }
    }
})

export const sellerDashboardUnavailableSchema = z.object({
    contractVersion: z.literal(sellerDashboardContractVersion), kind: z.literal('unavailable'),
    mode: z.literal('live'),
    code: z.enum(['not-configured', 'unsupported-platform', 'identity-mismatch', 'invalid-snapshot', 'runtime-failed', 'hosted-profile-denied']),
    message: name
}).strict()

export const sellerDashboardResponseSchema = z.discriminatedUnion('kind', [
    sellerDashboardSnapshotSchema, sellerDashboardUnavailableSchema
])

export const sellerDashboardRequestSchema = z.discriminatedUnion('operation', [
    z.object({
        contractVersion: z.literal(sellerDashboardContractVersion), operation: z.literal('get')
    }).strict(),
    z.object({
        contractVersion: z.literal(sellerDashboardContractVersion), operation: z.literal('refresh'),
        confirmed: z.literal(true), asOf: date.optional()
    }).strict()
])

export type SellerDashboardReport = z.infer<typeof sellerDashboardReportSchema>
export type SellerDashboardSupplement = z.infer<typeof sellerDashboardSupplementSchema>
export type SellerDashboardSnapshot = z.infer<typeof sellerDashboardSnapshotSchema>
export type SellerDashboardResponse = z.infer<typeof sellerDashboardResponseSchema>
export type SellerDashboardRequest = z.infer<typeof sellerDashboardRequestSchema>
export type SellerDashboardOpportunity = SellerDashboardReport['opportunities'][number]
export type SellerDashboardMilestone = SellerDashboardReport['milestones'][number]
