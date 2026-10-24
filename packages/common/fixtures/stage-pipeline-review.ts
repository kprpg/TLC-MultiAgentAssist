import {
    stagePipelineReviewContractVersion, stagePipelineSnapshotSchema, stagePipelineStages,
    type StagePipelineAcr, type StagePipelineMilestone, type StagePipelineMilestoneStatus,
    type StagePipelineOpportunity, type StagePipelineSnapshot, type StagePipelineViewScope
} from '../contracts/stage-pipeline-review.js'

const asOf = '2026-10-21'
const customers = [
    'CONTOSO HEALTH SYSTEM', 'FABRIKAM CLINICS', 'NORTHWIND HOSPITAL GROUP', 'TAILSPIN CARE NETWORK', 'ADVENTURE WORKS MEDICAL'
] as const
const workloads = [
    'Azure SQL modernization', 'Fabric analytics platform', 'GitHub Copilot and DevOps', 'AI Foundry clinical copilot',
    'ExpressRoute for DC1', 'Databricks lakehouse', 'Arc-enabled SQL', 'Resiliency posture', 'App Service migration',
    'AKS landing zone', 'Data warehouse refresh', 'Imaging archive to Blob', 'Zero-trust data protection'
] as const
const partners = [null, 'Global Delivery Center', 'Example Partner One', null, 'Example Partner Two', null] as const
const competitors = [
    { name: null, threat: 'None' }, { name: null, threat: 'None' }, { name: 'AWS | Other', threat: 'Medium' },
    { name: null, threat: 'Low' }, { name: 'Competitor X', threat: 'High' }
] as const
const forecasts = ['Uncommitted', 'Uncommitted', 'Uncommitted', 'Committed', 'Uncommitted'] as const
const milestoneStatuses: readonly StagePipelineMilestoneStatus[] = [
    'On Track', 'On Track', 'On Track', 'Completed', 'On Track', 'At Risk', 'Completed', 'Cancelled', 'Blocked', 'Hygiene/Duplicate', 'On Track', 'Lost to Competitor'
]

function addDays(value: string, days: number): string {
    const parsed = new Date(`${value}T00:00:00Z`)
    parsed.setUTCDate(parsed.getUTCDate() + days)
    return parsed.toISOString().slice(0, 10)
}

function opportunity(index: number): StagePipelineOpportunity {
    const customer = customers[index % customers.length] ?? customers[0]
    const microsoftServices = index >= 44
    const inbound = !microsoftServices && index >= 36
    const consuming = index % 4 !== 3
    const overdue = index % 7 === 2
    const closeOffset = overdue ? -(20 + index * 9) : 12 + ((index * 37) % 330)
    const competitor = competitors[index % competitors.length] ?? competitors[0]
    const recurring = consuming ? 1_000 + ((index * 7_919) % 90_000) : 0
    const label = workloads[index % workloads.length] ?? workloads[0]
    return {
        id: `sample-opp-${String(index + 1).padStart(3, '0')}`,
        number: `7-SAMPLE${String(index + 1).padStart(3, '0')}`,
        customer,
        owner: 'Sample Seller',
        editable: true,
        name: microsoftServices ? `Unified support plan ${index - 43}` : `${inbound ? 'Inbound: ' : ''}${label}`,
        notes: index % 3 === 0 ? `AB - 12/Oct - sample note: partner is validating the workload plan for ${label.toLowerCase()}.` : '',
        contact: `Contact ${index % 9 + 1}`,
        scope: microsoftServices ? 'microsoft-services' : 'azure',
        solutionArea: microsoftServices ? 'Microsoft Services' : 'Cloud and AI Platforms',
        inbound,
        stage: stagePipelineStages[(index * 2 + (microsoftServices ? 1 : 0)) % stagePipelineStages.length] ?? 'Listen & Consult',
        status: index % 17 === 5 ? 'On Hold' : 'In Progress',
        forecast: forecasts[index % forecasts.length] ?? 'Uncommitted',
        closeDate: addDays(asOf, closeOffset),
        daysInStage: (index * 13) % 120,
        idleDays: consuming ? (index * 11) % 110 : null,
        consumedRecurring: recurring,
        consumedNonRecurring: consuming && index % 5 === 0 ? 2_000 + index * 310 : 0,
        maccCommit: index % 11 === 0 ? 8_000_000 + index * 150_000 : 0,
        partner: partners[index % partners.length] ?? null,
        competitor: { name: competitor.name, threat: competitor.threat },
        solutionTagReview: index % 13 === 4
    }
}

function milestonesFor(row: StagePipelineOpportunity, index: number): StagePipelineMilestone[] {
    const total = 1 + (index % 4)
    return Array.from({ length: total }, (_, offset) => {
        const position = index * 5 + offset
        const status = milestoneStatuses[position % milestoneStatuses.length] ?? 'On Track'
        const open = status === 'On Track' || status === 'At Risk' || status === 'Blocked'
        const dayOffset = open && position % 6 === 0 ? -(10 + position % 40) : 20 + ((position * 29) % 380)
        return {
            id: `sample-ms-${String(index + 1).padStart(3, '0')}-${offset + 1}`,
            number: `7-SAMPLEM${String(position + 1).padStart(4, '0')}`,
            opportunityId: row.id,
            name: ['pilot', 'production', 'prod expansion', 'phase 2: services', 'DC1 circuits'][position % 5] ?? 'pilot',
            workload: 'Azure',
            estimatedMonthlyAcr: [150, 700, 3_000, 5_000, 20_000, 500][position % 6] ?? 150,
            commitment: status === 'Completed' || position % 9 === 0 ? 'Committed' : 'Uncommitted',
            status,
            date: addDays(asOf, dayOffset),
            comment: position % 4 === 0 ? `Sample update: customer validated the plan and will confirm usage next month (ref ${position + 1}).` : '',
            owner: ['Sample Owner A', 'Sample Owner B', 'Sample Owner C'][position % 3] ?? 'Sample Owner A'
        }
    })
}

