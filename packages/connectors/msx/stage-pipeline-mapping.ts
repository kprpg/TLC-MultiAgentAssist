import {
    stagePipelineStages, type StagePipelineAcr, type StagePipelineMilestone, type StagePipelineMilestoneStatus,
    type StagePipelineOpportunity, type StagePipelineStage
} from '../../common/contracts/stage-pipeline-review.js'

export type DataverseRow = Record<string, unknown>

const formattedSuffix = '@OData.Community.Display.V1.FormattedValue'
const msPerDay = 86_400_000

export const defaultInboundSourceCodes: ReadonlySet<number> = new Set([861981141, 861980002, 861981086, 861981236])

const forecastLabels: Record<number, string> = {
    100000001: 'Pipeline', 100000002: 'Best case', 100000003: 'Committed',
    100000004: 'Omitted', 100000005: 'Won', 100000006: 'Lost'
}
const threatByCode: Record<number, StagePipelineOpportunity['competitor']['threat']> = { 861980001: 'None', 861980002: 'Medium', 861980003: 'High' }
const milestoneStatusByCode: Record<number, StagePipelineMilestoneStatus> = {
    861980000: 'On Track', 861980001: 'At Risk', 861980002: 'Blocked', 861980003: 'Completed',
    861980004: 'Cancelled', 861980005: 'Lost to Competitor', 861980006: 'Hygiene/Duplicate'
}
const azureSolutionArea = 394380000
const servicesSolutionArea = 861980011
const unknownSolutionArea = 861980013
const openMilestoneStatuses: ReadonlySet<StagePipelineMilestoneStatus> = new Set(['On Track', 'At Risk', 'Blocked'])

function text(row: DataverseRow, key: string): string | undefined {
    const value = row[key]
    return typeof value === 'string' && value.trim() ? value : undefined
}
function number(row: DataverseRow, key: string): number | undefined {
    const value = row[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
function formatted(row: DataverseRow, key: string): string | undefined {
    return text(row, `${key}${formattedSuffix}`)
}
const maxText = 30_000
const maxName = 500
const maxId = 200
const clip = (value: string, max: number): string => value.length > max ? value.slice(0, max) : value
function day(value: string | undefined): string | undefined {
    return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined
}
function daysBetween(from: string, to: string): number {
    return Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / msPerDay))
}

export function parseStage(label: unknown): StagePipelineStage | undefined {
    if (typeof label !== 'string') return undefined
    const normalized = label.replace(/^\s*\d+\s*-\s*/, '').trim().toLowerCase()
    return stagePipelineStages.find((stage) => stage.toLowerCase() === normalized)
}

export type OpportunityMappingContext = {
    asOf: string
    editableIds: ReadonlySet<string>
    inboundCodes: ReadonlySet<number>
}
export type OpportunityMappingResult =
    | { kind: 'row'; row: StagePipelineOpportunity }
    | { kind: 'excluded'; reason: 'account' | 'stage' | 'solution-area' | 'close-date' }

