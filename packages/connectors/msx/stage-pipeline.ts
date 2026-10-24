import {
    stagePipelineReviewContractVersion, stagePipelineSnapshotSchema,
    type StagePipelineMilestone, type StagePipelineOpportunity, type StagePipelineRequest, type StagePipelineSnapshot,
    type StagePipelineSourceHealth
} from '../../common/contracts/stage-pipeline-review.js'
import {
    defaultInboundSourceCodes, deriveAcrPipe, fiscalYearFor, mapMilestoneRow, mapOpportunityRow, type DataverseRow
} from './stage-pipeline-mapping.js'

export interface StagePipelineSource {
    getCurrentUserId(): Promise<string>
    readRows(entitySet: string, parameters: Record<string, string>): Promise<DataverseRow[]>
    listDealTeamOpportunityIds(userId: string): Promise<string[]>
    listMilestoneTeamOpportunityIds(userId: string): Promise<string[]>
}

export type StagePipelineSourceErrorCode = 'source-unavailable' | 'unauthorized' | 'forbidden' | 'throttled'

export class StagePipelineSourceError extends Error {
    constructor(readonly code: StagePipelineSourceErrorCode, message: string, cause?: unknown) {
        super(message, cause === undefined ? undefined : { cause })
        this.name = 'StagePipelineSourceError'
    }
}

const failureMessages: Record<StagePipelineSourceErrorCode, string> = {
    'unauthorized': 'MSX did not accept the signed-in credential. Sign in again and retry.',
    'forbidden': 'MSX denied access to the requested portfolio data for this user.',
    'throttled': 'MSX is throttling requests. Retry in a moment.',
    'source-unavailable': 'MSX could not be reached or returned an unexpected response.'
}

export function classifyStagePipelineError(error: unknown): StagePipelineSourceError {
    if (error instanceof StagePipelineSourceError) return error
    const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined
    const code: StagePipelineSourceErrorCode = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 429 ? 'throttled' : 'source-unavailable'
    return new StagePipelineSourceError(code, failureMessages[code], error)
}

export type StagePipelineLoadContext = { fresh: boolean; signal?: AbortSignal }

export interface StagePipelineLoader {
    load(request: StagePipelineRequest, context?: StagePipelineLoadContext): Promise<StagePipelineSnapshot>
}

export type LiveStagePipelineOptions = {
    now?: () => Date
    inboundCodes?: ReadonlySet<number>
    limits?: { opportunities?: number; milestones?: number }
}

const chunkSize = 40
const concurrentUsers = 4
const opportunitySelect = [
    'opportunityid', 'name', 'statecode', 'statuscode', '_parentaccountid_value', '_ownerid_value', '_parentcontactid_value',
    'msp_opportunitynumber', 'msp_activesalesstage', 'msp_currentsalesstagemodifiedon', 'msp_daysinstage',
    'msp_estcompletiondate', 'estimatedclosedate', 'msdyn_forecastcategory', 'msp_forecastcomments',
    'msp_forecastcomments_lastmodifiedon_datetime', 'msp_consumptionconsumedrecurring', 'msp_consumptionconsumednonrecurring',
    'msp_solutionarea', 'msp_sourcesubtypecode', 'msp_competethreatlevel', '_msp_primarycompetitor_value', 'msp_othercompetitor',
    '_msp_partneraccountid_value', 'modifiedon'
].join(',')
const milestoneSelect = [
    'msp_engagementmilestoneid', 'msp_milestonenumber', 'msp_name', '_msp_opportunityid_value', 'msp_milestonedate',
    'msp_milestonestatus', 'msp_commitmentrecommendation', 'msp_monthlyuse', 'msp_workload', 'msp_forecastcomments', '_ownerid_value', 'modifiedon'
].join(',')

type PortfolioRead = { ids: Set<string>; failed: unknown[] }

export class LiveStagePipelineConnector implements StagePipelineLoader {
    private readonly now: () => Date
    private readonly inboundCodes: ReadonlySet<number>
    private readonly opportunityLimit: number
    private readonly milestoneLimit: number

    constructor(private readonly source: StagePipelineSource, options: LiveStagePipelineOptions = {}) {
        this.now = options.now ?? (() => new Date())
        this.inboundCodes = options.inboundCodes ?? defaultInboundSourceCodes
        this.opportunityLimit = options.limits?.opportunities ?? 5_000
        this.milestoneLimit = options.limits?.milestones ?? 25_000
    }

