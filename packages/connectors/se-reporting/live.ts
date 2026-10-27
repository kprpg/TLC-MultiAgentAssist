import { z } from 'zod'
import {
    seAssignmentSchema, seEvidenceSchema, seMilestoneSchema, seTaskSchema,
    type SeAccess, type SeEvidence, type SeReportingInput, type SeReportingProfile
} from '../../common/contracts/se-reporting.js'
import { readBoundedText } from '../common/http-response.js'
import { GraphSeEvidenceConnector, SeEvidenceCollector } from '../graph/se-evidence.js'
import { DataverseSeReader, evaluateParity, type SeDataverseSource } from './dataverse.js'
import { parseSeLiveContract } from './contract.js'
import { SeReportingError, type SeReportingInspection, type SeReportingResource } from './types.js'
import { seReportingDates } from '../../common/se-reporting-period.js'

const graphRoot = 'https://graph.microsoft.com/v1.0'
const powerBiRoot = 'https://api.powerbi.com/v1.0/myorg/datasets'
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
const lower = (value: string) => value.trim().toLowerCase()
const privateContent = (value: string) => /salary|compensation|performance review|human resources|privileged legal|legal advice/i.test(value)
const date = (value: unknown): string | null => value === null || value === undefined ? null : z.iso.date().parse(String(value).slice(0, 10))
const daxDate = (value: string) => `DATE(${value.split('-').map(Number).join(',')})`
const recordSchema = z.record(z.string(), z.unknown())

type MsxRead = {
    milestones: SeReportingInput['milestones']
    tasks: SeReportingInput['tasks']
    gaps: string[]
    coverage: SeReportingInput['eventDateCoverage']
    access: SeAccess[]
}

export interface SeReportingLiveOptions {
    /** Delegated MSX Dataverse access; used according to sourcePreference. */
    dataverse?: SeDataverseSource
    /** 'powerbi' (default), 'dataverse', or 'auto' (Dataverse only when its inventories match Power BI). */
    sourcePreference?: 'powerbi' | 'dataverse' | 'auto'
    riskField?: string
    getToken(resource: SeReportingResource): Promise<string>
    expectedEmail(): Promise<string | undefined>
    expectedObjectId?(): Promise<string | undefined>
    fetcher?: typeof fetch
    now?: () => Date
}

