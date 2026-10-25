import { seMilestoneSchema, seTaskSchema, type SeMilestone, type SeTask } from '../../common/contracts/se-reporting.js'
import type { DataverseRow } from '../msx/stage-pipeline-mapping.js'

export interface SeDataverseSource {
    readRows(entitySet: string, parameters: Record<string, string>): Promise<DataverseRow[]>
    listMilestoneTeamMilestoneIds(userId: string): Promise<string[]>
}

const formattedSuffix = '@OData.Community.Display.V1.FormattedValue'
const guidLike = /^[0-9a-zA-Z-]{1,64}$/
const fieldPattern = /^[A-Za-z][A-Za-z0-9_]*$/
const chunkSize = 40
const privateContent = (value: string) => /salary|compensation|performance review|human resources|privileged legal|legal advice/i.test(value)

const text = (row: DataverseRow, key: string): string | undefined => {
    const value = row[key]
    return typeof value === 'string' && value.trim() ? value : undefined
}
const formatted = (row: DataverseRow, key: string) => text(row, `${key}${formattedSuffix}`)
const day = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null

export type SeTaskWindow = { fiscalStart: string; start: string; endExclusive: string }

/**
 * Dataverse-first milestone/task provider for the SE reporting model. It produces the same
 * SeMilestone/SeTask rows as the Power BI reader; it never infers assignment scope.
 */
export class DataverseSeReader {
    constructor(private readonly source: SeDataverseSource, private readonly options: { riskField?: string } = {}) {
        if (options.riskField && !fieldPattern.test(options.riskField)) throw new Error('The risk/blocker field name is invalid.')
    }

    /** Enabled direct reports from the Dynamics manager hierarchy (maintained for the target teams). */
    async readDirectReports(managerId: string): Promise<Array<{ id: string; displayName: string }>> {
        this.assertUser(managerId)
        const rows = await this.source.readRows('systemusers', {
            '$select': 'systemuserid,fullname', '$filter': `_parentsystemuserid_value eq ${managerId} and isdisabled eq false`, '$top': '200'
        })
        return rows.flatMap((row) => {
            const id = text(row, 'systemuserid')
            return id ? [{ id, displayName: text(row, 'fullname') ?? 'Unnamed user' }] : []
        })
    }

    async readMilestones(reporterId: string): Promise<{ milestones: SeMilestone[]; gaps: string[] }> {
        this.assertUser(reporterId)
        const ids = [...new Set(await this.source.listMilestoneTeamMilestoneIds(reporterId))]
        if (ids.length === 0) return { milestones: [], gaps: [] }
        const select = ['msp_engagementmilestoneid', '_msp_opportunityid_value', 'msp_name', 'msp_milestonecategory', 'msp_milestonestatus',
            'msp_commitmentrecommendation', 'msp_monthlyuse', 'msp_milestonedate', 'msp_committedon', 'msp_completedon', 'createdon',
            ...(this.options.riskField ? [this.options.riskField] : [])].join(',')
        const rows = await this.readByIds('msp_engagementmilestones', 'msp_engagementmilestoneid', ids, select)
        const accounts = await this.readAccounts(rows.map((row) => text(row, '_msp_opportunityid_value')))
        const milestones: SeMilestone[] = []
        let unresolved = 0
        for (const row of rows) {
            const opportunityId = text(row, '_msp_opportunityid_value')
            const accountId = opportunityId ? accounts.get(opportunityId) : undefined
            if (!opportunityId || !accountId) { unresolved += 1; continue }
            milestones.push(seMilestoneSchema.parse({
                id: text(row, 'msp_engagementmilestoneid'), reporterId, accountId, opportunityId, name: text(row, 'msp_name') ?? '',
                category: formatted(row, 'msp_milestonecategory') ?? '', status: formatted(row, 'msp_milestonestatus') ?? '',
                commitment: formatted(row, 'msp_commitmentrecommendation') ?? '',
                monthlyAcr: typeof row['msp_monthlyuse'] === 'number' ? row['msp_monthlyuse'] : null,
                date: day(row['msp_milestonedate']), committedOn: day(row['msp_committedon']), completedOn: day(row['msp_completedon']), createdOn: day(row['createdon']),
                blocker: this.options.riskField ? text(row, this.options.riskField) ?? '' : ''
            }))
        }
        return { milestones, gaps: unresolved ? ['A milestone with an unresolved opportunity/account path was excluded.'] : [] }
    }

