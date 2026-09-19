import {
    accountSchema,
    agentTaskResponseSchema,
    contractVersion,
    mcemResponseSchema,
    mcemStageTransitionResultSchema,
    milestoneSchema,
    opportunitySchema,
    type Account,
    type AgentCapability,
    type AgentTaskResponse,
    type McemResponse,
    type McemStageTransitionResult,
    type Milestone,
    type MilestoneUpdate,
    type Opportunity,
    type OpportunityUpdate
} from '../../../packages/common/index.js'

/**
 * Sanitized sample dataset for the extension. No network calls are made in sample mode.
 * Every object is validated against the shared contract schema so the extension cannot
 * diverge from the desktop and web hosts.
 */

const roleByStage = ['Account Executive', 'Specialist / SSP', 'Solution Engineer', 'Cloud Solution Architect', 'CSAM']
const criteriaLabels = ['Customer outcome', 'Decision team', 'Technical validation', 'Business case', 'Next committed step']

const sampleAccounts: readonly Account[] = Object.freeze([
    accountSchema.parse({ id: 'account-contoso', name: 'Contoso Energy', segment: 'Strategic' }),
    accountSchema.parse({ id: 'account-fabrikam', name: 'Fabrikam Retail', segment: 'Enterprise' })
])

const sampleOpportunities: readonly Opportunity[] = Object.freeze([
    { id: 'opp-grid-modernization', accountId: 'account-contoso', name: 'Grid operations modernization', owner: 'Avery Johnson', recordedStage: 3, value: 4_200_000, currency: 'USD', closeDate: '2026-10-30' },
    { id: 'opp-cloud-security-readiness', accountId: 'account-contoso', name: 'Cloud security readiness', owner: 'Jordan Lee', recordedStage: 1, value: 900_000, currency: 'USD', closeDate: '2027-02-26' },
    { id: 'opp-data-estate-consolidation', accountId: 'account-contoso', name: 'Data estate consolidation', recordedStage: 2, value: 2_650_000, currency: 'USD', closeDate: '2027-01-29' },
    { id: 'opp-resilient-cloud-foundation', accountId: 'account-contoso', name: 'Resilient cloud foundation - ready to advance', recordedStage: 1, value: 1_450_000, currency: 'USD', closeDate: '2027-03-12' },
    { id: 'opp-ai-service', accountId: 'account-fabrikam', name: 'AI-assisted customer service', recordedStage: 2, value: 1_750_000, currency: 'USD', closeDate: '2026-12-18' },
    { id: 'opp-store-modernization', accountId: 'account-fabrikam', name: 'Connected store modernization', recordedStage: 1, value: 1_200_000, currency: 'USD', closeDate: '2027-03-19' },
    { id: 'opp-unified-commerce', accountId: 'account-fabrikam', name: 'Unified commerce platform', recordedStage: 3, value: 3_800_000, currency: 'USD', closeDate: '2026-12-11' },
    { id: 'opp-customer-data-platform', accountId: 'account-fabrikam', name: 'Customer data platform - ready to advance', owner: 'Morgan Lee', recordedStage: 2, value: 3_200_000, currency: 'USD', closeDate: '2027-01-15' }
].map((opportunity) => opportunitySchema.parse(opportunity)))