export class SeReportingApi {
    readonly fetcher: typeof fetch
    constructor(readonly options: SeReportingLiveOptions) { this.fetcher = options.fetcher ?? fetch }
    async request(resource: SeReportingResource, url: string, init: RequestInit = {}): Promise<Response> {
        const target = new URL(url)
        const origin = resource === 'powerbi' ? 'https://api.powerbi.com' : 'https://graph.microsoft.com'
        if (target.origin !== origin || target.username || target.password || target.hash) throw new SeReportingError('invalid-source-url', 'A reporting source URL is outside the approved Microsoft API.')
        let token: string
        try { token = await this.options.getToken(resource) } catch {
            throw new SeReportingError('reporting-sign-in-required', `The ${resource === 'powerbi' ? 'Power BI' : 'Microsoft Graph'} reporting grant is unavailable. Connect the reporting sources under your own identity.`)
        }
        if (!token) throw new SeReportingError('reporting-sign-in-required', 'A delegated reporting token is required.')
        let response: Response
        try {
            response = await this.fetcher(target, {
                ...init, redirect: 'manual', signal: AbortSignal.timeout(45_000),
                headers: { accept: 'application/json', ...init.headers, authorization: `Bearer ${token}` }
            })
        } catch { throw new SeReportingError('reporting-source-transport', 'The reporting source could not be reached. No replacement report was accepted.') }
        if ([401, 403].includes(response.status)) throw new SeReportingError('reporting-source-denied', `The ${resource === 'powerbi' ? 'Power BI' : 'Microsoft Graph'} reporting source denied this user. Check delegated consent and source permissions.`)
        return response
    }
    async json(resource: SeReportingResource, url: string, init?: RequestInit): Promise<unknown> {
        const response = await this.request(resource, url, init)
        if (!response.ok) throw new SeReportingError('reporting-source-error', `A reporting API returned HTTP ${response.status}. The requested source was not treated as available.`)
        return JSON.parse(await readBoundedText(response, 4_000_000))
    }
    async pages(path: string, maximum = 500): Promise<Record<string, unknown>[]> {
        const first = new URL(path, `${graphRoot}/`)
        const rows: Record<string, unknown>[] = []
        const visited = new Set<string>()
        let next: string | undefined = first.href
        while (next) {
            const url = new URL(next)
            if (url.origin !== first.origin || url.pathname !== first.pathname || visited.has(next) || visited.size >= 20) {
                throw new SeReportingError('reporting-pagination', 'Reporting source pagination was invalid or exceeded its request budget.')
            }
            visited.add(next)
            const page = z.object({ value: z.array(recordSchema), '@odata.nextLink': z.string().optional() }).parse(await this.json('graph', next))
            rows.push(...page.value)
            if (rows.length > maximum) throw new SeReportingError('reporting-source-limit', 'The reporting source exceeded its complete-read budget. Narrow the period or approve a run without this source; truncated data is not reported as complete.')
            next = page['@odata.nextLink']
        }
        return rows
    }
    async query(modelId: string, dax: string): Promise<Record<string, unknown>[]> {
        z.uuid().parse(modelId)
        const result = z.object({
            error: z.unknown().optional(),
            results: z.array(z.object({
                error: z.unknown().optional(),
                tables: z.array(z.object({ rows: z.array(recordSchema).default([]), error: z.unknown().optional() })).max(1)
            })).max(1)
        }).parse(await this.json('powerbi', `${powerBiRoot}/${modelId}/executeQueries`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } })
        }))
        const table = result.results[0]?.tables[0]
        if (result.error || result.results[0]?.error || table?.error || !table || table.rows.length >= 5000) {
            throw new SeReportingError('reporting-query-incomplete', 'The semantic-model query failed or exceeded its complete-result budget. No truncated report was generated.')
        }
        return table.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/^.*\[/, '').replace(/\]$/, ''), value])))
    }
    async share(url: string) {
        const link = new URL(url)
        if (link.hostname.endsWith('.sharepoint.com') && link.pathname.endsWith('/Forms/AllItems.aspx') && link.searchParams.has('id')) {
            link.pathname = link.searchParams.get('id')!
            link.search = ''
        }
        if (link.protocol !== 'https:' || !link.hostname.endsWith('.sharepoint.com') || link.username || link.password) throw new SeReportingError('invalid-sharepoint-location', 'A configured HTTPS SharePoint file or folder is required.')
        const encoded = `u!${Buffer.from(link.href).toString('base64url')}`
        return z.object({
            id: z.string().min(1), name: z.string(), webUrl: z.url(),
            parentReference: z.object({ driveId: z.string().min(1) }),
            folder: z.unknown().optional(), file: z.unknown().optional()
        }).parse(await this.json('graph', `${graphRoot}/shares/${encoded}/driveItem?$select=id,name,webUrl,parentReference,folder,file`))
    }
    async file(driveId: string, itemId: string, host: string): Promise<string> {
        const response = await this.request('graph', `${graphRoot}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`)
        if (response.ok) return readBoundedText(response, 2_000_000)
        if (![301, 302, 303, 307, 308].includes(response.status)) throw new SeReportingError('reporting-file-unavailable', 'The configured SharePoint report file could not be read.')
        const location = response.headers.get('location')
        if (!location) throw new SeReportingError('reporting-download-redirect', 'The SharePoint download did not provide a location.')
        const target = new URL(location)
        if (target.protocol !== 'https:' || target.hostname !== host || target.username || target.password || target.hash) {
            throw new SeReportingError('reporting-download-redirect', 'The SharePoint download redirected outside the configured site host.')
        }
        const download = await this.fetcher(target, { redirect: 'error', signal: AbortSignal.timeout(45_000) })
        if (!download.ok) throw new SeReportingError('reporting-file-unavailable', 'The SharePoint file download failed.')
        return readBoundedText(download, 2_000_000)
    }
}

