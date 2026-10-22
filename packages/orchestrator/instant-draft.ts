import type { AgentCapability } from '../common/index.js'
import type { AgentTaskContext } from './index.js'

/** Deterministic, evidence-only guidance built from the local MCEM evaluation. No model call; renders instantly. */
export function formatLiveAgentGuidance(capability: AgentCapability, context: AgentTaskContext): string {
  const evaluation = context.localEvaluation
  const opportunity = context.opportunityContext.opportunity
  const headline: Record<AgentCapability, string> = {
    'account-pulse': `Focus for ${opportunity.name}: close the highest-priority Stage ${evaluation.recordedStage} evidence gaps and confirm the next customer commitment.`,
    'mcem-coach': evaluation.summary,
    'pursuit-executive': `Prepare the pursuit for ${opportunity.name} around its Stage ${evaluation.recordedStage} gaps, decision team, and customer commitments.`,
    'risk-solution-play': `${opportunity.name} has ${evaluation.recommendations.length} progression risk${evaluation.recommendations.length === 1 ? '' : 's'} to resolve before Stage ${evaluation.evidenceBasedStage}.`
  }
  const criteria = evaluation.criteria.map((criterion) => `- **${criterion.label}: ${criterion.status}** — ${criterion.rationale}`).join('\n')
  const recommendations = evaluation.recommendations.map((recommendation) => `| ${recommendation.ownerRole} | ${recommendation.action} | ${recommendation.confidence} |`).join('\n')
  const missing = evaluation.missingData.length > 0
    ? evaluation.missingData.map((item) => `- ${item}`).join('\n')
    : '- All current-stage exit criteria have supporting evidence.'
  return [
    '## Summary', '', headline[capability], '',
    `> Requested: ${context.request.prompt}`, '',
    '## Context used', '',
    `**Opportunity:** ${opportunity.name}`,
    `**Owner:** ${opportunity.owner ?? 'Account team'}`,
    `**Recorded / evidence-based stage:** ${evaluation.recordedStage} / ${evaluation.evidenceBasedStage}`,
    `**MCEM guidance:** ${context.guidance.title}`, '',
    '## Exit criteria', '', criteria, '',
    '## Recommended actions', '',
    '| Owner | Action | Confidence |', '| --- | --- | --- |', recommendations, '',
    '## Assumptions and missing information', '', missing
  ].join('\n')
}
