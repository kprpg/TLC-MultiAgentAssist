import { z } from 'zod'

export const seReportingContractVersion = '1.0' as const
const text = z.string().max(4000)
const id = z.string().trim().min(1).max(200)
const referenceId = z.string().min(1).max(1200)
const count = z.number().int().nonnegative().nullable()
const amount = z.number().finite().nullable()
export const seReportDateSchema = z.iso.date()
export const seReportPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine((value) => Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) < 9999)
export const seReportingSourceSchema = z.enum(['m365_calendar', 'm365_email', 'm365_teams', 'm365_files', 'wiki'])
export const seReportingResourceSchema = z.enum(['graph', 'graph-write', 'powerbi'])
export type SeReportingResource = z.infer<typeof seReportingResourceSchema>
export const seReportingScopes: Record<SeReportingResource, string[]> = {
    graph: ['https://graph.microsoft.com/.default'],
    'graph-write': ['https://graph.microsoft.com/.default'],
    powerbi: ['https://analysis.windows.net/powerbi/api/.default']
}
export const seSharePointUrlSchema = z.url().refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith('.sharepoint.com') &&
        !url.username && !url.password && !url.hash && (!url.port || url.port === '443')
}, 'Use an HTTPS SharePoint URL without credentials or a fragment.')
export const seReportingProfileSchema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    label: z.string().trim().min(1).max(120),
    contractUrl: seSharePointUrlSchema,
    outputRootUrl: seSharePointUrlSchema,
    semanticModelId: z.uuid(),
    sources: z.array(seReportingSourceSchema).max(5),
    wikiUrl: seSharePointUrlSchema.optional(),
    workloadMap: z.record(z.string().min(1).max(200), id).optional()
}).strict().superRefine((profile, context) => {
    if (new Set(profile.sources).size !== profile.sources.length) context.addIssue({ code: 'custom', message: 'Duplicate sources are not allowed.' })
    if (profile.sources.includes('wiki') && !profile.wikiUrl) context.addIssue({ code: 'custom', message: 'Wiki requires an explicit SharePoint location.' })
})
export type SeReportingProfile = z.infer<typeof seReportingProfileSchema>
export type SeReportingSource = z.infer<typeof seReportingSourceSchema>

export const seReporterSchema = z.object({ name: id, alias: id, email: z.email(), system_user_id: id }).strict()
export const seManagerSchema = z.object({ name: id, alias: text, system_user_id: text }).strict()
export const seAssignmentSchema = z.object({
    managerId: id, managerAlias: id, managerName: id, reporterId: id, accountId: id,
    accountName: id, atu: id, workload: id, assignmentType: z.enum(['Primary', 'Backup'])
}).strict()
export const seMilestoneSchema = z.object({
    id, reporterId: id, accountId: id, opportunityId: id, name: id, category: text,
    status: text, commitment: text, monthlyAcr: amount,
    date: seReportDateSchema.nullable(), committedOn: seReportDateSchema.nullable(),
    completedOn: seReportDateSchema.nullable(), createdOn: seReportDateSchema.nullable(),
    blocker: text
}).strict()
export const seTaskSchema = z.object({
    id, ownerId: id, milestoneId: id, milestoneName: text, accountId: id, subject: text, categoryCode: z.string(),
    state: z.number().int(), actualEnd: seReportDateSchema.nullable(), activityDate: seReportDateSchema.nullable()
}).strict()
export const seEvidenceSchema = z.object({
    id: referenceId, accountId: id, source: seReportingSourceSchema, date: seReportDateSchema.nullable(),
    summary: z.string().max(100000), reference: z.url().refine((value) => new URL(value).protocol === 'https:'),
    qualifies: z.boolean()
}).strict()
export const seAccessSchema = z.object({
    source: z.enum(['contract', 'assignments', 'msx', ...seReportingSourceSchema.options]),
    state: z.enum(['available', 'unavailable', 'disabled']),
    detail: z.string().max(1000)
}).strict()
export const seLiveContractSchema = z.object({
    version: z.literal('2.0'), manager: seManagerSchema,
    allowedAtus: z.array(id).min(1).max(100), allowedPillars: z.array(id).min(1).max(30),
    url: z.string().max(2000), hash: id, testMode: z.boolean()
}).strict()

