import { randomUUID } from 'node:crypto'
import { contractVersion, mcemResponseSchema, type McemResponse } from '../../../common/index.js'
import type { OpportunityContext, StageGuidance } from '../../../connectors/common/index.js'

export const mcemCoachVersion = '0.1.0'

export function evaluateMcemProgress(
  context: OpportunityContext,
  guidance: StageGuidance,
  correlationId = randomUUID()
): McemResponse {
  const msxEvidenceId = `msx-${context.opportunity.id}`
  const guidanceEvidenceId = `mcem-stage-${guidance.stage}`
  const observationExcerpt = context.observations
    .map((observation) => `${observation.criterionId}: ${observation.detail}`)
    .join(' ') || 'No criterion-level observations were available from MSX for this opportunity.'
  const observations = new Map(context.observations.map((observation) => [observation.criterionId, observation]))

  const criteria = guidance.criteria.map((criterion) => {
    const observation = observations.get(criterion.id)
    return {
      id: criterion.id,
      label: criterion.label,
      status: observation?.status ?? 'missing',
      rationale: observation?.detail ?? 'No supporting record was found.',
      evidenceIds: [msxEvidenceId, guidanceEvidenceId]
    }
  })

  const gaps = criteria.filter((criterion) => criterion.status !== 'met')
  const recommendations = gaps.map((gap) => {
    const criterion = guidance.criteria.find((candidate) => candidate.id === gap.id)
    if (!criterion) {
      throw new Error(`Guidance missing for criterion: ${gap.id}`)
    }
    return {
      id: `recommendation-${gap.id}`,
      action: criterion.actionWhenMissing,
      ownerRole: criterion.ownerRole,
      rationale: `${criterion.rationale} Current evidence: ${gap.rationale}`,
      evidenceIds: [msxEvidenceId, guidanceEvidenceId],
      assumption: false,
      confidence: gap.status === 'missing' ? 'high' as const : 'medium' as const
    }
  })

  const evidenceBasedStage = gaps.length === 0
    ? context.opportunity.recordedStage
    : Math.max(1, context.opportunity.recordedStage - 1)
  const generatedAt = new Date().toISOString()

  return mcemResponseSchema.parse({
    contractVersion,
    correlationId,
    capability: 'mcem-coach',
    agentVersion: mcemCoachVersion,
    generatedAt,
    mode: context.sourceHealth.state === 'live' ? 'live' : 'sample',
    state: 'complete',
    summary: evidenceBasedStage === context.opportunity.recordedStage
      ? `The available evidence supports recorded Stage ${context.opportunity.recordedStage}.`
      : `The opportunity is recorded at Stage ${context.opportunity.recordedStage}, while the available evidence supports Stage ${evidenceBasedStage}.`,
    recordedStage: context.opportunity.recordedStage,
    evidenceBasedStage,
    criteria,
    recommendations,
    missingData: criteria.filter((criterion) => criterion.status === 'missing').map((criterion) => criterion.label),
    evidence: [
      {
        id: msxEvidenceId,
        source: 'msx',
        recordId: context.opportunity.id,
        title: context.opportunity.name,
        url: `https://msx.microsoft.com/opportunity/${context.opportunity.id}`,
        retrievedAt: context.retrievedAt,
        accessContext: context.sourceHealth.state === 'live' ? 'delegated-user' : 'sample',
        quality: 'observed',
        excerpt: observationExcerpt
      },
      {
        id: guidanceEvidenceId,
        source: 'mcem',
        recordId: `stage-${guidance.stage}-${guidance.version}`,
        title: guidance.title,
        ...(guidance.sourceUrl ? { url: guidance.sourceUrl } : {}),
        retrievedAt: generatedAt,
        modifiedAt: `${guidance.effectiveDate}T00:00:00.000Z`,
        accessContext: 'sample',
        quality: 'authoritative',
        excerpt: `Version ${guidance.version}; ${guidance.criteria.map((criterion) => criterion.label).join(', ')}.`
      }
    ],
    sourceHealth: [context.sourceHealth, guidance.sourceHealth]
  })
}