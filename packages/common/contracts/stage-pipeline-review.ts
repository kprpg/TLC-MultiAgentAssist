import { z } from 'zod'

export const stagePipelineReviewContractVersion = '1.1' as const

const identifier = z.string().min(1).max(200)
const name = z.string().min(1).max(500)
const text = z.string().max(30_000)
const amount = z.number().finite()
const nonnegative = amount.nonnegative()
const count = z.number().int().nonnegative()
const date = z.iso.date()
const timestamp = z.iso.datetime({ offset: true })
const month = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/)

export const stagePipelineStages = [
    'Listen & Consult', 'Inspire & Design', 'Empower & Achieve', 'Realize Value', 'Manage & Optimize'
] as const
export const stagePipelineMilestoneStatuses = [
    'On Track', 'At Risk', 'Blocked', 'Completed', 'Cancelled', 'Hygiene/Duplicate', 'Lost to Competitor'
] as const

export const stagePipelineStageSchema = z.enum(stagePipelineStages)
export const stagePipelineMilestoneStatusSchema = z.enum(stagePipelineMilestoneStatuses)
export const stagePipelineScopeSchema = z.enum(['azure', 'microsoft-services'])
export const stagePipelineThreatSchema = z.enum(['None', 'Low', 'Medium', 'High'])
export const stagePipelineViewScopes = ['mine', 'reports', 'both'] as const
export const stagePipelineViewScopeSchema = z.enum(stagePipelineViewScopes)
export const stagePipelineSourceNames = ['opportunities', 'milestones', 'macc', 'acr', 'hierarchy'] as const
export const stagePipelineAcrSources = ['sample', 'mint', 'semantic-model', 'derived-pipeline-only', 'unavailable'] as const

export const stagePipelineOpportunitySchema = z.object({
    id: identifier,
    number: name,
    customer: name,
    name,
    owner: z.string().max(200),
    editable: z.boolean(),
    notes: text,
    contact: text,
    scope: stagePipelineScopeSchema,
    solutionArea: name,
    inbound: z.boolean(),
    stage: stagePipelineStageSchema,
    status: z.enum(['In Progress', 'On Hold', 'Won', 'Lost']),
    forecast: name,
    closeDate: date,
    daysInStage: count,
    idleDays: count.nullable(),
    consumedRecurring: nonnegative,
    consumedNonRecurring: nonnegative,
    maccCommit: nonnegative,
    partner: text.nullable(),
    competitor: z.object({ name: text.nullable(), threat: stagePipelineThreatSchema }).strict(),
    solutionTagReview: z.boolean()
}).strict()

export const stagePipelineMilestoneSchema = z.object({
    id: identifier,
    number: name,
    opportunityId: identifier,
    name,
    workload: text,
    estimatedMonthlyAcr: nonnegative,
    commitment: z.enum(['Committed', 'Uncommitted']),
    status: stagePipelineMilestoneStatusSchema,
    date: date.nullable(),
    comment: text,
    owner: text
}).strict()

const acrMonthSchema = z.object({
    month,
    actual: nonnegative.nullable(),
    baseline: nonnegative.nullable(),
    committed: nonnegative,
    uncommitted: nonnegative,
    stage1: nonnegative,
    target: nonnegative.nullable()
}).strict()

export const stagePipelineAcrSchema = z.object({
    source: z.enum(stagePipelineAcrSources),
    syncedAt: date.nullable(),
    lastActualMonth: month.nullable(),
    accounts: z.array(z.object({
        customer: name,
        months: z.array(acrMonthSchema).length(12)
    }).strict()).max(500)
}).strict().superRefine((acr, context) => {
    const connected = acr.source === 'sample' || acr.source === 'mint' || acr.source === 'semantic-model'
    const measured = acr.accounts.flatMap((account) => account.months).flatMap((row) => [row.actual, row.baseline, row.target])
    const consistent = connected
        ? acr.syncedAt !== null && acr.lastActualMonth !== null && measured.every((value) => value !== null)
        : acr.syncedAt === null && acr.lastActualMonth === null && measured.every((value) => value === null)
    if (!consistent) {
        context.addIssue({ code: 'custom', message: connected
            ? 'A connected ACR source must provide actuals, baseline, target and sync dates.'
            : 'An unconnected ACR source must not report actuals, baseline, target or sync dates.' })
    }
})

export const stagePipelineSourceHealthSchema = z.object({
    source: z.enum(stagePipelineSourceNames),
    state: z.enum(['complete', 'partial', 'unavailable']),
    detail: text,
    count: count.optional()
}).strict()