export class LiveSeReportingReader {
    readonly api: SeReportingApi
    constructor(readonly options: SeReportingLiveOptions) { this.api = new SeReportingApi(options) }
    async inspect(profile: SeReportingProfile, testContract?: { name: string; text: string }): Promise<SeReportingInspection> {
        const expectedEmail = await this.options.expectedEmail()
        const expectedObjectId = await this.options.expectedObjectId?.()
        if (!expectedEmail && !expectedObjectId) throw new SeReportingError('reporting-identity-required', 'A signed-in reporter identity is required before private reporting configuration or sources can be used.')
        const me = z.object({ id: z.string(), displayName: z.string(), mail: z.string().nullable(), userPrincipalName: z.string() })
            .parse(await this.api.json('graph', `${graphRoot}/me?$select=id,displayName,mail,userPrincipalName`))
        if ((expectedEmail && ![me.mail, me.userPrincipalName].some((value) => value && lower(value) === lower(expectedEmail))) ||
            (expectedObjectId && lower(me.id) !== lower(expectedObjectId))) {
            throw new SeReportingError('reporting-identity-mismatch', 'The reporting Microsoft 365 account does not match the signed-in TLC user.')
        }
        const file = testContract ? undefined : await this.api.share(profile.contractUrl)
        const markdown = testContract?.text ?? await this.api.file(file!.parentReference.driveId, file!.id, new URL(profile.contractUrl).hostname)
        const contract = parseSeLiveContract(markdown, testContract?.name ?? profile.contractUrl, Boolean(testContract))
        const users = await this.api.query(profile.semanticModelId, `EVALUATE SELECTCOLUMNS(FILTER(systemuser, LOWER(systemuser[internalemailaddress]) = ${quote(lower(me.mail ?? me.userPrincipalName))}), "ID", systemuser[systemuserid])`)
        if (users.length !== 1 || typeof users[0]?.['ID'] !== 'string') throw new SeReportingError('reporter-unresolved', 'The signed-in reporter must resolve to exactly one semantic-model system user.')
        const reporterId = String(users[0]['ID'])
        const selector = contract.manager.system_user_id
            ? `LOWER(AccountAssignmentsWithCustomerIds[ManagerSystemUserId]) = ${quote(lower(contract.manager.system_user_id))}`
            : `LOWER(AccountAssignmentsWithCustomerIds[ManagerAlias]) = ${quote(lower(contract.manager.alias))}`
        const managers = await this.api.query(profile.semanticModelId, `EVALUATE DISTINCT(SELECTCOLUMNS(FILTER(AccountAssignmentsWithCustomerIds, ${selector}), "ID", AccountAssignmentsWithCustomerIds[ManagerSystemUserId]))`)
        const ids = new Set(managers.map((row) => typeof row['ID'] === 'string' ? lower(row['ID']) : '').filter(Boolean))
        if (ids.size !== 1) throw new SeReportingError('manager-unresolved', 'The live contract manager is unmatched or ambiguous. Correct that contract rather than selecting another manager.')
        const managerId = [...ids][0]!
        const rows = await this.api.query(profile.semanticModelId, `EVALUATE SELECTCOLUMNS(FILTER(AccountAssignmentsWithCustomerIds, LOWER(AccountAssignmentsWithCustomerIds[ManagerSystemUserId]) = ${quote(managerId)} && LOWER(AccountAssignmentsWithCustomerIds[AssignedSystemUserId]) = ${quote(lower(reporterId))} && AccountAssignmentsWithCustomerIds[AssignmentType] IN {"Primary","Backup"}), "managerId", [ManagerSystemUserId], "managerAlias", [ManagerAlias], "managerName", [Manager], "reporterId", [AssignedSystemUserId], "accountId", [DataverseAccountId], "accountName", [DataverseAccountName], "atu", [ATU], "workload", [Workload], "assignmentType", [AssignmentType])`)
        const assignments: SeReportingInspection['assignments'] = []
        const mappingGaps: string[] = []
        for (const row of rows) {
            const result = seAssignmentSchema.safeParse({ ...row, workload: profile.workloadMap?.[String(row['workload'])] ?? row['workload'] })
            if (!result.success || !contract.allowedAtus.includes(result.data.atu) || !contract.allowedPillars.includes(result.data.workload)) {
                mappingGaps.push('An assignment with unresolved account, ATU or workload mapping was excluded.')
                continue
            }
            assignments.push(result.data)
        }
        if (!assignments.length) throw new SeReportingError('no-reporting-assignments', 'The reporter has no current Primary or Backup account assignments under this manager and contract. No population was inferred from deal teams or milestone access.')
        const alias = me.displayName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
        if (!alias) throw new SeReportingError('reporter-alias-invalid', 'The reporter display name cannot form a safe report filename.')
        return {
            owner: { name: me.displayName, alias, email: expectedEmail ?? me.mail ?? me.userPrincipalName, system_user_id: reporterId }, contract, assignments, mappingGaps,
            access: [{ source: 'contract', state: 'available', detail: testContract ? 'Explicit isolated test contract validated.' : 'Live v2.0 contract validated.' },
                { source: 'assignments', state: 'available', detail: 'Current manager, reporter and workload assignments resolved.' }]
        }
    }
    async checkAccess(profile: SeReportingProfile, inspection: SeReportingInspection): Promise<SeAccess[]> {
        const access = [...inspection.access]
        const today = (this.options.now ?? (() => new Date()))().toISOString().slice(0, 10)
        const probes = {
            msx: () => this.api.query(profile.semanticModelId, `EVALUATE TOPN(1, FILTER(PodMilestones, LOWER([Pod Member ID]) = ${quote(lower(inspection.owner.system_user_id))}))`),
            m365_calendar: () => this.api.json('graph', `${graphRoot}/me/calendarView?startDateTime=${today}T00:00:00Z&endDateTime=${today}T23:59:59Z&$select=id&$top=1`),
            m365_email: () => this.api.json('graph', `${graphRoot}/me/messages?$select=id&$top=1`),
            m365_teams: () => this.api.json('graph', `${graphRoot}/me/chats?$select=id&$top=1`),
            m365_files: () => this.api.json('graph', `${graphRoot}/me/drive/recent?$select=id&$top=1`),
            wiki: () => this.api.share(profile.wikiUrl!)
        }
        for (const [source, probe] of Object.entries(probes) as [keyof typeof probes, () => Promise<unknown>][]) {
            if (source !== 'msx' && !profile.sources.includes(source)) {
                access.push({ source, state: 'disabled', detail: 'Disabled in this profile.' })
                continue
            }
            try {
                await probe()
                access.push({ source, state: 'available', detail: source === 'msx' ? `Delegated source probe succeeded.${await this.hierarchyNote(inspection)}` : 'Delegated source probe succeeded.' })
            } catch (error) {
                access.push({ source, state: 'unavailable', detail: error instanceof SeReportingError ? error.message : 'The reporting source probe failed validation.' })
            }
        }
        return access
    }
    /** Counts-only sanity check of the Dynamics hierarchy against the assignment-derived manager; never changes scope. */
    private async hierarchyNote(inspection: SeReportingInspection): Promise<string> {
        if (!this.options.dataverse) return ''
        try {
            const reports = await new DataverseSeReader(this.options.dataverse).readDirectReports(inspection.contract.manager.system_user_id)
            const member = reports.some((row) => lower(row.id) === lower(inspection.owner.system_user_id))
            return member
                ? ` Dataverse hierarchy: the reporter is a direct report of the contract manager (${reports.length} direct reports).`
                : ` Dataverse hierarchy: the reporter is not a direct report of the contract manager (${reports.length} direct reports); assignments from the semantic model remain authoritative.`
        } catch {
            return ' Dataverse hierarchy could not be read.'
        }
    }
    async collect(profile: SeReportingProfile, inspection: SeReportingInspection, options: { period: string; pillar: string; allowUnavailable: string[]; runId: string }): Promise<SeReportingInput> {
        const now = (this.options.now ?? (() => new Date()))()
        const dates = seReportingDates(options.period)
        if (dates.end > now.toISOString().slice(0, 10)) throw new SeReportingError('incomplete-reporting-month', 'Choose a completed reporting month. A future month-end cannot be represented as a full-month report.')
        const msx = await this.readMsx(profile, inspection, dates)
        const { milestones, tasks } = msx
        const mappingGaps = [...inspection.mappingGaps, ...msx.gaps]
        const input: SeReportingInput = {
            mode: 'live',
            runId: options.runId, profileId: profile.id, ...inspection,
            period: options.period, pillar: options.pillar, asOf: now.toISOString().slice(0, 10), generatedAt: now.toISOString(),
            eventDateCoverage: msx.coverage,
            milestones, tasks, mappingGaps, evidence: [], access: [...inspection.access, ...msx.access],
            narratives: { customer_updates: [], priority_initiatives: [], account_notes: [], partners: [], technical_themes: [], cross_pillar_dependencies: [], next_month_priorities: [], leadership_decisions: [], scrum_rollup_bullets: [], follow_up_required: [] }
        }
        for (const source of ['m365_calendar', 'm365_email', 'm365_teams', 'm365_files', 'wiki'] as const) {
            if (!profile.sources.includes(source)) {
                input.access.push({ source, state: 'disabled', detail: 'Disabled in this manager profile.' })
                continue
            }
            try {
                input.evidence.push(...await this.readEvidence(source, profile, inspection, dates.start, dates.end))
                input.access.push({ source, state: 'available', detail: 'Configured reporting-period source read completed.' })
            } catch (error) {
                const detail = error instanceof SeReportingError ? error.message : 'The configured source response could not be validated.'
                input.access.push({ source, state: 'unavailable', detail })
            }
        }
        const missing = input.access.filter((row) => row.state === 'unavailable' && !options.allowUnavailable.includes(row.source))
        if (missing.length) throw new SeReportingError('degraded-approval-required', 'Some enabled sources are unavailable. Explicitly approve each missing source, disable it in the profile, or stop. No draft was generated.', input.access)
        return input
    }
    private async readMsx(profile: SeReportingProfile, inspection: SeReportingInspection, dates: ReturnType<typeof seReportingDates>): Promise<MsxRead> {
        const preference = this.options.dataverse ? this.options.sourcePreference ?? 'powerbi' : 'powerbi'
        if (preference === 'powerbi') return this.readPowerBiMsx(profile, inspection, dates)
        if (preference === 'dataverse') return this.readDataverseMsx(inspection, dates)
        let dataverse: MsxRead
        try {
            dataverse = await this.readDataverseMsx(inspection, dates)
        } catch {
            const fallback = await this.readPowerBiMsx(profile, inspection, dates)
            return { ...fallback, access: [{ source: 'msx', state: 'available', detail: 'Dataverse was unavailable; the Power BI inventories were used.' }] }
        }
        const powerBi = await this.readPowerBiMsx(profile, inspection, dates)
        const parity = evaluateParity({
            milestones: [dataverse.milestones.map((row) => row.id), powerBi.milestones.map((row) => row.id)],
            tasks: [dataverse.tasks.map((row) => row.id), powerBi.tasks.map((row) => row.id)]
        })
        return parity.ok
            ? { ...dataverse, access: [{ source: 'msx', state: 'available', detail: `Complete reporter-scoped inventories read from Dataverse. ${parity.detail}` }] }
            : { ...powerBi, access: [{ source: 'msx', state: 'available', detail: `Dataverse parity was not met, so the Power BI inventories were used. ${parity.detail}` }] }
    }