export function mapOpportunityRow(row: DataverseRow, context: OpportunityMappingContext): OpportunityMappingResult {
    const id = text(row, 'opportunityid')
    const accountId = text(row, '_parentaccountid_value')
    const customer = formatted(row, '_parentaccountid_value')
    if (!id || !accountId || !customer) return { kind: 'excluded', reason: 'account' }
    const stage = parseStage(row['msp_activesalesstage'])
    if (!stage) return { kind: 'excluded', reason: 'stage' }
    const area = number(row, 'msp_solutionarea')
    const unknownArea = area === unknownSolutionArea
    const scope = area === azureSolutionArea || unknownArea ? 'azure' : area === servicesSolutionArea ? 'microsoft-services' : undefined
    if (!scope) return { kind: 'excluded', reason: 'solution-area' }
    const closeDate = day(text(row, 'msp_estcompletiondate')) ?? day(text(row, 'estimatedclosedate'))
    if (!closeDate) return { kind: 'excluded', reason: 'close-date' }

    const recurring = Math.max(0, number(row, 'msp_consumptionconsumedrecurring') ?? 0)
    const nonRecurring = Math.max(0, number(row, 'msp_consumptionconsumednonrecurring') ?? 0)
    const reportedDays = number(row, 'msp_daysinstage') ?? 0
    const stageChanged = day(text(row, 'msp_currentsalesstagemodifiedon'))
    const commentChanged = day(text(row, 'msp_forecastcomments_lastmodifiedon_datetime'))
    const forecastCode = number(row, 'msdyn_forecastcategory')
    const competitorName = formatted(row, '_msp_primarycompetitor_value') ?? text(row, 'msp_othercompetitor')
    const state = number(row, 'statecode')
    const sourceCode = number(row, 'msp_sourcesubtypecode')

    return {
        kind: 'row',
        row: {
            id: clip(id, maxId),
            number: clip(text(row, 'msp_opportunitynumber') ?? id, maxName),
            customer: clip(customer, maxName),
            name: clip(text(row, 'name') ?? 'Untitled opportunity', maxName),
            owner: clip(formatted(row, '_ownerid_value') ?? '', maxId),
            editable: context.editableIds.has(id),
            notes: clip(text(row, 'msp_forecastcomments') ?? '', maxText),
            contact: clip(formatted(row, '_parentcontactid_value') ?? '', maxText),
            scope,
            solutionArea: clip(formatted(row, 'msp_solutionarea') ?? (scope === 'azure' ? 'Cloud and AI Platforms' : 'Microsoft Services'), maxName),
            inbound: sourceCode !== undefined && context.inboundCodes.has(sourceCode),
            stage,
            status: state === 1 ? 'Won' : state === 2 ? 'Lost' : 'In Progress',
            forecast: clip(formatted(row, 'msdyn_forecastcategory') ?? (forecastCode !== undefined ? forecastLabels[forecastCode] : undefined) ?? 'Not set', maxName),
            closeDate,
            daysInStage: reportedDays > 0 ? reportedDays : stageChanged ? daysBetween(stageChanged, context.asOf) : 0,
            idleDays: recurring + nonRecurring > 0 && commentChanged ? daysBetween(commentChanged, context.asOf) : null,
            consumedRecurring: recurring,
            consumedNonRecurring: nonRecurring,
            maccCommit: 0,
            partner: clip(formatted(row, '_msp_partneraccountid_value') ?? '', maxText) || null,
            competitor: {
                name: competitorName && competitorName.toLowerCase() !== 'none' ? clip(competitorName, maxText) : null,
                threat: threatByCode[number(row, 'msp_competethreatlevel') ?? 0] ?? 'None'
            },
            solutionTagReview: unknownArea
        }
    }
}

export function mapMilestoneRow(row: DataverseRow): StagePipelineMilestone | undefined {
    const id = text(row, 'msp_engagementmilestoneid')
    const opportunityId = text(row, '_msp_opportunityid_value')
    const statusCode = number(row, 'msp_milestonestatus')
    const status = statusCode === undefined ? undefined : milestoneStatusByCode[statusCode]
    if (!id || !opportunityId || !status) return undefined
    return {
        id: clip(id, maxId),
        number: clip(text(row, 'msp_milestonenumber') ?? id, maxName),
        opportunityId: clip(opportunityId, maxId),
        name: clip(text(row, 'msp_name') ?? 'Unnamed milestone', maxName),
        workload: clip(formatted(row, 'msp_workload') ?? formatted(row, 'msp_milestoneworkload') ?? '', maxText),
        estimatedMonthlyAcr: Math.max(0, number(row, 'msp_monthlyuse') ?? 0),
        commitment: number(row, 'msp_commitmentrecommendation') === 861980003 ? 'Committed' : 'Uncommitted',
        status,
        date: day(text(row, 'msp_milestonedate')) ?? null,
        comment: clip(text(row, 'msp_forecastcomments') ?? '', maxText),
        owner: clip(formatted(row, '_ownerid_value') ?? '', maxText)
    }
}

