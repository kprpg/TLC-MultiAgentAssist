import {
    sellerDashboardContractVersion, sellerDashboardSnapshotSchema,
    type SellerDashboardMilestone, type SellerDashboardOpportunity,
    type SellerDashboardReport, type SellerDashboardSnapshot
} from '../contracts/seller-dashboard.js'

const asOf = '2026-10-10'
const generatedAt = '2026-10-10T09:00:00.000Z'
const end = '2026-12-31'
const accountInputs = [
    { tpid: '1000001', name: 'Contoso Energy', quotas: [900_000, 420_000, 240_000], actuals: [720_000, 270_000, 280_000] },
    { tpid: '1000002', name: 'Fabrikam Retail', quotas: [600_000, 300_000, 150_000], actuals: [450_000, 180_000, 160_000] },
    { tpid: '1000003', name: 'Northwind Health', quotas: [420_000, 240_000, 120_000], actuals: [462_000, 130_000, 125_000] },
    { tpid: '1000004', name: 'Zava Inc.', quotas: [300_000, 180_000, 60_000], actuals: [180_000, 90_000, 65_000] },
    { tpid: '1000005', name: 'Adventure Works Cycles', quotas: [180_000, 60_000, 30_000], actuals: [-30_000, null, 20_000] }
] as const
const metricInputs = [
    { name: 'ACR - Core', bucket: 'Organic consumption', weight: 0.6, attainment: 80, recurring: 600_000 },
    { name: 'Databases', bucket: 'Strategic workloads', weight: 0.25, attainment: 60, recurring: 200_000 },
    { name: 'Fabric + XCR - Power BI Consumed Revenue', bucket: 'Analytics growth', weight: 0.15, attainment: 100, recurring: 100_000 }
] as const

function recordTiming(value: string | null): SellerDashboardMilestone['timing'] {
    return value === null ? 'undated' : value < asOf ? 'overdue' : value > end ? 'future' : 'in-quarter'
}

