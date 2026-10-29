import { z } from 'zod'

export const momentumFocusContractVersion = '1.2' as const
export const momentumRuleVersion = 'momentum-rules-1' as const
const id = z.string().min(1).max(200)
const label = z.string().min(1).max(500)
const date = z.iso.date()
const timestamp = z.iso.datetime({ offset: true })
const count = z.number().int().nonnegative()
const currency = z.string().regex(/^[A-Z]{3}$/)
const ids = z.array(id).max(500).default([])
export const momentumBasisSchema = z.enum(['pipeline', 'monthly-usage'])
export const momentumCustomerIndustrySchema = z.enum(['hls', 'all'])
export const momentumQualitySchema = z.enum(['complete', 'partial', 'unknown'])
export const momentumDeadlineSchema = z.enum(['overdue', 'this-week', 'rest-of-month', 'later', 'undated'])
export const momentumProgressKinds = ['stage-advanced', 'milestone-completed', 'commitment-recorded', 'proof-completed'] as const
export const momentumEventSchema = z.object({
    id,
    kind: z.enum([...momentumProgressKinds, 'activity', 'note', 'task', 'forecast-comment', 'loopback', 'date-slipped']),
    source: z.enum(['msx', 'observed']),
    sourceAt: timestamp.nullable(),
    observedAt: timestamp,
    intervalStart: timestamp.nullable(),
    intervalEnd: timestamp.nullable(),
    field: z.string().max(100).nullable(),
    relatedRecordKey: id.optional(),
    from: z.string().max(500).nullable(),
    to: z.string().max(500).nullable()
}).strict()
export const momentumHistorySchema = z.object({
    state: z.enum(['insufficient', 'observed', 'authoritative', 'unavailable']),
    scope: z.enum(['shared', 'synthetic', 'unavailable']),
    availableSince: timestamp.nullable(),
    lastObserved: timestamp.nullable(),
    observations: count,
    maxGapDays: z.number().nonnegative().nullable()
}).strict()
export const momentumRecordSchema = z.object({
    key: id, id,
    entity: z.enum(['opportunity', 'milestone']),
    name: label,
    accountId: id.nullable(),
    accountName: label.nullable(),
    opportunityId: id,
    stage: label.nullable(),
    status: label.nullable(),
    ownerId: id.nullable(),
    ownerName: label.nullable(),
    dueDate: date.nullable(),
    value: z.object({ basis: momentumBasisSchema, amount: z.number().finite().nonnegative().nullable(), currency: currency.nullable() }).strict(),
    active: z.boolean().nullable(),
    onMyTeam: z.boolean().nullable(),
    role: z.enum(['SSP', 'SE', 'both']),
    commitment: z.boolean().nullable(),
    blocked: z.boolean().nullable(),
    blockingMilestoneIds: z.array(id).max(20_000),
    plannedHold: z.boolean(),
    sourceQuality: momentumQualitySchema,
    sourceUpdatedAt: timestamp.nullable(),
    sourceUrl: z.url().refine((value) => {
        const url = new URL(value)
        return url.protocol === 'https:' && !url.username && !url.password
    }, 'Evidence links must use HTTPS without credentials.').nullable(),
    history: momentumHistorySchema,
    // At most 1,000 source references plus 96 retained private observations.
    events: z.array(momentumEventSchema).max(1_096)
}).strict()