    private async readDataverseMsx(inspection: SeReportingInspection, dates: ReturnType<typeof seReportingDates>): Promise<MsxRead> {
        const reader = new DataverseSeReader(this.options.dataverse!, this.options.riskField ? { riskField: this.options.riskField } : {})
        const reporterId = inspection.owner.system_user_id
        const endExclusive = new Date(`${dates.end}T00:00:00Z`)
        endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
        const [milestones, tasks] = await Promise.all([
            reader.readMilestones(reporterId),
            reader.readTasks(reporterId, { fiscalStart: dates.fiscal.start, start: dates.start, endExclusive: endExclusive.toISOString().slice(0, 10) })
        ])
        return {
            milestones: milestones.milestones, tasks: tasks.tasks, gaps: [...new Set([...milestones.gaps, ...tasks.gaps])],
            coverage: { committed: true, completed: true, created: true },
            access: [{ source: 'msx', state: 'available', detail: 'Complete reporter-scoped milestone and task inventories read from Dataverse.' }]
        }
    }

    private async readPowerBiMsx(profile: SeReportingProfile, inspection: SeReportingInspection, dates: ReturnType<typeof seReportingDates>): Promise<MsxRead> {
        const ownFilter = `LOWER(PodMilestones[Pod Member ID]) = ${quote(lower(inspection.owner.system_user_id))}`
        const sample = (await this.api.query(profile.semanticModelId, `EVALUATE TOPN(1, FILTER(PodMilestones, ${ownFilter}), PodMilestones[Milestone ID])`))[0]
        const column = (name: string) => sample && name in sample ? `PodMilestones[${name}]` : 'BLANK()'
        const rows = await this.api.query(profile.semanticModelId, `EVALUATE SELECTCOLUMNS(FILTER(PodMilestones, ${ownFilter}), "id", [Milestone ID], "reporterId", [Pod Member ID], "accountId", RELATED(opportunity[customerid]), "opportunityId", [Opportunity ID], "name", [Milestone], "category", [Category], "status", [Status], "commitment", [Commitment Recommendation], "monthlyAcr", [Monthly ACR], "date", [Milestone Date], "committedOn", ${column('Committed On')}, "completedOn", ${column('Completed On')}, "createdOn", ${column('Created On')}, "blocker", [Risk / Blocker Details])`)
        const milestones = rows.map((row) => seMilestoneSchema.parse({
            ...row, category: row['category'] ?? '', commitment: row['commitment'] ?? '', blocker: row['blocker'] ?? '',
            date: date(row['date']), committedOn: date(row['committedOn']), completedOn: date(row['completedOn']), createdOn: date(row['createdOn'])
        }))
        const taskOwner = `LOWER(task[ownerid]) = ${quote(lower(inspection.owner.system_user_id))}`
        const taskSample = (await this.api.query(profile.semanticModelId, `EVALUATE TOPN(1, FILTER(task, ${taskOwner}))`))[0]
        const actualStart = taskSample && 'actualstart' in taskSample ? 'task[actualstart]' : 'BLANK()'
        const endExclusive = new Date(`${dates.end}T00:00:00Z`)
        endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
        const nextDay = daxDate(endExclusive.toISOString().slice(0, 10))
        const taskRows = await this.api.query(profile.semanticModelId, `EVALUATE SELECTCOLUMNS(FILTER(task, ${taskOwner} && ((task[actualend] >= ${daxDate(dates.fiscal.start)} && task[actualend] < ${nextDay}) || (${actualStart} >= ${daxDate(dates.start)} && ${actualStart} < ${nextDay}))), "id", [activityid], "ownerId", [ownerid], "milestoneId", [regardingobjectid], "milestoneName", [regardingobjectidname], "accountId", VAR TargetMilestone = task[regardingobjectid] VAR ParentOpportunity = CALCULATE(SELECTEDVALUE(PodMilestones[Opportunity ID]), FILTER(ALL(PodMilestones), LOWER(PodMilestones[Milestone ID]) = LOWER(TargetMilestone))) RETURN LOOKUPVALUE(opportunity[customerid], opportunity[opportunityid], ParentOpportunity), "subject", [subject], "categoryCode", [msp_taskcategory], "state", [statecode], "actualEnd", [actualend], "activityDate", ${actualStart})`)
        const tasks: SeReportingInput['tasks'] = []
        const gaps: string[] = []
        for (const row of taskRows) {
            if (privateContent(String(row['subject'] ?? ''))) continue
            if (typeof row['accountId'] !== 'string' || !row['accountId']) {
                gaps.push('A task with an unresolved milestone/opportunity/account path was excluded.')
                continue
            }
            tasks.push(seTaskSchema.parse({
                ...row, subject: row['subject'] ?? '', milestoneName: row['milestoneName'] ?? '',
                categoryCode: row['categoryCode'] === null ? '' : String(row['categoryCode']),
                actualEnd: date(row['actualEnd']), activityDate: date(row['activityDate'])
            }))
        }
        return {
            milestones, tasks, gaps: [...new Set(gaps)],
            coverage: { committed: Boolean(sample && 'Committed On' in sample), completed: Boolean(sample && 'Completed On' in sample), created: Boolean(sample && 'Created On' in sample) },
            access: [{ source: 'msx', state: 'available', detail: 'Complete reporter-scoped milestone and task inventories read.' }]
        }
    }
    private async readEvidence(source: SeEvidence['source'], profile: SeReportingProfile, inspection: SeReportingInspection, start: string, end: string): Promise<SeEvidence[]> {
        const accounts = inspection.assignments.filter((row) => inspection.contract.allowedAtus.includes(row.atu))
        if (source === 'm365_calendar' || source === 'm365_email' || source === 'm365_teams') {
            return new GraphSeEvidenceConnector(this.api, accounts).read(source, start, end)
        }
        const collector = new SeEvidenceCollector(accounts, source, start, end)
        if (source === 'wiki') {
            if (!profile.wikiUrl) throw new SeReportingError('wiki-unconfigured', 'No optional wiki location was configured.')
            const item = await this.api.share(profile.wikiUrl)
            if (!/\.(md|txt)$/i.test(item.name)) throw new SeReportingError('wiki-format-unsupported', 'The optional wiki connector supports an explicitly configured UTF-8 Markdown or text file.')
            const body = await this.api.file(item.parentReference.driveId, item.id, new URL(profile.wikiUrl).hostname)
            if (privateContent(body)) return []
            for (const account of collector.matches(body)) collector.output.push(seEvidenceSchema.parse({ id: `wiki:${item.id}:${account.accountId}`, accountId: account.accountId, source,
                date: null, summary: body, reference: item.webUrl, qualifies: false }))
        } else {
            const rows = await this.api.pages(`${graphRoot}/me/drive/recent?$select=id,name,webUrl,lastModifiedDateTime,parentReference&$top=100`, 200)
            for (const raw of rows) {
                const item = z.object({ id: z.string(), name: z.string(), webUrl: z.url(), lastModifiedDateTime: z.string(), parentReference: z.object({ driveId: z.string() }) }).parse(raw)
                if (item.lastModifiedDateTime.slice(0, 10) < start || item.lastModifiedDateTime.slice(0, 10) > end || !collector.matches(item.name).length) continue
                if (!/\.(md|txt)$/i.test(item.name)) throw new SeReportingError('file-content-unsupported', 'A matching supporting file requires an approved document-text connector. Metadata alone was not treated as outcome evidence.')
                const body = await this.api.file(item.parentReference.driveId, item.id, new URL(item.webUrl).hostname)
                collector.add(item.id, `${item.name}\n${body}`, item.lastModifiedDateTime, item.webUrl)
            }
        }
        return collector.output
    }
}