    async readTasks(reporterId: string, window: SeTaskWindow): Promise<{ tasks: SeTask[]; gaps: string[] }> {
        this.assertUser(reporterId)
        const rows = await this.source.readRows('tasks', {
            '$select': 'activityid,_ownerid_value,_regardingobjectid_value,subject,msp_taskcategory,statecode,actualend,actualstart',
            '$filter': `_ownerid_value eq ${reporterId} and ((actualend ge ${window.fiscalStart} and actualend lt ${window.endExclusive}) or (actualstart ge ${window.start} and actualstart lt ${window.endExclusive}))`
        })
        const visible = rows.filter((row) => !privateContent(text(row, 'subject') ?? ''))
        const milestoneIds = [...new Set(visible.map((row) => text(row, '_regardingobjectid_value')).filter((id): id is string => Boolean(id)))]
        const milestoneRows = milestoneIds.length ? await this.readByIds('msp_engagementmilestones', 'msp_engagementmilestoneid', milestoneIds, 'msp_engagementmilestoneid,_msp_opportunityid_value') : []
        const opportunityByMilestone = new Map(milestoneRows.map((row) => [text(row, 'msp_engagementmilestoneid') ?? '', text(row, '_msp_opportunityid_value')]))
        const accounts = await this.readAccounts([...opportunityByMilestone.values()])
        const tasks: SeTask[] = []
        let unresolved = 0
        for (const row of visible) {
            const milestoneId = text(row, '_regardingobjectid_value') ?? ''
            const opportunityId = opportunityByMilestone.get(milestoneId)
            const accountId = opportunityId ? accounts.get(opportunityId) : undefined
            if (!accountId) { unresolved += 1; continue }
            tasks.push(seTaskSchema.parse({
                id: text(row, 'activityid'), ownerId: reporterId, milestoneId, milestoneName: formatted(row, '_regardingobjectid_value') ?? '', accountId,
                subject: text(row, 'subject') ?? '', categoryCode: typeof row['msp_taskcategory'] === 'number' ? String(row['msp_taskcategory']) : '',
                state: typeof row['statecode'] === 'number' ? row['statecode'] : 0, actualEnd: day(row['actualend']), activityDate: day(row['actualstart'])
            }))
        }
        return { tasks, gaps: unresolved ? ['A task with an unresolved milestone/opportunity/account path was excluded.'] : [] }
    }

    private assertUser(userId: string): void {
        if (!guidLike.test(userId)) throw new Error('The user id is invalid.')
    }

    private async readAccounts(opportunityIds: ReadonlyArray<string | undefined>): Promise<Map<string, string>> {
        const ids = [...new Set(opportunityIds.filter((id): id is string => Boolean(id)))]
        if (ids.length === 0) return new Map()
        const rows = await this.readByIds('opportunities', 'opportunityid', ids, 'opportunityid,_parentaccountid_value')
        return new Map(rows.flatMap((row) => {
            const id = text(row, 'opportunityid')
            const account = text(row, '_parentaccountid_value')
            return id && account ? [[id, account] as const] : []
        }))
    }

    private async readByIds(entitySet: string, field: string, ids: readonly string[], select: string): Promise<DataverseRow[]> {
        const chunks: string[][] = []
        for (let offset = 0; offset < ids.length; offset += chunkSize) chunks.push(ids.slice(offset, offset + chunkSize))
        const rows: DataverseRow[] = []
        for (let offset = 0; offset < chunks.length; offset += 2) {
            const pages = await Promise.all(chunks.slice(offset, offset + 2).map((chunk) => this.source.readRows(entitySet, {
                '$select': select, '$filter': chunk.map((id) => `${field} eq ${id}`).join(' or ')
            })))
            rows.push(...pages.flat())
        }
        return rows
    }
}

export type ProviderComparison = { dataverse: number; powerbi: number; common: number; onlyDataverse: number; onlyPowerBi: number; ratio: number }

export function compareProviders(dataverse: readonly string[], powerbi: readonly string[]): ProviderComparison {
    const left = new Set(dataverse.map((id) => id.toLowerCase()))
    const right = new Set(powerbi.map((id) => id.toLowerCase()))
    const common = [...left].filter((id) => right.has(id)).length
    const union = new Set([...left, ...right]).size
    return { dataverse: left.size, powerbi: right.size, common, onlyDataverse: left.size - common, onlyPowerBi: right.size - common, ratio: union === 0 ? 1 : common / union }
}

export const defaultParityThreshold = 0.99

/** Counts-only parity verdict: Dataverse replaces Power BI for a capability only when the id sets agree. */
export function evaluateParity(input: { milestones: readonly [readonly string[], readonly string[]]; tasks: readonly [readonly string[], readonly string[]] }, threshold = defaultParityThreshold): {
    ok: boolean; milestones: ProviderComparison; tasks: ProviderComparison; detail: string
} {
    const milestones = compareProviders(...input.milestones)
    const tasks = compareProviders(...input.tasks)
    const pct = (value: number) => Math.round(value * 1000) / 10
    const ok = milestones.ratio >= threshold && tasks.ratio >= threshold
    return {
        ok, milestones, tasks,
        detail: `Dataverse parity: milestones ${pct(milestones.ratio)}% (${milestones.common}/${Math.max(milestones.dataverse, milestones.powerbi)}), tasks ${pct(tasks.ratio)}% (${tasks.common}/${Math.max(tasks.dataverse, tasks.powerbi)}); threshold ${pct(threshold)}%.`
    }
}
