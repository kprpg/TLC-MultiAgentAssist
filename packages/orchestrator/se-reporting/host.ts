import {
    seReportingRequestSchema, seReportingResponseSchema, seReportingRunSchema, seReportSchema, seNarrativeSynthesisSchema,
    type SeAccess, type SeReportingInput, type SeReportingProfile, type SeReportingResponse, type SeReportingRun
} from '../../common/contracts/se-reporting.js'
import { SeReportingError, type SeProfileStore, type SePublishFile, type SeReportingSource } from '../../connectors/se-reporting/types.js'
import { buildSeReports, consolidateSeReports, resolveSeScope, seReportingDates, seTaskActivityDate, validateSeNarratives } from './model.js'

export interface SeReportingOwner { key: string; email?: string; objectId?: string }

export interface SeReportingHost { invoke(request: unknown): Promise<SeReportingResponse> }
export class MemorySeProfileStore implements SeProfileStore {
    private readonly values = new Map<string, SeReportingProfile[]>()
    async list(owner: string) { return structuredClone(this.values.get(owner) ?? []) }
    async save(owner: string, profile: SeReportingProfile) {
        const profiles = (this.values.get(owner) ?? []).filter((row) => row.id !== profile.id)
        if (profiles.length >= 20) throw new SeReportingError('profile-limit', 'A maximum of 20 reporting profiles is supported.')
        this.values.set(owner, [...profiles, structuredClone(profile)])
    }
}
interface Session {
    run: SeReportingRun | null
    access: SeAccess[]
    scope: Extract<SeReportingResponse, { kind: 'state' }>['scope']
    expires: number
    plan: { token: string; expires: number; runId: string; reports: string; files: SePublishFile[]; profile: SeReportingProfile } | null
}
export class SharedSeReportingHost implements SeReportingHost {
    private readonly sessions = new Map<string, Session>()
    private readonly working = new Set<string>()
    constructor(private readonly options: {
        mode: 'sample' | 'live'
        owner(): Promise<SeReportingOwner | undefined>
        source: SeReportingSource
        profiles: SeProfileStore
        now?: () => Date
        initialRun?: SeReportingRun
        synthesize?(input: SeReportingInput): Promise<unknown>
        onError?(code: string): void
    }) { }
    async invoke(raw: unknown): Promise<SeReportingResponse> {
        const request = seReportingRequestSchema.parse(raw)
        let owner = ''
        let locked = false
        try {
            const signedIn = await this.options.owner()
            if (!signedIn) throw new SeReportingError('reporting-sign-in-required', 'Sign in to TLC before using private reporting profiles.')
            owner = signedIn.key.toLowerCase()
            const now = (this.options.now ?? (() => new Date()))()
            for (const [key, session] of this.sessions) if (session.expires < now.getTime() && !this.working.has(key)) this.sessions.delete(key)
            let session = this.sessions.get(owner)
            if (!session) {
                if (this.sessions.size >= 50) throw new SeReportingError('reporting-session-limit', 'The reporting session limit has been reached.')
                session = { run: this.options.initialRun ? structuredClone(this.options.initialRun) : null, access: [], scope: null, plan: null, expires: now.getTime() + 3_600_000 }
                this.sessions.set(owner, session)
            }
            session.expires = now.getTime() + 3_600_000
            if (this.working.has(owner) && request.operation !== 'get') throw new SeReportingError('reporting-busy', 'A reporting operation is already running for this user.')
            if (request.operation !== 'get') { this.working.add(owner); locked = true }
            let profiles = await this.options.profiles.list(owner)
            let message = ''
            let published: string[] = []
            const findProfile = (profileId: string) => {
                const profile = profiles.find((row) => row.id === profileId)
                if (!profile) throw new SeReportingError('reporting-profile-missing', 'Select a configured manager reporting profile.')
                return profile
            }
            const inspect = async (profile: SeReportingProfile, test?: { name: string; text: string }) => {
                const result = await this.options.source.inspect(profile, test)
                if (signedIn.email && result.owner.email.toLowerCase() !== signedIn.email.toLowerCase()) throw new SeReportingError('reporting-identity-mismatch', 'The reporting source identity changed. No private report was accepted.')
                const pillars = [...new Set(result.assignments.map((row) => row.workload))].filter((pillar) => result.contract.allowedPillars.includes(pillar))
                const eligible = pillars.flatMap((pillar) => resolveSeScope({
                    ...result, mode: this.options.mode, runId: 'inspection', profileId: profile.id, period: now.toISOString().slice(0, 7),
                    pillar, asOf: now.toISOString().slice(0, 10), generatedAt: now.toISOString(), milestones: [], tasks: [], evidence: [],
                    eventDateCoverage: { committed: false, completed: false, created: false },
                    narratives: { customer_updates: [], priority_initiatives: [], account_notes: [], partners: [], technical_themes: [], cross_pillar_dependencies: [], next_month_priorities: [], leadership_decisions: [], scrum_rollup_bullets: [], follow_up_required: [] }
                }).assignments)
                session!.scope = { profileId: profile.id, manager: result.contract.manager.name, reporter: result.owner.name, pillars,
                    primary: eligible.filter((row) => row.assignmentType === 'Primary').length,
                    secondary: eligible.filter((row) => row.assignmentType === 'Backup').length }
                session!.access = result.access
                return result
            }
            if (request.operation === 'inspect-profile' || request.operation === 'setup') {
                const result = await inspect(request.profile)
                session.access = await this.options.source.checkAccess(request.profile, result)
                if (request.operation === 'setup') {
                    await this.options.profiles.save(owner, request.profile)
                    profiles = await this.options.profiles.list(owner)
                    message = 'Manager profile saved privately. Assignments and the live contract will be refreshed before each run.'
                    session.plan = null
                } else message = 'Confirm the resolved manager, reporter and current assignment scope before saving this profile.'
            } else if (request.operation === 'check-access') {
                const profile = findProfile(request.profileId)
                const result = await inspect(profile)
                session.access = await this.options.source.checkAccess(profile, result)
                message = 'Each configured reporting source was probed independently. No report was generated.'
            } else if (request.operation === 'run') {
                const profile = findProfile(request.profileId)
                const inspection = await inspect(profile, request.testContract)
                const input = await this.options.source.collect(profile, inspection, {
                    period: request.period, pillar: request.pillar, allowUnavailable: request.allowUnavailable, runId: globalThis.crypto.randomUUID()
                })
                if (this.options.mode === 'live') {
                    if (!this.options.synthesize) throw new SeReportingError('reporting-model-unconfigured', 'Configure the approved reporting narrative model before running live generation.')
                    const scope = resolveSeScope(input)
                    const dates = seReportingDates(input.period)
                    const grounded = { ...input, ...scope,
                        tasks: scope.tasks.filter((row) => seTaskActivityDate(row, dates.start, dates.end) !== null),
                        evidence: scope.evidence.filter((row) => row.date === null || row.date >= dates.start && row.date <= dates.end)
                    }
                    const { qualifying_evidence_ids: qualifying, ...narratives } = seNarrativeSynthesisSchema.parse(await this.options.synthesize(grounded))
                    if (qualifying.some((id) => !grounded.evidence.some((row) => row.id === id && row.source !== 'wiki' && row.source !== 'm365_calendar' && row.date))) {
                        throw new SeReportingError('reporting-evidence-invalid', 'The reporting model returned an unsupported activity-evidence identifier.')
                    }
                    input.narratives = validateSeNarratives(narratives, grounded)
                    input.evidence = input.evidence.map((row) => ({ ...row, qualifies: qualifying.includes(row.id) }))
                }
                const reports = buildSeReports(input)
                if (!reports.length) throw new SeReportingError('no-qualifying-report', 'No eligible reporting-period activity or current-fiscal-year milestone inventory qualified for a report. No empty report package was created.')
                session.run = seReportingRunSchema.parse({
                    id: input.runId, profileId: profile.id, reports: [...reports, consolidateSeReports(reports)], pillars: session.scope?.pillars ?? []
                })
                session.access = input.access
                session.plan = null
                message = 'Draft package generated. Review every report and supply your own asks (or explicitly leave them empty) before approval or publication.'
            } else if (request.operation === 'review') {
                const run = this.requireRun(session, request.runId)
                if (request.approve && run.reports.some((report) => report.schema_contract.test_mode)) throw new SeReportingError('test-approval-denied', 'Test-contract artifacts remain drafts and cannot be approved.')
                const status = request.approve ? 'approved' as const : 'draft' as const
                const originals = run.reports.filter((report) => report.artifact_type === 'person_pillar_report')
                if (request.asks.length !== originals.length || new Set(request.asks.map((row) => row.reportId)).size !== originals.length ||
                    request.asks.some((row) => !originals.some((report) => report.report_id === row.reportId))) {
                    throw new SeReportingError('reporter-asks-scope', 'Confirm reporter-owned asks, or none, separately for every ATU report.')
                }
                const reviewed = originals.map((report) => {
                    const asks = request.asks.find((row) => row.reportId === report.report_id)!.text
                    return seReportSchema.parse({
                        ...report, status, review: { status, asks_captured: true, approved_by: request.approve ? owner : null, approved_at: request.approve ? now.toISOString() : null },
                        asks_for_manager: asks.trim() ? [{ ask: asks, why_it_matters: '', customer: '', urgency: '', source_refs: [] }] : []
                    })
                })
                run.reports = [...reviewed, consolidateSeReports(reviewed)]
                session.plan = null
                message = request.approve ? 'Reporter review recorded and this package explicitly approved.' : 'Reporter asks captured verbatim; the package remains draft.'
            } else if (request.operation === 'prepare-publish') {
                const run = this.requireRun(session, request.runId)
                if (run.reports.some((report) => !report.review.asks_captured)) throw new SeReportingError('reporter-review-required', 'Capture reporter-owned asks or explicitly confirm none before publication.')
                const profile = findProfile(run.profileId)
                const inspection = await inspect(profile)
                if (inspection.contract.hash !== run.reports[0]?.schema_contract.content_hash) throw new SeReportingError('contract-changed', 'The live contract changed after generation. Generate a fresh package before publication.')
                const files = await this.options.source.preview(profile, run.reports)
                session.plan = { token: globalThis.crypto.randomUUID(), expires: now.getTime() + 600_000, runId: run.id,
                    reports: JSON.stringify(run.reports), files, profile: structuredClone(profile) }
                message = 'Review the exact destination files and any existing report status. Publication requires a separate explicit confirmation.'
            } else if (request.operation === 'publish') {
                const run = this.requireRun(session, request.runId)
                const plan = session.plan
                if (!plan || plan.token !== request.token || plan.runId !== run.id || plan.expires < now.getTime() || plan.reports !== JSON.stringify(run.reports) ||
                    JSON.stringify(findProfile(run.profileId)) !== JSON.stringify(plan.profile)) {
                    throw new SeReportingError('publication-review-expired', 'The publication review expired or changed. Prepare and review it again.')
                }
                if (plan.files.some((file) => file.exists) && !request.overwriteConfirmed) throw new SeReportingError('overwrite-confirmation-required', 'Replacing any existing draft, approved or final report requires explicit overwrite confirmation.')
                const current = await inspect(plan.profile)
                if (current.contract.hash !== run.reports[0]?.schema_contract.content_hash) throw new SeReportingError('contract-changed', 'The live contract changed after publication review. Generate a fresh report package.')
                session.plan = null
                published = await this.options.source.publish(plan.profile, run.reports, plan.files)
                message = this.options.mode === 'sample' ? 'Sample publication simulated. No files, source records or SharePoint reports were changed.' : 'The reviewed report package was published. No CRM records or shared rollups were changed.'
            }
            return seReportingResponseSchema.parse({
                contractVersion: '1.0', kind: 'state', mode: this.options.mode, profiles, run: session.run,
                access: session.access, scope: session.scope, published, message,
                publishPreview: session.plan ? { token: session.plan.token, expiresAt: new Date(session.plan.expires).toISOString(),
                    files: session.plan.files.map(({ etag: _etag, ...file }) => { void _etag; return file }) } : null
            })
        } catch (error) {
            const failure = error instanceof SeReportingError ? error : new SeReportingError('reporting-operation-failed', 'The reporting operation failed validation or persistence. No replacement report or successful publication was assumed.')
            this.options.onError?.(failure.code)
            return seReportingResponseSchema.parse({ contractVersion: '1.0', kind: 'error', code: failure.code, message: failure.message, access: failure.access })
        } finally {
            if (locked) this.working.delete(owner)
        }
    }
    private requireRun(session: Session, id: string) {
        if (!session.run || session.run.id !== id) throw new SeReportingError('reporting-run-expired', 'This report run is unavailable in the current signed-in session. Generate it again.')
        return session.run
    }
}
