import { z } from 'zod'
import {
    momentumCollectionSchema, type MomentumCollection, type MomentumEvent, type MomentumRecord, type MomentumSourceHealth
} from '../../common/contracts/momentum-focus.js'
import { parseStage, type DataverseRow } from './stage-pipeline-mapping.js'
import type { StagePipelineSource } from './stage-pipeline.js'
import { CustomerIndustryScopeError } from './customer-industry.js'

export interface MomentumSource extends StagePipelineSource {
    getHlsAccountIds?(accountIds: string[]): Promise<string[]>
    readRowsBounded?(entitySet: string, parameters: Record<string, string>, maximumRows: number): Promise<DataverseRow[]>
    listMilestoneTeamMilestoneIds?(userId: string): Promise<string[]>
    withFreshReadContext?<T>(action: () => Promise<T>): Promise<T>
}
const guid = z.string().guid()
const suffix = '@OData.Community.Display.V1.FormattedValue'
const text = (row: DataverseRow, key: string): string | null => typeof row[key] === 'string' && row[key].trim() ? row[key].trim() : null
const formatted = (row: DataverseRow, key: string) => text(row, `${key}${suffix}`)
const number = (row: DataverseRow, key: string): number | null => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0 ? row[key] : null
const timestamp = (value: string | null): string | null => value && z.iso.datetime({ offset: true }).safeParse(value).success ? value : null
const day = (value: string | null): string | null => value && z.iso.date().safeParse(value.slice(0, 10)).success ? value.slice(0, 10) : null
const canonicalId = (row: DataverseRow, key: string) => {
    const value = text(row, key)
    return value && guid.safeParse(value).success ? value.toLowerCase() : null
}
const stages = ['Listen & Consult', 'Inspire & Design', 'Empower & Achieve', 'Realize Value', 'Manage & Optimize']
const milestoneStatuses: Record<number, string> = {
    861980000: 'On Track', 861980001: 'At Risk', 861980002: 'Blocked', 861980003: 'Completed',
    861980004: 'Cancelled', 861980005: 'Lost to Competitor', 861980006: 'Hygiene/Duplicate'
}
const emptyHistory: MomentumRecord['history'] = {
    state: 'unavailable', scope: 'unavailable', availableSince: null, lastObserved: null, observations: 0, maxGapDays: null
}
export function momentumSourceStatus(error: unknown): number | undefined {
    return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined
}
const opportunityFields = 'opportunityid,name,_parentaccountid_value,_ownerid_value,statecode,statuscode,msp_activesalesstage,estimatedvalue,_transactioncurrencyid_value,msp_estcompletiondate,estimatedclosedate,msdyn_forecastcategory,msp_forecastcomments_lastmodifiedon_datetime,modifiedon'
const milestoneFields = 'msp_engagementmilestoneid,_msp_opportunityid_value,msp_name,_ownerid_value,msp_milestonestatus,msp_milestonedate,msp_monthlyuse,_transactioncurrencyid_value,msp_commitmentrecommendation,modifiedon'
type Options = {
    now?: () => Date
    sourceId?: string
    excludedAccountIds?(): Promise<string[]>
    limits?: { opportunities?: number; milestones?: number; signals?: number }
}
export class LiveMomentumCollector {
    constructor(private readonly source: MomentumSource, private readonly options: Options = {}) { }
    load(scope: MomentumCollection['scope'], customerIndustry: MomentumCollection['customerIndustry'] = 'hls'): Promise<MomentumCollection> {
        return this.source.withFreshReadContext ? this.source.withFreshReadContext(() => this.collect(scope, customerIndustry)) : this.collect(scope, customerIndustry)
    }
    private async read(entity: string, parameters: Record<string, string>, limit: number) {
        const query = { ...parameters, '$top': String(limit) }
        return this.source.readRowsBounded ? this.source.readRowsBounded(entity, query, limit) : this.source.readRows(entity, query)
    }
    private async chunks(entity: string, field: string, ids: string[], fields: string, limit: number, extra = '') {
        const rows: DataverseRow[] = []
        let capped = false
        for (let offset = 0; offset < ids.length; offset += 40) {
            if (rows.length >= limit) { capped = true; break }
            const batch = ids.slice(offset, offset + 40)
            const result = await this.read(entity, {
                '$select': fields, '$filter': `(${batch.map((id) => `${field} eq ${guid.parse(id)}`).join(' or ')})${extra}`,
                '$orderby': `${field} asc`
            }, limit - rows.length + 1)
            rows.push(...result)
            if (rows.length > limit) { capped = true; break }
        }
        return { rows: rows.slice(0, limit), capped }
    }
    private async collect(scope: MomentumCollection['scope'], customerIndustry: MomentumCollection['customerIndustry']): Promise<MomentumCollection> {
        const at = (this.options.now ?? (() => new Date()))().toISOString()
        const me = guid.parse(await this.source.getCurrentUserId()).toLowerCase()
        const sources: MomentumSourceHealth[] = []
        const health = (source: MomentumSourceHealth['source'], state: MomentumSourceHealth['state'], detail: string, count: number | null) =>
            sources.push({ source, state, detail, count, checkedAt: at })
        const optional = async <T>(source: MomentumSourceHealth['source'], action: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await action() } catch (error) {
                if (momentumSourceStatus(error) === 401) throw error
                health(source, momentumSourceStatus(error) === 403 ? 'denied' : 'unavailable', `The ${source} source could not be read. Coverage is incomplete; no missing facts were inferred.`, null)
                return fallback
            }
        }
        const hierarchy = await optional('hierarchy', () => this.read('systemusers', {
            '$select': 'systemuserid', '$filter': `_parentsystemuserid_value eq ${me} and isdisabled eq false`
        }, 101), [])
        const reports = hierarchy.slice(0, 100).map((row) => canonicalId(row, 'systemuserid')).filter((id): id is string => id !== null)
        const teamAvailable = reports.length > 0
        if (!sources.some((source) => source.source === 'hierarchy')) health('hierarchy', hierarchy.length > 100 ? 'capped' : 'complete', 'Team scope is limited to the currently verified Dynamics direct-report hierarchy, under caller-delegated read access.', reports.length)
        const [dealIds, milestoneOpportunityIds, milestoneIds, excluded] = await Promise.all([
            this.source.listDealTeamOpportunityIds(me), this.source.listMilestoneTeamOpportunityIds(me),
            this.source.listMilestoneTeamMilestoneIds?.(me) ?? Promise.resolve(null),
            this.options.excludedAccountIds?.() ?? Promise.resolve([])
        ])
        const myDealIds = new Set(dealIds.map((id) => guid.parse(id).toLowerCase()))
        const myMilestoneIds = milestoneIds === null ? null : new Set(milestoneIds.map((id) => guid.parse(id).toLowerCase()))
        const ownIds = [...dealIds, ...milestoneOpportunityIds].map((id) => guid.parse(id).toLowerCase())
        const scopeIds = new Set(scope === 'team' ? [] : ownIds)
        if (scope === 'team') {
            for (let offset = 0; offset < reports.length; offset += 4) {
                const reads = await Promise.all(reports.slice(offset, offset + 4).map(async (userId) => {
                    const [deal, milestones] = await Promise.all([
                        this.source.listDealTeamOpportunityIds(userId), this.source.listMilestoneTeamOpportunityIds(userId)
                    ])
                    return [...deal, ...milestones]
                }))
                for (const id of reads.flat()) scopeIds.add(guid.parse(id).toLowerCase())
            }
        }
        const limits = { opportunities: 5_000, milestones: 20_000, signals: 5_000, ...this.options.limits }
        for (const limit of Object.values(limits)) if (!Number.isInteger(limit) || limit < 1 || limit > 25_000) throw new Error('Momentum source limits are invalid.')
        const candidateIds = [...scopeIds].sort()
        const opportunityRead = await this.chunks('opportunities', 'opportunityid', candidateIds.slice(0, limits.opportunities), opportunityFields, limits.opportunities)
        const hidden = new Set(excluded.map((id) => id.toLowerCase()))
        let opportunities = opportunityRead.rows.filter((row) => {
            const id = canonicalId(row, 'opportunityid')
            const accountId = canonicalId(row, '_parentaccountid_value')
            return id !== null && scopeIds.has(id) && (accountId === null || !hidden.has(accountId))
        })
        if (customerIndustry === 'hls') {
            if (!this.source.getHlsAccountIds) throw new CustomerIndustryScopeError('This source cannot verify HLS customer classification. No unfiltered customer list was substituted.')
            const accountIds = [...new Set(opportunities.map((row) => canonicalId(row, '_parentaccountid_value')).filter((id): id is string => id !== null))].sort()
            const hlsIds = new Set((await this.source.getHlsAccountIds(accountIds)).map((id) => guid.parse(id).toLowerCase()))
            const before = opportunities.length
            opportunities = opportunities.filter((row) => {
                const id = canonicalId(row, '_parentaccountid_value')
                return id !== null && hlsIds.has(id)
            })
            health('industry', 'complete', `HLS Customers only: verified MSX Vertical (Health Payor, Health Pharma, Health Provider, MedTech). ${before - opportunities.length} other or unclassified opportunity rows excluded within the authorized portfolio.`, new Set(opportunities.map((row) => canonicalId(row, '_parentaccountid_value'))).size)
        } else health('industry', 'complete', 'All authorized customers explicitly selected; portfolio access restrictions still apply.', null)
        const opportunityIds = opportunities.map((row) => canonicalId(row, 'opportunityid')!)
        const milestoneRead = await optional('milestones', () => this.chunks('msp_engagementmilestones', '_msp_opportunityid_value', opportunityIds, milestoneFields, limits.milestones), { rows: [], capped: false })
        const milestones = [...new Map(milestoneRead.rows.filter((row) => canonicalId(row, 'msp_engagementmilestoneid') &&
            opportunityIds.includes(canonicalId(row, '_msp_opportunityid_value') ?? '')).map((row) => [canonicalId(row, 'msp_engagementmilestoneid')!, row])).values()]
        const currencyIds = [...new Set([...opportunities, ...milestones].map((row) => canonicalId(row, '_transactioncurrencyid_value')).filter((id): id is string => id !== null))]
        const currencyRead = await optional('currencies', () => this.chunks('transactioncurrencies', 'transactioncurrencyid', currencyIds, 'transactioncurrencyid,isocurrencycode', 500), { rows: [], capped: false })
        const currencies = new Map(currencyRead.rows.flatMap((row) => {
            const id = canonicalId(row, 'transactioncurrencyid'), code = text(row, 'isocurrencycode')
            return id && code && /^[A-Z]{3}$/.test(code) ? [[id, code] as const] : []
        }))
        const opportunityMap = new Map<string, MomentumRecord>()
        const sourceUrl = (entity: string, id: string) => this.options.sourceId
            ? `${new URL(this.options.sourceId).origin}/main.aspx?pagetype=entityrecord&etn=${entity}&id=${id}` : null
        for (const raw of opportunities) {
            const id = canonicalId(raw, 'opportunityid')!, state = number(raw, 'statecode')
            const numericStage = number(raw, 'msp_activesalesstage')
            const stage = parseStage(raw['msp_activesalesstage']) ?? parseStage(formatted(raw, 'msp_activesalesstage')) ??
                (numericStage !== null ? stages[numericStage - 1] : undefined) ?? null
            const accountId = canonicalId(raw, '_parentaccountid_value')
            const status = formatted(raw, 'statuscode') ?? (state === 0 ? 'In Progress' : state === 1 ? 'Won' : state === 2 ? 'Lost' : null)
            const row: MomentumRecord = {
                key: `opportunity:${id}`, id, entity: 'opportunity', name: (text(raw, 'name') ?? 'Unnamed opportunity').slice(0, 500),
                accountId, accountName: formatted(raw, '_parentaccountid_value')?.slice(0, 500) ?? null, opportunityId: id,
                stage, status, ownerId: canonicalId(raw, '_ownerid_value'), ownerName: formatted(raw, '_ownerid_value')?.slice(0, 500) ?? null,
                dueDate: day(text(raw, 'msp_estcompletiondate')) ?? day(text(raw, 'estimatedclosedate')),
                value: { basis: 'pipeline', amount: number(raw, 'estimatedvalue'), currency: currencies.get(canonicalId(raw, '_transactioncurrencyid_value') ?? '') ?? null },
                active: state === 0 ? true : state === 1 || state === 2 ? false : null,
                onMyTeam: myDealIds.has(id) || canonicalId(raw, '_ownerid_value') === me,
                role: 'SSP', commitment: number(raw, 'msdyn_forecastcategory') === 100000003 ? true : number(raw, 'msdyn_forecastcategory') === null ? null : false,
                blocked: null, blockingMilestoneIds: [], plannedHold: status?.toLowerCase().includes('on hold') ?? false,
                sourceQuality: accountId && stage && status && state !== null && [0, 1, 2].includes(state) ? 'complete' : 'partial', sourceUpdatedAt: timestamp(text(raw, 'modifiedon')),
                sourceUrl: sourceUrl('opportunity', id), history: { ...emptyHistory }, events: []
            }
            const commentAt = timestamp(text(raw, 'msp_forecastcomments_lastmodifiedon_datetime'))
            if (commentAt) row.events.push({
                id: `forecast:${id}:${commentAt}`, kind: 'forecast-comment', source: 'msx', sourceAt: commentAt, observedAt: at,
                intervalStart: null, intervalEnd: null, field: 'msp_forecastcomments_lastmodifiedon_datetime', from: null, to: null
            })
            opportunityMap.set(id, row)
        }
        const records = [...opportunityMap.values()]
        for (const raw of milestones) {
            const parent = opportunityMap.get(canonicalId(raw, '_msp_opportunityid_value')!)!
            const id = canonicalId(raw, 'msp_engagementmilestoneid')!
            const status = formatted(raw, 'msp_milestonestatus') ?? milestoneStatuses[number(raw, 'msp_milestonestatus') ?? -1] ?? null
            const commitmentCode = number(raw, 'msp_commitmentrecommendation')
            records.push({
                ...parent, key: `milestone:${id}`, id, entity: 'milestone', name: (text(raw, 'msp_name') ?? 'Unnamed milestone').slice(0, 500),
                status, ownerId: canonicalId(raw, '_ownerid_value'), ownerName: formatted(raw, '_ownerid_value')?.slice(0, 500) ?? null,
                dueDate: day(text(raw, 'msp_milestonedate')),
                value: { basis: 'monthly-usage', amount: number(raw, 'msp_monthlyuse'), currency: currencies.get(canonicalId(raw, '_transactioncurrencyid_value') ?? '') ?? null },
                active: parent.active === false || ['Completed', 'Cancelled', 'Lost to Competitor', 'Hygiene/Duplicate'].includes(status ?? '') ? false
                    : parent.active === true && ['On Track', 'At Risk', 'Blocked'].includes(status ?? '') ? true : null,
                onMyTeam: canonicalId(raw, '_ownerid_value') === me || myMilestoneIds?.has(id) === true ? true : myMilestoneIds === null ? null : false,
                role: 'SE', commitment: commitmentCode === 861980003 ? true : commitmentCode === 861980000 ? false : null,
                blocked: Object.values(milestoneStatuses).includes(status ?? '') ? status === 'Blocked' : null, blockingMilestoneIds: [],
                sourceQuality: parent.sourceQuality === 'complete' && Object.values(milestoneStatuses).includes(status ?? '') ? 'complete' : 'partial',
                sourceUpdatedAt: timestamp(text(raw, 'modifiedon')), sourceUrl: sourceUrl('msp_engagementmilestone', id), events: [], history: { ...emptyHistory }
            })
        }
        for (const row of records) if (row.entity === 'milestone' && row.active !== false && row.blocked) {
            const parent = opportunityMap.get(row.opportunityId)!
            parent.blocked = true
            parent.role = 'both'
            parent.blockingMilestoneIds.push(row.id)
        }
        const byId = new Map(records.map((row) => [row.id, row]))
        const regardingIds = [...byId.keys()]
        const since = new Date(Date.parse(at) - 90 * 86_400_000).toISOString()
        const [tasks, notes] = await Promise.all([
            optional('activities', () => this.chunks('tasks', '_regardingobjectid_value', regardingIds, 'activityid,_regardingobjectid_value,createdon', limits.signals, ` and createdon ge ${since}`), { rows: [], capped: false }),
            optional('notes', () => this.chunks('annotations', '_objectid_value', regardingIds, 'annotationid,_objectid_value,createdon', limits.signals, ` and createdon ge ${since}`), { rows: [], capped: false })
        ])
        const attach = (rows: DataverseRow[], field: string, idField: string, kind: MomentumEvent['kind']) => {
            for (const raw of rows) {
                const row = byId.get(canonicalId(raw, field) ?? ''), atSource = timestamp(text(raw, 'createdon')), id = text(raw, idField)
                if (!row || !atSource || !id) continue
                row.events.push({ id: `${kind}:${id}`.slice(0, 200), kind, source: 'msx', sourceAt: atSource, observedAt: at,
                    intervalStart: null, intervalEnd: null, field: 'createdon', from: null, to: null })
            }
        }
        attach(tasks.rows, '_regardingobjectid_value', 'activityid', 'task')
        attach(notes.rows, '_objectid_value', 'annotationid', 'note')
        const clippedSources = new Set<'activities' | 'notes'>()
        for (const row of records) {
            row.events = [...new Map(row.events.map((event) => [`${event.source}:${event.id}`, event])).values()]
                .sort((a, b) => (b.sourceAt ?? '').localeCompare(a.sourceAt ?? '') || a.id.localeCompare(b.id))
            for (const event of row.events.slice(1_000)) clippedSources.add(event.kind === 'note' ? 'notes' : 'activities')
            row.events = row.events.slice(0, 1_000)
        }
        for (const source of clippedSources) if (!sources.some((item) => item.source === source)) {
            health(source, 'capped', 'Per-record dated metadata exceeded the 1,000-event bound. Counts are lower bounds for the disclosed clipped cohort.', null)
        }
        const portfolioCapped = opportunityRead.capped || candidateIds.length > limits.opportunities
        if (!sources.some((source) => source.source === 'portfolio')) health('portfolio', portfolioCapped ? 'capped' : 'complete', 'Current caller-authorized MSX membership rows; nullable fields retain their source meaning.', records.filter((row) => row.entity === 'opportunity').length)
        if (!sources.some((source) => source.source === 'milestones')) health('milestones', milestoneRead.capped ? 'capped' : 'complete', 'Parent stage and explicitly attributed monthly currency only; no parent-value multiplication.', milestones.length)
        if (!sources.some((source) => source.source === 'activities')) health('activities', tasks.capped ? 'capped' : 'complete', 'Dated task creation metadata and latest recorded forecast-comment signal only; not task outcomes or a complete interaction audit.', tasks.rows.length)
        if (!sources.some((source) => source.source === 'notes')) health('notes', notes.capped ? 'capped' : 'complete', 'Dated note-creation metadata only; no free-text or generic modified-time progress inference.', notes.rows.length)
        if (!sources.some((source) => source.source === 'currencies')) health('currencies', currencyRead.capped ? 'capped' : 'complete', 'ISO currency codes resolved only from explicit record currency references. Unattributed currencies remain unknown.', currencies.size)
        health('m365', 'unavailable', 'M365 enrichment is not connected. No additional grants or private signals are accessed.', null)
        const complete = !sources.some((source) => source.source !== 'm365' && source.state !== 'complete')
        if (!complete) for (const record of records) record.sourceQuality = record.sourceQuality === 'unknown' ? 'unknown' : 'partial'
        return momentumCollectionSchema.parse({
            mode: 'live', generatedAt: at, scopeKey: `msx:${me}`, scope, customerIndustry, teamAvailable, complete, records, sources
        })
    }
}