export const momentumFocusQuerySchema = z.object({
    timezone: z.string().max(100).refine((value) => {
        try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch (error) {
            if (error instanceof RangeError) return false
            throw error
        }
    }, 'Use a valid IANA timezone.').default('UTC'),
    focus: z.enum(['week', 'month', 'custom']).default('week'),
    from: date.optional(), to: date.optional(),
    lookbackDays: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(90)]).default(30),
    role: z.enum(['SSP', 'SE']).default('SSP'),
    scope: z.enum(['portfolio', 'mine', 'team']).default('portfolio'),
    customerIndustry: momentumCustomerIndustrySchema.default('hls'),
    accountIds: ids, opportunityIds: ids, milestoneIds: ids,
    stages: ids, opportunityStatuses: ids, milestoneStatuses: ids, ownerIds: ids,
    entity: z.enum(['all', 'opportunity', 'milestone']).default('all'),
    sourceQuality: z.array(momentumQualitySchema).max(3).default([]),
    basis: z.enum(['all', 'pipeline', 'monthly-usage']).default('all'),
    currency: currency.optional(),
    minValue: z.number().finite().nonnegative().optional(), maxValue: z.number().finite().nonnegative().optional(),
    dateFrom: date.optional(), dateTo: date.optional(),
    includeUndated: z.boolean().default(true),
    lens: z.enum(['all', 'advancing', 'review', 'busy', 'weekly', 'monthly', 'history', 'unknown-history']).default('all'),
    deadline: momentumDeadlineSchema.optional(),
    accountSort: z.enum(['traction', 'activity', 'review']).default('traction'),
    heatmap: z.enum(['count', 'value']).default('count'),
    page: z.number().int().min(1).max(10_000).default(1),
    pageSize: z.number().int().min(1).max(100).default(25)
}).strict().superRefine((query, context) => {
    if (query.focus === 'custom' && (!query.from || !query.to || query.from > query.to)) {
        context.addIssue({ code: 'custom', message: 'A custom focus needs an ordered start and end date.' })
    }
    if (query.minValue !== undefined && query.maxValue !== undefined && query.minValue > query.maxValue ||
        query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
        context.addIssue({ code: 'custom', message: 'Filter ranges must be ordered.' })
    }
    if (query.heatmap === 'value' && (query.basis !== 'monthly-usage' || !query.currency)) {
        context.addIssue({ code: 'custom', message: 'Monetary heatmaps require monthly usage and one verified currency.' })
    }
    if ((query.minValue !== undefined || query.maxValue !== undefined) && (query.basis === 'all' || !query.currency)) {
        context.addIssue({ code: 'custom', message: 'Value ranges require one financial basis and a verified currency.' })
    }
})

export const momentumFocusRequestSchema = z.object({
    contractVersion: z.literal(momentumFocusContractVersion),
    operation: z.enum(['load', 'get', 'refresh', 'detail']),
    query: momentumFocusQuerySchema.prefault({}),
    refresh: z.boolean().optional(),
    recordKey: id.optional(),
    snapshotId: id.optional()
}).strict().superRefine((request, context) => {
    if (request.operation === 'detail' && (!request.recordKey || !request.snapshotId)) {
        context.addIssue({ code: 'custom', message: 'Detail reads require a record key and snapshot identity.' })
    }
    if (request.operation !== 'detail' && (request.recordKey || request.snapshotId)) {
        context.addIssue({ code: 'custom', message: 'Record and snapshot identities are only valid for detail reads.' })
    }
    if (request.operation !== 'load' && request.refresh !== undefined) {
        context.addIssue({ code: 'custom', message: 'The dataset refresh flag is only valid for load requests.' })
    }
})

export const momentumSourceHealthSchema = z.object({
    source: z.enum(['portfolio', 'milestones', 'activities', 'notes', 'currencies', 'hierarchy', 'industry', 'history', 'm365']),
    state: z.enum(['complete', 'partial', 'unavailable', 'denied', 'capped']),
    detail: z.string().min(1).max(2_000),
    count: count.nullable(),
    checkedAt: timestamp
}).strict()