const sourceRefs = z.array(referenceId).max(100)
const ownership = z.enum(['Primary', 'Secondary'])
const accountContext = z.object({ account_id: id, customer: id, atu: id, ownership }).strict()
export const seNarrativeItemSchema = accountContext.extend({
    title: text, text, source_refs: sourceRefs
}).strict()
export const seCustomerUpdateSchema = accountContext.extend({
    status: z.enum(['running_hot', 'with_blocker', 'advisory', 'watchlist']),
    summary: text, impact: text,
    msx: z.array(z.object({ label: text, text }).strict()).max(30),
    m365: z.array(z.object({ label: text, text }).strict()).max(30),
    next_actions: z.array(text).max(30), source_refs: sourceRefs,
    confidence: z.enum(['high', 'medium', 'low'])
}).strict()
export const seInitiativeSchema = accountContext.extend({
    sales_territory_name: text, big_bet_opportunity: text, customer_need_business_outcome: text,
    plan: text, fy26_acr_year: amount, obstacles_help_needed: text, confidence_level: z.enum(['high', 'medium', 'low']),
    next_steps: z.array(text).max(30), known_amounts: z.array(z.number().finite()).max(30), source_refs: sourceRefs
}).strict()
export const seNarrativeBundleSchema = z.object({
    customer_updates: z.array(seCustomerUpdateSchema).max(500),
    priority_initiatives: z.array(seInitiativeSchema).max(200),
    account_notes: z.array(seNarrativeItemSchema).max(500),
    partners: z.array(seNarrativeItemSchema.extend({ partner: text, engagement_strategy: text, solution_play: text }).strict()).max(200),
    technical_themes: z.array(seNarrativeItemSchema.extend({ type: z.enum(['win', 'loss', 'learning', 'pattern', 'risk']) }).strict()).max(200),
    cross_pillar_dependencies: z.array(seNarrativeItemSchema.extend({ pillar: id }).strict()).max(200),
    next_month_priorities: z.array(seNarrativeItemSchema.extend({ expected_outcome: text }).strict()).max(200),
    leadership_decisions: z.array(seNarrativeItemSchema).max(200),
    scrum_rollup_bullets: z.array(seNarrativeItemSchema).max(200),
    follow_up_required: z.array(seNarrativeItemSchema).max(200)
}).strict()
export type SeNarrativeBundle = z.infer<typeof seNarrativeBundleSchema>
export const seNarrativeSynthesisSchema = seNarrativeBundleSchema.extend({ qualifying_evidence_ids: z.array(referenceId).max(10000) }).strict()
export const seKpisSchema = z.object({
    accounts_engaged: count,
    active_milestones: z.object({ current: count, fiscal_year: count, as_of_date: seReportDateSchema }).strict(),
    milestone_pipeline_influenced: z.object({ current: amount, fiscal_year: amount, as_of_date: seReportDateSchema }).strict(),
    committed_milestones: z.object({ period: count, fytd: count }).strict(),
    hok_activities: z.object({ period: count, fytd: count }).strict()
}).strict()
const population = z.object({
    milestone_count: count, account_count: count, monthly_acr: amount,
    status_breakdown: z.record(z.string(), z.number().int().nonnegative()), as_of_date: seReportDateSchema
}).strict()
const eventCoverage = z.object({ committed: z.boolean(), completed: z.boolean(), created: z.boolean() }).strict()
const scorecard = seKpisSchema.extend({
    active_snapshot: population, fiscal_inventory: population,
    owned_pipeline: population,
    new_pipe_generation: z.object({ milestone_count: count, monthly_acr: amount }).strict(),
    top_wins: z.array(text), top_risks_blockers: z.array(text),
    hok_categories: z.array(z.object({ category: id, period: count, fytd: count }).strict())
}).strict()
export const seReportSchema = seNarrativeBundleSchema.extend({
    schema_version: z.literal('2.0'),
    data_mode: z.enum(['sample', 'live']),
    artifact_type: z.enum(['person_pillar_report', 'person_monthly_summary']),
    report_id: id, manager_profile: id, run_id: id, period: seReportPeriodSchema,
    report_period: z.object({ start: seReportDateSchema, end: seReportDateSchema, label: id, status: z.literal('full_month') }).strict(),
    fiscal_year: z.object({ year: z.number().int(), start: seReportDateSchema, end: seReportDateSchema }).strict(),
    atu: id.optional(), pillar: id.optional(), included_pillars: z.array(id),
    atu_scope: z.object({ type: z.enum(['single_atu', 'multi_atu']), included_atus: z.array(id) }).strict(),
    owner: seReporterSchema, manager: seManagerSchema,
    account_scope: z.object({
        assignment_source: z.literal('AccountAssignmentsWithCustomerIds'),
        manager_system_user_id: id, manager_alias: text,
        eligible_assignment_types: z.tuple([z.literal('Primary'), z.literal('Backup')]),
        primary_accounts: z.array(accountContext), secondary_accounts: z.array(accountContext),
        excluded_signals_summary: z.array(z.object({ reason: id, count: z.number().int().nonnegative() }).strict()),
        mapping_gaps: z.array(text)
    }).strict(),
    status: z.enum(['draft', 'approved', 'final']),
    review: z.object({
        status: z.enum(['draft', 'approved', 'final']), approved_by: z.string().nullable(),
        approved_at: z.iso.datetime().nullable(), asks_captured: z.boolean()
    }).strict(),
    schema_contract: z.object({
        source: z.enum(['manager_profile.shared_contract', 'explicit_test_contract']),
        version: z.literal('2.0'), path: text, content_hash: id, fallback_used: z.literal(false), test_mode: z.boolean()
    }).strict(),
    source_profile: id, sources_requested: z.array(id), sources_used: z.array(id),
    source_references: z.array(z.object({ id: referenceId, source: id, url: z.url().refine((value) => new URL(value).protocol === 'https:') }).strict()).max(10000),
    sources_unavailable: z.array(z.object({ source: id, reason: text }).strict()),
    source_coverage: z.array(seAccessSchema),
    generation: z.object({ generated_at: z.iso.datetime(), generator: z.literal('tlc-se-reporting'), retained_intermediate_evidence: z.literal(false) }).strict(),
    companion_files: z.object({ json: id, html: id }).strict(),
    source_reports: z.array(id),
    executive_summary: z.object({
        headline: text, overall_status: text, running_hot: z.array(text),
        needs_attention: z.array(text), next_month_focus: z.array(text)
    }).strict(),
    scorecard,
    event_date_coverage: eventCoverage,
    dashboard: z.object({
        kpis: seKpisSchema,
        customer_update_filters: z.tuple([z.literal('All'), z.literal('running_hot'), z.literal('with_blocker'), z.literal('advisory'), z.literal('watchlist')])
    }).strict(),
    milestone_inventory: z.array(seMilestoneSchema.omit({ blocker: true }).extend({ atu: id, customer: id, ownership }).strict()).max(10000),
    metric_milestones: z.array(seMilestoneSchema.omit({ blocker: true }).extend({ atu: id, customer: id, ownership }).strict()).max(10000),
    engagement_inventory: z.array(z.object({ id: referenceId, account_id: id, atu: id, date: seReportDateSchema }).strict()).max(10000),
    hok_inventory: z.array(z.object({ id, account_id: id, atu: id, date: seReportDateSchema, category: id }).strict()).max(10000),
    cross_collaboration: z.object({
        summary: z.object({ account_count: count, milestone_count: count, hok_count: count }).strict(),
        items: z.array(z.object({
            atu: id, account_id: id, account: id, ownership: z.literal('Secondary'),
            milestone_id: text, milestone: text, support_description: text, hok_count: count
        }).strict())
    }).strict(),
    asks_for_manager: z.array(z.object({ ask: text, why_it_matters: text, customer: text, urgency: text, source_refs: sourceRefs }).strict()).max(50)
}).strict().superRefine((report, context) => {
    if (seKpisSchema.keyof().options.some((key) => JSON.stringify(report.scorecard[key]) !== JSON.stringify(report.dashboard.kpis[key]))) context.addIssue({ code: 'custom', message: 'Dashboard KPIs must match the canonical scorecard.' })
    if (report.status !== report.review.status) context.addIssue({ code: 'custom', message: 'Review status must match report status.' })
    if (report.schema_contract.test_mode && report.status !== 'draft') context.addIssue({ code: 'custom', message: 'Test reports remain drafts.' })
    if (report.artifact_type === 'person_pillar_report' && (!report.atu || !report.pillar || report.atu_scope.type !== 'single_atu')) context.addIssue({ code: 'custom', message: 'An ATU report requires one ATU and pillar.' })
    if (report.artifact_type === 'person_monthly_summary' && (report.atu || report.pillar || !report.source_reports.length || report.atu_scope.type !== 'multi_atu')) context.addIssue({ code: 'custom', message: 'A person summary requires source reports and no single ATU or pillar.' })
})
export type SeReport = z.infer<typeof seReportSchema>
export type SeAccess = z.infer<typeof seAccessSchema>
export type SeLiveContract = z.infer<typeof seLiveContractSchema>
export type SeAssignment = z.infer<typeof seAssignmentSchema>
export type SeMilestone = z.infer<typeof seMilestoneSchema>
export type SeTask = z.infer<typeof seTaskSchema>
export type SeEvidence = z.infer<typeof seEvidenceSchema>
export interface SeReportingInput {
    mode: 'sample' | 'live'
    runId: string
    profileId: string
    owner: z.infer<typeof seReporterSchema>
    contract: SeLiveContract
    period: string
    pillar: string
    asOf: string
    generatedAt: string
    eventDateCoverage: z.infer<typeof eventCoverage>
    mappingGaps: string[]
    assignments: SeAssignment[]
    milestones: SeMilestone[]
    tasks: SeTask[]
    evidence: SeEvidence[]
    access: SeAccess[]
    narratives: SeNarrativeBundle
}

