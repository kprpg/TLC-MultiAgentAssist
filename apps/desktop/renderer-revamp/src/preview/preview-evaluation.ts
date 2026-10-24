import { contractVersion, type McemResponse, type Milestone, type Opportunity } from '../../../../../packages/common/contracts/index.js'
import { additionalSampleObservationsByOpportunity } from '../../../../../packages/common/fixtures/additional-sample-portfolio.js'
import { milestoneRecommendations, summarizeMilestones } from '../../../../../packages/agents/mcem-coach/src/milestone-signals.js'

// Static-preview isolation zone: this folder may use agent/orchestrator sample helpers that the
// live renderer must not. Nothing outside the standalone preview client should import from it.
const criteriaLabels = ['Customer outcome', 'Decision team', 'Technical validation', 'Business case', 'Next committed step']
const criteriaIds = ['customer-outcome', 'decision-team', 'technical-validation', 'business-case', 'next-step'] as const

export function buildPreviewEvaluation(
    opportunity: Opportunity,
    opportunityMilestones: readonly Milestone[],
    roleByStage: readonly string[]
): McemResponse {
    const readyToAdvance = opportunity.name.includes('ready to advance')
    const sharedObservations = additionalSampleObservationsByOpportunity[opportunity.id]
    const evidenceBasedStage = readyToAdvance ? Math.min(5, opportunity.recordedStage + 1) : Math.max(1, opportunity.recordedStage - 1)
    const generatedAt = new Date().toISOString()
    const evidenceIds = [`web-msx-${opportunity.id}`, `web-mcem-stage-${opportunity.recordedStage}`]
    const milestoneSummary = summarizeMilestones(opportunityMilestones)
    const milestoneRecs = milestoneRecommendations(milestoneSummary, evidenceIds)
    const baseSummary = readyToAdvance
        ? `Completed Stage ${opportunity.recordedStage} exit criteria support progression to Stage ${evidenceBasedStage}.`
        : `The opportunity is recorded at Stage ${opportunity.recordedStage}; current sample evidence supports Stage ${evidenceBasedStage}.`
    const baseRecommendations: McemResponse['recommendations'] = readyToAdvance ? [{
        id: 'advance-stage',
        action: `Confirm progression to Stage ${evidenceBasedStage} with the customer and update MSX.`,
        ownerRole: roleByStage[opportunity.recordedStage - 1] ?? 'Account Executive',
        rationale: 'All current-stage exit criteria are represented in this sanitized sample.',
        evidenceIds,
        assumption: false,
        confidence: 'high'
    }] : [
        { id: 'validate-technical', action: 'Schedule a customer validation session for the open technical criterion.', ownerRole: 'Solution Engineer', rationale: 'Technical validation remains partial in sample evidence.', evidenceIds, assumption: false, confidence: 'high' },
        { id: 'confirm-business-case', action: 'Confirm the quantified business case and economic buyer.', ownerRole: 'Specialist / SSP', rationale: 'The business case is not yet supported in sample evidence.', evidenceIds, assumption: false, confidence: 'medium' }
    ]
    return {
        contractVersion,
        correlationId: '10000000-0000-4000-8000-000000000001',
        capability: 'mcem-coach',
        agentVersion: 'web-sample-v1',
        generatedAt,
        mode: 'sample',
        state: readyToAdvance ? 'complete' : 'partial',
        summary: milestoneSummary.headline ? `${baseSummary} ${milestoneSummary.headline}` : baseSummary,
        recordedStage: opportunity.recordedStage,
        evidenceBasedStage,
        criteria: criteriaLabels.map((label, index) => {
            const observation = sharedObservations?.find((item) => item.criterionId === criteriaIds[index])
            return {
                id: criteriaIds[index] ?? `criterion-${index + 1}`,
                label,
                status: observation?.status ?? (readyToAdvance || index < 2 ? 'met' : index === 2 ? 'partial' : 'missing'),
                rationale: observation?.detail ?? (readyToAdvance
                    ? `${label} evidence is documented and customer validated.`
                    : index < 2 ? `${label} evidence is documented.` : `${label} requires customer confirmation.`),
                evidenceIds
            }
        }),
        recommendations: [...baseRecommendations, ...milestoneRecs],
        missingData: sharedObservations
            ? sharedObservations.filter((observation) => observation.status !== 'met').map((observation) => observation.detail)
            : readyToAdvance ? [] : ['Validated business case', 'Customer-confirmed next step'],
        evidence: [
            { id: evidenceIds[0]!, source: 'msx', recordId: opportunity.id, title: 'Sanitized MSX opportunity snapshot', retrievedAt: generatedAt, accessContext: 'sample', quality: 'observed', excerpt: 'Static web preview data; no live MSX request was made.' },
            { id: evidenceIds[1]!, source: 'mcem', recordId: `stage-${opportunity.recordedStage}`, title: `MCEM Stage ${opportunity.recordedStage} guidance`, retrievedAt: generatedAt, accessContext: 'sample', quality: 'authoritative', excerpt: 'Versioned stage criteria used for the sample evaluation.' }
        ],
        sourceHealth: [
            { source: 'msx', state: 'sample', detail: 'Sanitized static sample.', checkedAt: generatedAt },
            { source: 'mcem', state: 'sample', detail: 'Bundled sample guidance.', checkedAt: generatedAt }
        ]
    }
}