function offsetDate(isoDate: string, days: number): string {
    const date = new Date(`${isoDate}T00:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
}

// Each opportunity gets a distinct set of milestones so switching opportunities is visibly different.
const milestonePool: ReadonlyArray<{ key: string; name: string; dayOffset: number }> = [
    { key: 'discovery', name: 'Customer outcome validation', dayOffset: -150 },
    { key: 'technical', name: 'Technical validation workshop', dayOffset: -115 },
    { key: 'business-case', name: 'Business case sign-off', dayOffset: -80 },
    { key: 'security', name: 'Security and compliance review', dayOffset: -50 },
    { key: 'deployment', name: 'Deployment readiness gate', dayOffset: -20 }
]
const milestoneStatuses = ['On Track', 'At Risk', 'In Progress', 'Blocked', 'Completed']
const milestoneCommitments = ['Committed', 'Best case', 'Uncommitted']

const sampleMilestones: readonly Milestone[] = Object.freeze(sampleOpportunities.flatMap((opportunity, index) => {
    const count = 3 + (index % 2) // 3 or 4 milestones
    const start = index % milestonePool.length
    return Array.from({ length: count }, (_unused, position) => {
        const template = milestonePool[(start + position) % milestonePool.length]!
        return milestoneSchema.parse({
            id: `${opportunity.id}-${template.key}`,
            opportunityId: opportunity.id,
            name: template.name,
            status: milestoneStatuses[(index + position) % milestoneStatuses.length]!,
            targetDate: offsetDate(opportunity.closeDate, template.dayOffset),
            estimatedMonthlyUsage: opportunity.value / 12,
            owner: opportunity.owner ?? 'Account team',
            commitment: milestoneCommitments[(index + position) % milestoneCommitments.length]!
        })
    })
}))

export function listSampleAccounts(): Account[] {
    return structuredClone(sampleAccounts) as Account[]
}

// Mutable session store so stage transitions persist while the workbench is open.
const opportunityStore: Opportunity[] = structuredClone(sampleOpportunities) as Opportunity[]

export function listSampleOpportunities(accountId: string): Opportunity[] {
    return structuredClone(opportunityStore.filter((opportunity) => opportunity.accountId === accountId)) as Opportunity[]
}

export function listSampleMilestones(opportunityId: string): Milestone[] {
    return structuredClone(milestoneStore.filter((milestone) => milestone.opportunityId === opportunityId)) as Milestone[]
}

// Mutable milestone store so field edits persist while the workbench is open.
const milestoneStore: Milestone[] = structuredClone(sampleMilestones) as Milestone[]

export function updateSampleMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Milestone {
    const milestone = milestoneStore.find((item) => item.opportunityId === opportunityId && item.id === milestoneId)
    if (!milestone) throw new Error('Unknown sample milestone.')
    const { customerCommitment, ...rest } = update
    Object.assign(milestone, rest, customerCommitment !== undefined ? { commitment: customerCommitment } : {})
    return milestoneSchema.parse(structuredClone(milestone))
}

export function updateSampleOpportunity(opportunityId: string, update: OpportunityUpdate): Opportunity {
    const opportunity = opportunityStore.find((item) => item.id === opportunityId)
    if (!opportunity) throw new Error('Unknown sample opportunity.')
    opportunity.comments = update.comments
    return opportunitySchema.parse(structuredClone(opportunity))
}

export function findSampleOpportunity(opportunityId: string): Opportunity | undefined {
    const found = opportunityStore.find((opportunity) => opportunity.id === opportunityId)
    return found ? structuredClone(found) as Opportunity : undefined
}

export function transitionSampleStage(accountId: string, opportunityId: string, targetStage: number, reason?: string): McemStageTransitionResult {
    const opportunity = opportunityStore.find((item) => item.id === opportunityId && item.accountId === accountId)
    if (!opportunity) throw new Error('Unknown sample opportunity.')
    if (Math.abs(targetStage - opportunity.recordedStage) !== 1) throw new Error('MCEM stage changes must move to an adjacent stage.')
    const previousStage = opportunity.recordedStage
    const evaluation = buildSampleEvaluation(opportunity)
    const advancing = targetStage > previousStage
    const hasGaps = evaluation.criteria.some((criterion) => criterion.status !== 'met')
    if ((!advancing || hasGaps) && !reason?.trim()) {
        throw new Error(advancing ? 'An exception reason is required to advance with open criteria.' : 'A recycle reason is required.')
    }
    const disposition = advancing ? (hasGaps ? 'override' : 'advanced') : 'recycled'
    const auditNote = `[MCEM sample transition] Stage ${previousStage} -> Stage ${targetStage}; disposition: ${disposition}.${reason ? ` Reason: ${reason.trim()}` : ''}`
    opportunity.recordedStage = targetStage
    opportunity.comments = [opportunity.comments, auditNote].filter(Boolean).join('\n\n')
    return mcemStageTransitionResultSchema.parse({ opportunity: structuredClone(opportunity), previousStage, targetStage, disposition, auditNote })
}

export function sampleStageOwner(stage: number): string {
    return roleByStage[stage - 1] ?? 'Account team'
}

function accountName(accountId: string): string {
    return sampleAccounts.find((account) => account.id === accountId)?.name ?? accountId
}

export function buildSampleEvaluation(opportunity: Opportunity, now: () => string = () => new Date().toISOString()): McemResponse {
    const readyToAdvance = opportunity.name.includes('ready to advance')
    const evidenceBasedStage = readyToAdvance ? Math.min(5, opportunity.recordedStage + 1) : Math.max(1, opportunity.recordedStage - 1)
    const generatedAt = now()
    const evidenceIds = [`sample-msx-${opportunity.id}`, `sample-mcem-stage-${opportunity.recordedStage}`]
    return mcemResponseSchema.parse({
        contractVersion,
        correlationId: '30000000-0000-4000-8000-000000000001',
        capability: 'mcem-coach',
        agentVersion: 'vscode-sample-v1',
        generatedAt,
        mode: 'sample',
        state: readyToAdvance ? 'complete' : 'partial',
        summary: readyToAdvance
            ? `Completed Stage ${opportunity.recordedStage} exit criteria support progression to Stage ${evidenceBasedStage}.`
            : `The opportunity is recorded at Stage ${opportunity.recordedStage}; current sample evidence supports Stage ${evidenceBasedStage}.`,
        recordedStage: opportunity.recordedStage,
        evidenceBasedStage,
        criteria: criteriaLabels.map((label, index) => ({
            id: `criterion-${index + 1}`,
            label,
            status: readyToAdvance || index < 2 ? 'met' : index === 2 ? 'partial' : 'missing',
            rationale: readyToAdvance
                ? `${label} evidence is documented and customer validated.`
                : index < 2 ? `${label} evidence is documented.` : `${label} requires customer confirmation.`,
            evidenceIds
        })),
        recommendations: readyToAdvance ? [{
            id: 'advance-stage',
            action: `Confirm progression to Stage ${evidenceBasedStage} with the customer and update MSX.`,
            ownerRole: sampleStageOwner(opportunity.recordedStage),
            rationale: 'All current-stage exit criteria are represented in this sanitized sample.',
            evidenceIds,
            assumption: false,
            confidence: 'high'
        }] : [
            { id: 'validate-technical', action: 'Schedule a customer validation session for the open technical criterion.', ownerRole: 'Solution Engineer', rationale: 'Technical validation remains partial in sample evidence.', evidenceIds, assumption: false, confidence: 'high' },
            { id: 'confirm-business-case', action: 'Confirm the quantified business case and economic buyer.', ownerRole: 'Specialist / SSP', rationale: 'The business case is not yet supported in sample evidence.', evidenceIds, assumption: false, confidence: 'medium' }
        ],
        missingData: readyToAdvance ? [] : ['Validated business case', 'Customer-confirmed next step'],
        evidence: [
            { id: evidenceIds[0]!, source: 'msx', recordId: opportunity.id, title: 'Sanitized MSX opportunity snapshot', url: `https://example.com/sample/msx/${opportunity.id}`, retrievedAt: generatedAt, accessContext: 'sample', quality: 'observed', excerpt: 'Static VS Code sample data; no live MSX request was made.' },
            { id: evidenceIds[1]!, source: 'mcem', recordId: `stage-${opportunity.recordedStage}`, title: `MCEM Stage ${opportunity.recordedStage} guidance`, url: `https://example.com/sample/mcem/stage-${opportunity.recordedStage}`, retrievedAt: generatedAt, accessContext: 'sample', quality: 'authoritative', excerpt: 'Versioned stage criteria used for the sample evaluation.' }
        ],
        sourceHealth: [
            { source: 'msx', state: 'sample', detail: 'Sanitized static sample.', checkedAt: generatedAt },
            { source: 'mcem', state: 'sample', detail: 'Bundled sample guidance.', checkedAt: generatedAt }
        ]
    })
}