const base = z.object({ contractVersion: z.literal(seReportingContractVersion) })
const profileId = z.object({ profileId: id })
export const seReportingRequestSchema = z.discriminatedUnion('operation', [
    base.extend({ operation: z.literal('get') }).strict(),
    base.extend({ operation: z.literal('inspect-profile'), profile: seReportingProfileSchema }).strict(),
    base.extend({ operation: z.literal('setup'), profile: seReportingProfileSchema, confirmed: z.literal(true) }).strict(),
    base.extend({ operation: z.literal('check-access'), ...profileId.shape }).strict(),
    base.extend({
        operation: z.literal('run'), ...profileId.shape, period: seReportPeriodSchema, pillar: id,
        allowUnavailable: z.array(seReportingSourceSchema).max(5), confirmed: z.literal(true),
        testContract: z.object({ name: id, text: z.string().min(1).max(150000) }).strict().optional()
    }).strict(),
    base.extend({ operation: z.literal('review'), runId: id,
        asks: z.array(z.object({ reportId: id, text }).strict()).max(100),
        approve: z.boolean(), confirmed: z.literal(true) }).strict(),
    base.extend({ operation: z.literal('prepare-publish'), runId: id }).strict(),
    base.extend({ operation: z.literal('publish'), runId: id, token: id, overwriteConfirmed: z.boolean(), confirmed: z.literal(true) }).strict()
])
export type SeReportingRequest = z.infer<typeof seReportingRequestSchema>
export const seReportingRunSchema = z.object({
    id, profileId: id, reports: z.array(seReportSchema).max(101), pillars: z.array(id)
}).strict()
export type SeReportingRun = z.infer<typeof seReportingRunSchema>
export const sePublishPreviewSchema = z.object({
    token: id, expiresAt: z.iso.datetime(),
    files: z.array(z.object({ path: id, exists: z.boolean(), status: z.string(), url: z.string().max(2000) }).strict())
}).strict()
export const seReportingResponseSchema = z.discriminatedUnion('kind', [
    base.extend({
        kind: z.literal('state'), mode: z.enum(['sample', 'live']),
        profiles: z.array(seReportingProfileSchema).max(20), access: z.array(seAccessSchema),
        scope: z.object({ profileId: id, manager: id, reporter: id, pillars: z.array(id), primary: z.number().int().nonnegative(), secondary: z.number().int().nonnegative() }).strict().nullable(),
        run: seReportingRunSchema.nullable(), publishPreview: sePublishPreviewSchema.nullable(),
        published: z.array(z.string().max(2000)), message: text
    }).strict(),
    base.extend({ kind: z.literal('error'), code: id, message: text, access: z.array(seAccessSchema) }).strict()
])
export type SeReportingResponse = z.infer<typeof seReportingResponseSchema>