function acrFor(): StagePipelineAcr {
    const weights = [0.3, 0.25, 0.2, 0.15, 0.1]
    const round = (value: number) => Math.round(value / 1_000) * 1_000
    return {
        source: 'sample',
        syncedAt: '2026-09-30',
        lastActualMonth: '2026-09',
        accounts: customers.map((customer, accountIndex) => {
            const weight = weights[accountIndex] ?? 0.1
            return {
                customer,
                months: Array.from({ length: 12 }, (_, i) => {
                    const projected = Math.max(0, i - 2)
                    return {
                        month: `${i < 6 ? 2026 : 2027}-${String(((i + 6) % 12) + 1).padStart(2, '0')}`,
                        actual: round(1_333_000 * weight * Math.min(i + 1, 3)),
                        baseline: round(1_030_000 * weight * projected),
                        committed: round(22_000 * weight * projected),
                        uncommitted: round(290_000 * weight * projected),
                        stage1: round(430_000 * weight * projected),
                        target: round(1_441_000 * weight * (i + 1))
                    }
                })
            }
        })
    }
}

export type SampleStagePipelineOptions = {
    scope?: StagePipelineViewScope
    reportIds?: readonly string[]
}

const sampleReports = [
    { id: 'sample-report-a', displayName: 'Sample Report A' },
    { id: 'sample-report-b', displayName: 'Sample Report B' },
    { id: 'sample-report-c', displayName: 'Sample Report C' }
] as const

function reportPortfolio(): { opportunities: StagePipelineOpportunity[]; milestones: StagePipelineMilestone[] } {
    const opportunities: StagePipelineOpportunity[] = []
    const milestones: StagePipelineMilestone[] = []
    for (let index = 0; index < 18; index += 1) {
        const base = opportunity(index)
        const owner = sampleReports[index % sampleReports.length]!.displayName
        const row: StagePipelineOpportunity = {
            ...base, id: `sample-rpt-opp-${String(index + 1).padStart(3, '0')}`, number: `7-SAMPLER${String(index + 1).padStart(3, '0')}`,
            name: `${base.name} (team)`, owner, editable: false
        }
        opportunities.push(row)
        milestones.push(...milestonesFor(row, index).map((milestone) => ({
            ...milestone, id: milestone.id.replace('sample-ms-', 'sample-rpt-ms-'), number: milestone.number.replace('SAMPLEM', 'SAMPLERM'), owner
        })))
    }
    return { opportunities, milestones }
}

export function createSampleStagePipelineReview(options: SampleStagePipelineOptions = {}): StagePipelineSnapshot {
    const scope = options.scope ?? 'mine'
    const own = Array.from({ length: 46 }, (_, index) => opportunity(index))
    const ownMilestones = own.flatMap((row, index) => milestonesFor(row, index))
    const team = scope === 'mine' ? { opportunities: [], milestones: [] } : reportPortfolio()
    const selected = options.reportIds?.length
        ? new Set<string>(sampleReports.filter((report) => options.reportIds!.includes(report.id)).map((report) => report.displayName))
        : undefined
    const teamOpportunities = selected ? team.opportunities.filter((row) => selected.has(row.owner)) : team.opportunities
    const opportunities = scope === 'reports' ? teamOpportunities : [...own, ...teamOpportunities]
    const included = new Set(opportunities.map((row) => row.id))
    const milestones = [...(scope === 'reports' ? [] : ownMilestones), ...team.milestones].filter((row) => included.has(row.opportunityId))
    return stagePipelineSnapshotSchema.parse({
        contractVersion: stagePipelineReviewContractVersion,
        kind: 'snapshot',
        mode: 'sample',
        state: 'fresh',
        message: 'Synthetic sample data: every customer, opportunity, milestone and amount is fictitious.',
        generatedAt: `${asOf}T09:00:00.000Z`,
        owner: 'Sample Seller',
        asOf,
        fiscalYear: 2027,
        scope,
        reports: scope === 'mine' ? [] : sampleReports.map((report) => ({ ...report })),
        sources: [
            ...(scope === 'mine' ? [] : [{ source: 'hierarchy', state: 'complete', detail: 'Synthetic sample direct reports.', count: sampleReports.length }]),
            { source: 'opportunities', state: 'complete', detail: 'Synthetic sample opportunities.', count: opportunities.length },
            { source: 'milestones', state: 'complete', detail: 'Synthetic sample milestones.' },
            { source: 'macc', state: 'complete', detail: 'Synthetic sample MACC commitments.' },
            { source: 'acr', state: 'complete', detail: 'Synthetic sample ACR series.' }
        ],
        opportunities,
        milestones,
        acr: acrFor()
    })
}