export function createSampleSellerDashboard(): SellerDashboardSnapshot {
    const metrics: SellerDashboardReport['official']['metrics'] = metricInputs.map((metric, index) => {
        const quota = accountInputs.reduce((sum, row) => sum + (row.quotas[index] ?? 0), 0)
        const actual = accountInputs.reduce((sum, row) => sum + (row.actuals[index] ?? 0), 0)
        return {
            name: metric.name, bucket: metric.bucket, unit: 'USD', mappingSupported: true, scenarioAllowed: true,
            attainment: metric.attainment, actual, quota, recurring: metric.recurring,
            calcActual: actual - metric.recurring, calcQuota: quota - metric.recurring,
            gap: Math.max(quota - actual, 0), closedGap: Math.max(quota / 2 - actual / 2, 0),
            closedAttainment: 85.2, accountActualDifference: 0, accountQuotaDifference: 0
        }
    })
    const opportunityInputs = [
        { account: 0, name: 'Grid operations modernization', owner: 'Avery Johnson', stage: '3 - Empower & Achieve', value: 4_200_000, date: '2026-11-15', state: 'Open', intent: 'Azure consumption', play: 'Cloud migration', modified: '2026-08-20T09:00:00.000Z' },
        { account: 0, name: 'Azure commitment renewal', owner: 'Jordan Lee', stage: '2 - Inspire & Design', value: 2_600_000, date: '2026-12-10', state: 'Open', intent: 'MACC', play: 'Azure commitment', modified: generatedAt },
        { account: 1, name: 'Retail analytics expansion', owner: 'Taylor Morgan', stage: '3 - Empower & Achieve', value: 1_800_000, date: '2026-10-25', state: 'Open', intent: 'Azure consumption', play: 'Fabric analytics', modified: generatedAt },
        { account: 1, name: 'SQL platform modernization', owner: 'Casey Park', stage: '2 - Inspire & Design', value: 1_100_000, date: '2026-12-01', state: 'Open', intent: 'SQL billed', play: 'SQL modernization', modified: '2026-08-18T09:00:00.000Z' },
        { account: 2, name: 'Clinical data estate', owner: 'Morgan Chen', stage: '4 - Realize Value', value: 3_200_000, date: '2026-08-30', state: 'Won', intent: 'Azure consumption', play: 'Database modernization', modified: generatedAt },
        { account: 2, name: 'AI-assisted care planning', owner: 'Morgan Chen', stage: '1 - Listen & Consult', value: 850_000, date: '2027-02-20', state: 'Open', intent: 'Azure consumption', play: 'AI innovation', modified: generatedAt },
        { account: 3, name: 'Secure cloud landing zone', owner: 'Drew Wilson', stage: '1 - Listen & Consult', value: 650_000, date: '2026-12-20', state: 'Open', intent: 'Azure consumption', play: 'Security foundations', modified: generatedAt },
        { account: 3, name: 'Database growth program', owner: 'Sam Rivera', stage: '2 - Inspire & Design', value: 720_000, date: '2026-11-28', state: 'Open', intent: 'Azure consumption', play: 'Database modernization', modified: generatedAt }
    ]
    const opportunities: SellerDashboardOpportunity[] = opportunityInputs.map((input, index) => {
        const account = accountInputs[input.account]
        if (!account) throw new Error('Invalid synthetic opportunity account.')
        return {
            id: `sample-opportunity-${index + 1}`, number: `SAMPLE-OP-${index + 1}`, tpid: account.tpid,
            account: account.name, name: input.name, owner: input.owner, stage: input.stage,
            solutionArea: 'Cloud and AI Platforms', salesPlay: input.play, intent: input.intent,
            estimatedValue: input.value, currency: 'USD', monthlyRunRate: null,
            closeDate: input.date, state: input.state,
            forecastComments: 'Synthetic review evidence: confirm customer decision, workload credit and the next accountable owner.',
            timing: recordTiming(input.date), relevance: 'Review metric mapping', modifiedAt: input.modified,
            ...(input.intent === 'SQL billed' ? { estimatedBilledRevenue: 240_000, estimatedSqlRevenue: 180_000 } : {})
        }
    })
    const milestoneInputs = [
        { parent: 0, name: 'Azure production rollout', monthly: 42_000, date: '2026-11-01', status: 'On Track', commitment: 'Committed', metric: 0, workload: 'Azure Kubernetes Service', category: 'Production' },
        { parent: 0, name: 'Grid telemetry expansion', monthly: 18_000, date: '2026-10-03', status: 'At Risk', commitment: 'Uncommitted', metric: 0, workload: 'Azure infrastructure', category: 'Production' },
        { parent: 0, name: 'Regional capacity approval', monthly: 24_000, date: '2026-10-28', status: 'Blocked', commitment: 'Uncommitted', metric: 0, workload: 'Azure virtual machines', category: 'Production' },
        { parent: 1, name: 'Commitment onboarding', monthly: 16_000, date: '2026-12-15', status: 'On Track', commitment: 'Committed', metric: 0, workload: 'Azure infrastructure', category: 'Production' },
        { parent: 2, name: 'Fabric analytics launch', monthly: 22_000, date: '2026-10-21', status: 'On Track', commitment: 'Committed', metric: 2, workload: 'Microsoft Fabric', category: 'Production' },
        { parent: 2, name: 'Store analytics expansion', monthly: 12_000, date: '2026-11-20', status: 'At Risk', commitment: 'Uncommitted', metric: 2, workload: 'Power BI', category: 'Production' },
        { parent: 3, name: 'SQL production cutover', monthly: 28_000, date: '2026-10-05', status: 'Blocked', commitment: 'Uncommitted', metric: 1, workload: 'Azure SQL Database', category: 'Production' },
        { parent: 3, name: 'Database capacity growth', monthly: 19_000, date: '2026-12-01', status: 'On Track', commitment: 'Uncommitted', metric: 1, workload: 'Azure SQL Database', category: 'Production' },
        { parent: 4, name: 'Clinical database scale-out', monthly: 31_000, date: '2026-11-08', status: 'On Track', commitment: 'Committed', metric: 1, workload: 'Azure Cosmos DB', category: 'Production' },
        { parent: 4, name: 'Completed clinical pilot', monthly: 8_000, date: '2026-08-30', status: 'Completed', commitment: 'Committed', metric: 1, workload: 'Azure SQL Database', category: 'Pilot' },
        { parent: 5, name: 'AI proof of value', monthly: 9_000, date: '2027-01-12', status: 'On Track', commitment: 'Uncommitted', metric: 0, workload: 'Azure AI', category: 'Pilot' },
        { parent: 6, name: 'Landing-zone assessment', monthly: 7_000, date: '2026-11-12', status: 'On Track', commitment: 'Uncommitted', metric: 0, workload: 'Azure infrastructure', category: 'Assessment' },
        { parent: 7, name: 'PostgreSQL production ramp', monthly: 14_000, date: '2026-11-18', status: 'At Risk', commitment: 'Uncommitted', metric: 1, workload: 'Azure Database for PostgreSQL', category: 'Production' },
        { parent: 7, name: 'Workload credit review', monthly: 11_000, date: null, status: 'On Track', commitment: 'Best case', metric: null, workload: 'Unmapped workload', category: 'Production' }
    ]
    const milestones: SellerDashboardMilestone[] = milestoneInputs.map((input, index) => {
        const parent = opportunities[input.parent]
        const metric = input.metric === null ? undefined : metricInputs[input.metric]
        if (!parent) throw new Error('Invalid synthetic milestone parent.')
        const active = input.status !== 'Completed'
        const eligible = active && input.category === 'Production'
        return {
            id: `sample-milestone-${index + 1}`, number: `SAMPLE-MS-${index + 1}`,
            opportunityId: parent.id, opportunityName: parent.name, tpid: parent.tpid, account: parent.account,
            name: input.name, owner: parent.owner, category: input.category, status: input.status,
            commitment: input.commitment, monthly: input.monthly, date: input.date, workload: input.workload,
            forecastComments: 'Synthetic customer-review note; incremental credit and production date require owner confirmation.',
            currency: 'USD', active, timing: recordTiming(input.date),
            metricCandidates: metric ? [metric.name] : [],
            mappingBasis: 'Tentative workload hint; not a verified earnings-credit rule.',
            classification: eligible ? 'Production candidate - credit unverified' : 'Not an eligible production candidate',
            scenarioCredit: null, modifiedAt: parent.modifiedAt ?? generatedAt,
            ...(input.commitment === 'Committed' ? { commitmentChangedAt: '2026-10-05T09:00:00.000Z' } : {}),
            region: 'East US', riskDetails: input.status === 'Blocked' ? 'Synthetic capacity dependency: owner approval required.' : ''
        }
    })
    const accounts: SellerDashboardReport['accounts'] = accountInputs.map((input) => {
        const accountOpportunities = opportunities.filter((row) => row.tpid === input.tpid)
        const open = accountOpportunities.filter((row) => row.state === 'Open')
        const accountMilestones = milestones.filter((row) => row.tpid === input.tpid)
        const candidates = accountMilestones.filter((row) => row.active && row.category === 'Production' && row.timing === 'in-quarter')
        return {
            tpid: input.tpid, name: input.name,
            metrics: metricInputs.map((metric, index) => {
                const quota = input.quotas[index]
                const actual = input.actuals[index]
                if (quota === undefined || actual === undefined) throw new Error('Incomplete synthetic quota row.')
                return {
                    metric: metric.name, bucket: metric.bucket, quota, actual,
                    variance: actual === null ? null : actual - quota,
                    gap: actual === null ? null : Math.max(quota - actual, 0)
                }
            }),
            pipeline: {
                status: 'complete', openCount: open.length,
                inQuarterCount: open.filter((row) => row.timing === 'in-quarter').length,
                inQuarterValue: open.filter((row) => row.timing === 'in-quarter').reduce((sum, row) => sum + (row.estimatedValue ?? 0), 0),
                productionCount: accountMilestones.filter((row) => row.active && row.category === 'Production').length,
                inQuarterProductionCount: candidates.length,
                committedMonthly: candidates.filter((row) => row.commitment === 'Committed').reduce((sum, row) => sum + (row.monthly ?? 0), 0),
                uncommittedMonthly: candidates.filter((row) => row.commitment === 'Uncommitted').reduce((sum, row) => sum + (row.monthly ?? 0), 0),
                noPipeline: accountOpportunities.length + accountMilestones.length === 0,
                noInQuarterPipeline: !open.some((row) => row.timing === 'in-quarter') && candidates.length === 0
            },
            nextAction: input.tpid === '1000005'
                ? 'No recorded pipeline in the complete accessible sample scope. Resolve missing database actuals and qualify a new customer play.'
                : 'Validate incremental credit, production timing and dependencies with the milestone owner.'
        }
    })
    return sellerDashboardSnapshotSchema.parse({
        contractVersion: sellerDashboardContractVersion, kind: 'snapshot', mode: 'sample', state: 'ready',
        message: 'Synthetic sample only. No seller, customer, earnings or pipeline data was copied from the reference report.',
        report: {
            schemaVersion: 1, generatedAt,
            plan: {
                currency: 'USD', unit: 'USD', fiscalYear: 2027, sourceUnitsVerified: true,
                metricMapping: metricInputs.map((row) => ({
                    metric: row.name, bucket: row.bucket, hintSupported: true,
                    state: 'Optional tentative hints only', scenarioAllowed: true
                })),
                unmappedProductionCandidates: 0
            },
            period: { label: 'FY27 Q2 official YTD period', start: '2026-07-01', end, today: asOf },
            sources: {
                earnings: { status: 'live', generatedAt, refreshedAt: '2026-10-09T09:00:00.000Z', months: ['July, 2026', 'August, 2026', 'September, 2026', 'October, 2026', 'November, 2026', 'December, 2026'], ageDays: 1 },
                pipeline: { status: 'complete', asOf: generatedAt, errors: [] },
                quota: { name: 'Synthetic Quota by Accounts fixture', rows: 90, accounts: accounts.length }
            },
            warnings: [
                'Adventure Works Cycles has missing database actuals; unknown is not zero.',
                'Opportunity nominal value, monthly consumption and period earnings credit have different units.',
                'Workload mappings are tentative. No pipeline amount is certified as incremental earnings credit.'
            ],
            official: {
                weightedAttainment: 78, closedMonthAttainment: 85.2, closedThrough: 'September, 2026',
                buckets: metrics.map((row, index) => ({
                    name: row.bucket, weight: metricInputs[index]?.weight,
                    unit: 'USD', attainment: row.attainment, actual: row.actual, quota: row.quota,
                    recurring: row.recurring, calcActual: row.calcActual, calcQuota: row.calcQuota, gap: row.gap
                })),
                metrics
            },
            accounts, opportunities, milestones,
            coverage: metrics.map((metric) => {
                const candidates = milestones.filter((row) => row.active && row.category === 'Production' && row.timing === 'in-quarter' && row.metricCandidates.includes(metric.name))
                return {
                    metric: metric.name, bucket: metric.bucket, gap: metric.gap, candidateCount: candidates.length,
                    committedMonthly: candidates.filter((row) => row.commitment === 'Committed').reduce((sum, row) => sum + (row.monthly ?? 0), 0),
                    uncommittedMonthly: candidates.filter((row) => row.commitment === 'Uncommitted').reduce((sum, row) => sum + (row.monthly ?? 0), 0),
                    verifiedPeriodCredit: null, state: 'Needs credit validation', mappingSupported: true,
                    mappingReviewRequired: false, scenarioAllowed: true,
                    scenarioCommittedCredit: null, scenarioUncommittedCredit: null, scenarioRemainingGap: null,
                    nextAction: 'Confirm metric mapping, incremental production credit and the remaining-period ramp.'
                }
            }),
            actions: accounts.map((account) => ({
                account: account.name, tpid: account.tpid, metric: 'ACR - Core',
                priority: account.pipeline.noPipeline ? 'High' : 'Medium',
                issue: account.pipeline.noPipeline ? 'No recorded pipeline' : 'Credit and timing need validation',
                action: account.nextAction, owner: 'Account team'
            })),
            methodology: [
                'Official weighted attainment and bucket scores are source-reported, never reconstructed from gross consumption.',
                'Posted gap is max(calculated quota minus signed calculated actual, zero). Ordinary earnings still to post are included.',
                'Account gaps net selected quota and actuals before clamping; overlapping buckets remain separate.',
                'Remaining-period candidates are active positive USD production milestones from the as-of date through period end, inclusive.',
                'Monthly run-rate and nominal opportunity value are not verified period earnings credit.',
                'All data in this sample is fictitious. Live mode requires the current seller’s own validated quota export and authorized sources.'
            ]
        },
        supplement: {
            schemaVersion: 1,
            consumption: {
                source: { name: 'Synthetic Fabric consumption', status: 'complete', asOf: generatedAt, start: '2026-10-01', end: '2026-10-31', detail: 'Posted monthly consumption and illustrative calendar-day landing are separate from compensation attainment.' },
                accounts: accountInputs.map((account, index) => {
                    const actual = [216_000, 153_000, 189_000, 81_000, 36_000][index]
                    if (actual === undefined) throw new Error('Incomplete synthetic consumption.')
                    return {
                        tpid: account.tpid, actual, previousActual: actual * [0.9, 1.12, 0.85, 1.2, 1.4][index]!,
                        averageDaily: actual / 9, projected: actual / 9 * 31, daysPosted: 9,
                        pillars: [
                            { name: 'Infrastructure', actual: actual * 0.4 },
                            { name: 'Databases', actual: actual * 0.3 },
                            { name: 'Analytics', actual: actual * 0.2 },
                            { name: 'AI', actual: actual * 0.1 }
                        ]
                    }
                }),
                services: accountInputs.flatMap((account, index) => [
                    { id: `sample-service-${index}-1`, tpid: account.tpid, name: 'Azure SQL Database', pillar: 'Databases', previousDaily: 5200 + index * 100, currentDaily: 6400 - index * 700, isNew: false },
                    { id: `sample-service-${index}-2`, tpid: account.tpid, name: 'Microsoft Fabric', pillar: 'Analytics', previousDaily: 0, currentDaily: 1800 + index * 100, isNew: true }
                ]),
                subscriptions: [
                    { id: 'sample-subscription-1', tpid: '1000001', name: 'Grid production analytics', created: '2026-10-03', averageDaily: 1200 },
                    { id: 'sample-subscription-2', tpid: '1000002', name: 'Retail data innovation', created: '2026-10-07', averageDaily: 850 }
                ],
                sqlReclassification: [
                    { id: 'sample-sql-1', tpid: '1000002', workload: 'Arc-enabled SQL inventory', monthlyOpportunity: 4200, evidence: 'Synthetic validated inventory; licensing and credit eligibility require review.' }
                ]
            },
            conversion: {
                source: { name: 'Synthetic U2C history', status: 'complete', asOf: generatedAt, start: '2026-10-01', end, detail: 'Historical starting cohort, conversion events and shifted-out dates; not inferred from today’s commitment state.' },
                accounts: accountInputs.map((account, index) => ({
                    tpid: account.tpid, territory: 'Sample territory',
                    startingMonthly: 100_000 - index * 10_000,
                    convertedMonthly: 42_000 - index * 6000,
                    inQuarterMonthly: 35_000 - index * 5000,
                    shiftedOutMonthly: 7000 - index * 1000,
                    startingCount: 10 - index, convertedCount: 5 - index
                }))
            }
        }
    })
}