export function isOpenMilestoneStatus(status: StagePipelineMilestoneStatus): boolean {
    return openMilestoneStatuses.has(status)
}

/** Strict currency text parser for MACC strings; returns null instead of guessing. */
export function parseMoneyText(value: unknown): number | null {
    if (typeof value !== 'string') return null
    let textValue = value.trim()
    if (!textValue) return null
    let negative = false
    if (/^\(.*\)$/.test(textValue)) { negative = true; textValue = textValue.slice(1, -1).trim() }
    const match = /^(-)?\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*([KMB])?$/i.exec(textValue)
    if (!match) return null
    const base = Number(`${match[2]!.replaceAll(',', '')}${match[3] ?? ''}`)
    const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[(match[4] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1
    const result = base * multiplier
    return Number.isFinite(result) ? (negative !== Boolean(match[1]) ? -result : result) : null
}

export function fiscalMonths(fiscalYear: number): string[] {
    return Array.from({ length: 12 }, (_, index) => {
        const month = ((index + 6) % 12) + 1
        const year = index < 6 ? fiscalYear - 1 : fiscalYear
        return `${year}-${String(month).padStart(2, '0')}`
    })
}

export function fiscalYearFor(date: string): number {
    const year = Number(date.slice(0, 4))
    return Number(date.slice(5, 7)) >= 7 ? year + 1 : year
}

type PipeOpportunity = Pick<StagePipelineOpportunity, 'id' | 'customer' | 'stage' | 'status'>

/**
 * Cumulative fiscal-year ACR pipe from open milestones only. Actuals, baseline and target are
 * never fabricated: they stay null until an ACR source is connected.
 */
export function deriveAcrPipe(input: {
    fiscalYear: number
    opportunities: readonly PipeOpportunity[]
    milestones: readonly StagePipelineMilestone[]
}): StagePipelineAcr {
    const months = fiscalMonths(input.fiscalYear)
    const opportunityById = new Map(input.opportunities.map((row) => [row.id, row]))
    const customers = [...new Set(input.opportunities.map((row) => row.customer))].sort((left, right) => left.localeCompare(right))
    const layers = new Map(customers.map((customer) => [customer, {
        committed: new Array<number>(12).fill(0), uncommitted: new Array<number>(12).fill(0), stage1: new Array<number>(12).fill(0)
    }]))
    for (const milestone of input.milestones) {
        const opportunity = opportunityById.get(milestone.opportunityId)
        if (!opportunity || opportunity.status !== 'In Progress' || !isOpenMilestoneStatus(milestone.status) || !milestone.date) continue
        const dated = milestone.date.slice(0, 7)
        if (dated > months[11]!) continue
        const start = Math.max(0, months.indexOf(dated))
        const layer = layers.get(opportunity.customer)
        if (!layer) continue
        const target = milestone.commitment === 'Committed' ? layer.committed
            : opportunity.stage === 'Listen & Consult' ? layer.stage1 : layer.uncommitted
        for (let index = start; index < 12; index += 1) target[index] = (target[index] ?? 0) + milestone.estimatedMonthlyAcr * (index - start + 1)
    }
    return {
        source: 'derived-pipeline-only', syncedAt: null, lastActualMonth: null,
        accounts: customers.map((customer) => {
            const layer = layers.get(customer)!
            return {
                customer,
                months: months.map((month, index) => ({
                    month, actual: null, baseline: null, target: null,
                    committed: layer.committed[index] ?? 0, uncommitted: layer.uncommitted[index] ?? 0, stage1: layer.stage1[index] ?? 0
                }))
            }
        })
    }
}