    async load(request: StagePipelineRequest): Promise<StagePipelineSnapshot> {
        try {
            return await this.build(request)
        } catch (error) {
            throw classifyStagePipelineError(error)
        }
    }

    private async build(request: StagePipelineRequest): Promise<StagePipelineSnapshot> {
        const generatedAt = this.now()
        const asOf = generatedAt.toISOString().slice(0, 10)
        const me = await this.source.getCurrentUserId()
        const includesSeller = request.scope !== 'reports'
        const [owner, discovered] = await Promise.all([
            this.readDisplayName(me),
            request.scope === 'mine' ? Promise.resolve([]) : this.readDirectReports(me)
        ])
        const selected = request.reportIds
            ? discovered.filter((report) => request.reportIds!.includes(report.id))
            : discovered
        const sources: StagePipelineSourceHealth[] = []
        if (request.scope !== 'mine') {
            sources.push({ source: 'hierarchy', state: 'complete', detail: `${discovered.length} direct report${discovered.length === 1 ? '' : 's'} found in the Dynamics manager hierarchy.`, count: discovered.length })
        }

        // Managers may not edit: the seller portfolio is read only when it is part of the view, and only it is editable.
        const mine = includesSeller ? await this.readPortfolio(me) : { ids: new Set<string>(), failed: [] as unknown[] }
        if (includesSeller && 'dealTeamFailure' in mine && mine.dealTeamFailure) throw mine.dealTeamFailure
        const reportReads = await mapInGroups(selected, concurrentUsers, async (report) => ({ report, read: await this.readPortfolio(report.id) }))
        const degradedReports = reportReads.filter(({ read }) => read.failed.length > 0).length
        const sellerPartial = includesSeller && mine.failed.length > 0

        const mineIds = 'dealTeamFailure' in mine && mine.dealTeamFailure ? new Set<string>() : mine.ids
        const ids = new Set<string>(includesSeller ? mineIds : [])
        for (const { read } of reportReads) for (const id of read.ids) ids.add(id)

        const candidateIds = [...ids]
        const [rawOpportunities, rawMilestones] = await Promise.all([
            this.readChunks('opportunities', 'opportunityid', candidateIds, opportunitySelect),
            this.readChunks('msp_engagementmilestones', '_msp_opportunityid_value', candidateIds, milestoneSelect)
        ])
        const mapped = rawOpportunities.map((row) => mapOpportunityRow(row, { asOf, editableIds: mineIds, inboundCodes: this.inboundCodes }))
        const rows: StagePipelineOpportunity[] = []
        let excluded = 0
        for (const result of mapped) {
            if (result.kind === 'row') rows.push(result.row)
            else excluded += 1
        }
        rows.sort((left, right) => left.customer.localeCompare(right.customer) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
        const opportunityTruncated = rows.length > this.opportunityLimit
        const opportunities = rows.slice(0, this.opportunityLimit)

        const includedIds = new Set(opportunities.map((row) => row.id))
        const allMilestones: StagePipelineMilestone[] = []
        let skippedMilestones = 0
        for (const row of rawMilestones) {
            const milestone = mapMilestoneRow(row)
            if (milestone && !includedIds.has(milestone.opportunityId)) continue
            if (milestone) allMilestones.push(milestone)
            else skippedMilestones += 1
        }
        allMilestones.sort((left, right) => (left.date ?? '9999').localeCompare(right.date ?? '9999') || left.id.localeCompare(right.id))
        const milestoneTruncated = allMilestones.length > this.milestoneLimit
        const milestones = allMilestones.slice(0, this.milestoneLimit)

        const opportunityNotes: string[] = []
        if (excluded > 0) opportunityNotes.push(`${excluded} opportunit${excluded === 1 ? 'y was' : 'ies were'} excluded (unsupported solution area, pre-qualification stage, missing account or close date).`)
        if (sellerPartial) opportunityNotes.push('The seller milestone-team membership could not be read.')
        if (degradedReports > 0) opportunityNotes.push(`${degradedReports} direct report portfolio${degradedReports === 1 ? ' was' : 's were'} not fully readable.`)
        if (opportunityTruncated) opportunityNotes.push(`The list was truncated at ${this.opportunityLimit} opportunities.`)
        sources.push({
            source: 'opportunities', state: opportunityNotes.length ? 'partial' : 'complete',
            detail: opportunityNotes.join(' ') || 'All open opportunities in scope were read from MSX.', count: opportunities.length
        })
        const milestoneNotes: string[] = []
        if (skippedMilestones > 0) milestoneNotes.push(`${skippedMilestones} milestone${skippedMilestones === 1 ? ' has' : 's have'} an unrecognized status and ${skippedMilestones === 1 ? 'was' : 'were'} skipped.`)
        if (milestoneTruncated) milestoneNotes.push(`The list was truncated at ${this.milestoneLimit} milestones.`)
        sources.push({
            source: 'milestones', state: milestoneNotes.length ? 'partial' : 'complete',
            detail: milestoneNotes.join(' ') || 'All open-opportunity milestones were read from MSX.', count: milestones.length
        })
        sources.push({ source: 'macc', state: 'unavailable', detail: 'MACC commitments are account-level in Dataverse; per-opportunity MACC is not available, so MACC & Commits is empty.' })
        sources.push({ source: 'acr', state: 'unavailable', detail: 'Monthly ACR actuals, baseline and target are not connected. The chart shows pipeline layers derived from open milestones.' })

        return stagePipelineSnapshotSchema.parse({
            contractVersion: stagePipelineReviewContractVersion, kind: 'snapshot', mode: 'live', state: 'fresh',
            message: 'Live read-only data from MSX.', generatedAt: generatedAt.toISOString(), owner, asOf, fiscalYear: fiscalYearFor(asOf),
            scope: request.scope, reports: request.scope === 'mine' ? [] : discovered.map((report) => ({ id: report.id, displayName: report.displayName })),
            sources, opportunities, milestones,
            acr: deriveAcrPipe({ fiscalYear: fiscalYearFor(asOf), opportunities, milestones })
        })
    }

    private async readDisplayName(userId: string): Promise<string> {
        try {
            const rows = await this.source.readRows('systemusers', { '$select': 'systemuserid,fullname', '$filter': `systemuserid eq ${userId}`, '$top': '1' })
            const name = rows[0]?.['fullname']
            return typeof name === 'string' ? name : ''
        } catch {
            return ''
        }
    }

    private async readDirectReports(userId: string): Promise<Array<{ id: string; displayName: string }>> {
        const rows = await this.source.readRows('systemusers', {
            '$select': 'systemuserid,fullname', '$filter': `_parentsystemuserid_value eq ${userId} and isdisabled eq false`, '$top': '50'
        })
        return rows.flatMap((row) => typeof row['systemuserid'] === 'string'
            ? [{ id: row['systemuserid'], displayName: typeof row['fullname'] === 'string' && row['fullname'] ? row['fullname'] : 'Unnamed user' }] : [])
            .sort((left, right) => left.displayName.localeCompare(right.displayName))
    }

    private async readPortfolio(userId: string): Promise<PortfolioRead & { dealTeamFailure?: StagePipelineSourceError }> {
        const [dealTeam, milestoneTeam] = await Promise.allSettled([
            this.source.listDealTeamOpportunityIds(userId), this.source.listMilestoneTeamOpportunityIds(userId)
        ])
        const ids = new Set<string>()
        const failed: unknown[] = []
        for (const result of [dealTeam, milestoneTeam]) {
            if (result.status === 'fulfilled') for (const id of result.value) ids.add(id)
            else failed.push(result.reason)
        }
        return {
            ids, failed,
            ...(dealTeam.status === 'rejected' ? { dealTeamFailure: classifyStagePipelineError(dealTeam.reason) } : {})
        }
    }

    private async readChunks(entitySet: string, field: string, ids: readonly string[], select: string): Promise<DataverseRow[]> {
        const chunks: string[][] = []
        for (let offset = 0; offset < ids.length; offset += chunkSize) chunks.push(ids.slice(offset, offset + chunkSize))
        const pages = await mapInGroups(chunks, 2, (chunk) => this.source.readRows(entitySet, {
            '$select': select, '$filter': `statecode eq 0 and (${chunk.map((id) => `${field} eq ${id}`).join(' or ')})`
        }))
        return pages.flat()
    }
}

async function mapInGroups<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = []
    for (let offset = 0; offset < items.length; offset += size) {
        results.push(...await Promise.all(items.slice(offset, offset + size).map(run)))
    }
    return results
}