export const momentumCollectionSchema = z.object({
    mode: z.enum(['sample', 'live']),
    generatedAt: timestamp,
    scopeKey: id,
    scope: z.enum(['portfolio', 'mine', 'team']),
    customerIndustry: momentumCustomerIndustrySchema,
    teamAvailable: z.boolean(),
    complete: z.boolean(),
    records: z.array(momentumRecordSchema).max(30_000),
    sources: z.array(momentumSourceHealthSchema).max(12)
}).strict()
export const momentumDatasetSchema = z.object({
    contractVersion: z.literal(momentumFocusContractVersion),
    kind: z.literal('dataset'),
    ruleVersion: z.literal(momentumRuleVersion),
    snapshotId: id,
    asOf: timestamp,
    data: momentumCollectionSchema
}).strict()
export const momentumPrioritySchema = momentumRecordSchema.extend({
    tier: z.enum(['act-now', 'this-week', 'plan-month', 'verify']),
    deadline: momentumDeadlineSchema,
    reviewDate: date.nullable(),
    progressCount: count.nullable(),
    historyCoverage: z.enum(['sufficient', 'partial', 'unknown']),
    signalCount: count.nullable(),
    signalTypes: z.array(z.string().max(100)).max(12),
    latestSignal: timestamp.nullable(),
    latestProgress: timestamp.nullable(),
    reasons: z.array(z.object({ code: id, text: z.string().min(1).max(1_000) }).strict()).max(20),
    nextAction: z.string().min(1).max(1_000),
    accountableRole: label,
    needsReview: z.boolean()
}).strict()
const window = z.object({ from: z.string().min(1), to: z.string().min(1) }).strict()
export const momentumSnapshotSchema = z.object({
    contractVersion: z.literal(momentumFocusContractVersion),
    kind: z.literal('snapshot'),
    ruleVersion: z.literal(momentumRuleVersion),
    mode: z.enum(['sample', 'live']),
    generatedAt: timestamp,
    snapshotId: id, queryKey: id, scopeKey: id,
    query: momentumFocusQuerySchema,
    scope: z.enum(['portfolio', 'mine', 'team']),
    customerIndustry: momentumCustomerIndustrySchema,
    teamAvailable: z.boolean(),
    complete: z.boolean(),
    focusWindow: window, evidenceWindow: window,
    sources: z.array(momentumSourceHealthSchema).max(12),
    total: count,
    rows: z.array(momentumPrioritySchema).max(100),
    summary: z.object({
        advancingAccounts: count, weeklyPriorities: count, monthlyMilestones: count,
        reviewCandidates: count, busyWithoutMovement: count, usableHistory: count, totalRecords: count
    }).strict(),
    facets: z.object({
        accounts: z.array(z.object({ id, name: label }).strict()),
        opportunities: z.array(z.object({ id, name: label }).strict()),
        milestones: z.array(z.object({ id, name: label }).strict()),
        owners: z.array(z.object({ id, name: label }).strict()),
        stages: z.array(label), opportunityStatuses: z.array(label), milestoneStatuses: z.array(label), currencies: z.array(currency)
    }).strict(),
    charts: z.object({
        matrix: z.array(z.object({
            key: id, id, entity: z.enum(['opportunity', 'milestone']), name: label,
            progressCount: count, signalCount: count.nullable(),
            coverage: z.enum(['sufficient', 'partial', 'unknown']),
            amount: z.number().finite().nullable(), basis: momentumBasisSchema, currency: currency.nullable()
        }).strict()),
        unknownHistoryKeys: z.array(id),
        accounts: z.array(z.object({
            accountId: id.nullable(), name: label, advancing: count, eligible: count, active: count,
            advancingShare: z.number().min(0).max(1).nullable(), progressCount: count, signalCount: count,
            reviewCount: count, latestMovement: timestamp.nullable()
        }).strict()),
        heatmap: z.array(z.object({
            stage: label, status: label, count, value: z.number().finite().nonnegative().nullable(), unit: label, missingValues: count
        }).strict()),
        deadlines: z.array(z.object({ bucket: momentumDeadlineSchema, opportunities: count, milestones: count }).strict()).length(5),
        values: z.array(z.object({ basis: momentumBasisSchema, currency, amount: z.number().finite().nonnegative(), records: count }).strict()),
        unknownValues: count
    }).strict()
}).strict()
export const momentumFocusResponseSchema = z.discriminatedUnion('kind', [
    momentumDatasetSchema,
    momentumSnapshotSchema,
    z.object({
        contractVersion: z.literal(momentumFocusContractVersion), kind: z.literal('detail'),
        snapshotId: id, queryKey: id, scopeKey: id, item: momentumPrioritySchema
    }).strict(),
    z.object({
        contractVersion: z.literal(momentumFocusContractVersion), kind: z.literal('unavailable'),
        code: z.enum(['unauthorized', 'forbidden', 'source-unavailable', 'throttled', 'scope-unavailable', 'industry-unavailable', 'stale', 'history-unavailable']),
        message: z.string().min(1).max(2_000)
    }).strict()
])

export type MomentumEvent = z.infer<typeof momentumEventSchema>
export type MomentumHistory = z.infer<typeof momentumHistorySchema>
export type MomentumRecord = z.infer<typeof momentumRecordSchema>
export type MomentumCollection = z.infer<typeof momentumCollectionSchema>
export type MomentumDataset = z.infer<typeof momentumDatasetSchema>
export type MomentumFocusQuery = z.infer<typeof momentumFocusQuerySchema>
export type MomentumFocusRequest = z.infer<typeof momentumFocusRequestSchema>
export type MomentumFocusResponse = z.infer<typeof momentumFocusResponseSchema>
export type MomentumSnapshot = z.infer<typeof momentumSnapshotSchema>
export type MomentumPriority = z.infer<typeof momentumPrioritySchema>
export type MomentumSourceHealth = z.infer<typeof momentumSourceHealthSchema>