export function buildSampleAgentResponse(
    capability: AgentCapability,
    opportunity: Opportunity,
    prompt: string,
    now: () => string = () => new Date().toISOString()
): AgentTaskResponse {
    const generatedAt = now()
    const evaluation = buildSampleEvaluation(opportunity, now)
    const summaryByCapability: Record<AgentCapability, string> = {
        'account-pulse': `Focus this week on ${opportunity.name}: close the highest-priority Stage ${evaluation.recordedStage} evidence gaps and confirm the next customer commitment.`,
        'mcem-coach': evaluation.summary,
        'pursuit-executive': `Prepare the pursuit for ${opportunity.name} around its Stage ${evaluation.recordedStage} gaps, decision team, and customer commitments.`,
        'risk-solution-play': `${opportunity.name} has ${evaluation.recommendations.length} progression risk${evaluation.recommendations.length === 1 ? '' : 's'} to resolve before Stage ${evaluation.evidenceBasedStage}.`
    }
    const criteria = evaluation.criteria.map((criterion) => `- **${criterion.label}: ${criterion.status}** - ${criterion.rationale}`).join('\n')
    const recommendations = evaluation.recommendations.map((recommendation) => `| ${recommendation.ownerRole} | ${recommendation.action} | ${recommendation.confidence} |`).join('\n')
    const missing = evaluation.missingData.length > 0
        ? evaluation.missingData.map((item) => `- ${item}`).join('\n')
        : '- No criterion evidence is missing; all current-stage exit criteria are supported.'
    const content = [
        '## Summary',
        '',
        summaryByCapability[capability],
        '',
        `> Requested: ${prompt}`,
        '',
        '## Context used',
        '',
        `**Opportunity:** ${opportunity.name}`,
        `**Account:** ${accountName(opportunity.accountId)}`,
        `**Owner:** ${opportunity.owner ?? 'Account team'}`,
        `**Recorded / evidence-based stage:** ${evaluation.recordedStage} / ${evaluation.evidenceBasedStage}`,
        '',
        '## Exit criteria',
        '',
        criteria,
        '',
        '## Recommended actions',
        '',
        '| Owner | Action | Confidence |',
        '| --- | --- | --- |',
        recommendations,
        '',
        '## Sources',
        '',
        `Sanitized MSX sample evidence; MCEM Stage ${evaluation.recordedStage} guidance.`,
        '',
        '## Assumptions and missing information',
        '',
        missing,
        '',
        '- Do not treat internal evidence as customer approval.'
    ].join('\n')
    return agentTaskResponseSchema.parse({
        contractVersion,
        correlationId: '30000000-0000-4000-8000-000000000002',
        capability,
        agentVersion: 'vscode-sample-v1',
        generatedAt,
        mode: 'sample',
        state: 'complete',
        content,
        sourceHealth: [{ source: 'msx', state: 'sample', detail: 'Sanitized static sample.', checkedAt: generatedAt }]
    })
}