export const stagePipelineReportSchema = z.object({ id: identifier, displayName: name }).strict()

export const stagePipelineSnapshotSchema = z.object({
    contractVersion: z.literal(stagePipelineReviewContractVersion),
    kind: z.literal('snapshot'),
    mode: z.enum(['sample', 'live']),
    state: z.enum(['fresh', 'stale']),
    message: text,
    generatedAt: timestamp,
    owner: z.string().max(200),
    asOf: date,
    fiscalYear: z.number().int().min(2000).max(2100),
    scope: stagePipelineViewScopeSchema,
    reports: z.array(stagePipelineReportSchema).max(50),
    sources: z.array(stagePipelineSourceHealthSchema).max(10),
    opportunities: z.array(stagePipelineOpportunitySchema).max(5_000),
    milestones: z.array(stagePipelineMilestoneSchema).max(25_000),
    acr: stagePipelineAcrSchema
}).strict().superRefine((value, context) => {
    if (value.scope === 'mine' && value.reports.length > 0) context.addIssue({ code: 'custom', path: ['reports'], message: 'The seller portfolio scope has no direct reports.' })
    if (new Set(value.reports.map((row) => row.id)).size !== value.reports.length) context.addIssue({ code: 'custom', path: ['reports'], message: 'Report ids must be unique.' })
    if (new Set(value.sources.map((row) => row.source)).size !== value.sources.length) context.addIssue({ code: 'custom', path: ['sources'], message: 'Each source may be reported once.' })
    const ids = new Set<string>()
    for (const [index, row] of value.opportunities.entries()) {
        if (ids.has(row.id)) context.addIssue({ code: 'custom', path: ['opportunities', index, 'id'], message: 'Opportunity ids must be unique.' })
        ids.add(row.id)
    }
    const milestoneIds = new Set<string>()
    for (const [index, row] of value.milestones.entries()) {
        if (milestoneIds.has(row.id)) context.addIssue({ code: 'custom', path: ['milestones', index, 'id'], message: 'Milestone ids must be unique.' })
        milestoneIds.add(row.id)
        if (!ids.has(row.opportunityId)) context.addIssue({ code: 'custom', path: ['milestones', index, 'opportunityId'], message: 'Milestone must reference a listed opportunity.' })
    }
})

export const stagePipelineUnavailableSchema = z.object({
    contractVersion: z.literal(stagePipelineReviewContractVersion),
    kind: z.literal('unavailable'),
    code: z.enum(['source-unavailable', 'unauthorized', 'forbidden', 'throttled', 'invalid-snapshot']),
    message: text
}).strict()

export const stagePipelineRequestSchema = z.object({
    contractVersion: z.literal(stagePipelineReviewContractVersion),
    operation: z.enum(['get', 'refresh']),
    scope: stagePipelineViewScopeSchema.default('mine'),
    reportIds: z.array(identifier).max(50).optional()
}).strict().superRefine((value, context) => {
    if (value.reportIds && value.scope === 'mine') {
        context.addIssue({ code: 'custom', path: ['reportIds'], message: 'Direct reports can only be selected for a reports scope.' })
    }
})

export const stagePipelineResponseSchema = z.union([stagePipelineSnapshotSchema, stagePipelineUnavailableSchema])

export type StagePipelineStage = z.infer<typeof stagePipelineStageSchema>
export type StagePipelineMilestoneStatus = z.infer<typeof stagePipelineMilestoneStatusSchema>
export type StagePipelineScope = z.infer<typeof stagePipelineScopeSchema>
export type StagePipelineOpportunity = z.infer<typeof stagePipelineOpportunitySchema>
export type StagePipelineMilestone = z.infer<typeof stagePipelineMilestoneSchema>
export type StagePipelineAcr = z.infer<typeof stagePipelineAcrSchema>
export type StagePipelineSnapshot = z.infer<typeof stagePipelineSnapshotSchema>
export type StagePipelineViewScope = z.infer<typeof stagePipelineViewScopeSchema>
export type StagePipelineSourceHealth = z.infer<typeof stagePipelineSourceHealthSchema>
export type StagePipelineRequest = z.infer<typeof stagePipelineRequestSchema>
export type StagePipelineRequestInput = z.input<typeof stagePipelineRequestSchema>
export type StagePipelineResponse = z.infer<typeof stagePipelineResponseSchema>
