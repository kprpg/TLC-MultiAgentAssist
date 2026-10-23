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
  const evidenceSection = formatEvidenceSection(context)
  return [
    '## Summary', '', headline[capability], '',
    `> Requested: ${context.request.prompt}`, '',
    '## Context used', '',
    `**Opportunity:** ${opportunity.name}`,
    `**Owner:** ${opportunity.owner ?? 'Account team'}`,
    `**Recorded / evidence-based stage:** ${evaluation.recordedStage} / ${evaluation.evidenceBasedStage}`,
    `**MCEM guidance:** ${context.guidance.title}`, '',
    '## Exit criteria', '', criteria, '',
    ...(evidenceSection ? [evidenceSection, ''] : []),
    '## Recommended actions', '',
    '| Owner | Action | Confidence |', '| --- | --- | --- |', recommendations, '',
    '## Assumptions and missing information', '', missing
  ].join('\n')
}

/** Newest dated comments and activities plus staleness signals, so the draft reflects the evidence pack. */
function formatEvidenceSection(context: AgentTaskContext): string | undefined {
  const pack = context.evidence
  if (!pack) return undefined
  const entries = [
    ...pack.opportunity.commentHistory, ...pack.opportunity.notes, ...pack.opportunity.activities,
    ...pack.milestones.flatMap((milestone) => [...milestone.commentHistory, ...milestone.activities])
  ].filter((entry) => entry.ageDays !== undefined && entry.text)
    .sort((left, right) => (left.ageDays ?? 0) - (right.ageDays ?? 0))
    .slice(0, 5)
  const { signals } = pack
  const lines = [
    `- Milestones: ${signals.openMilestones} open, ${signals.overdueMilestones} overdue, ${signals.atRiskOrBlockedMilestones} at risk or blocked, ${signals.uncommittedOpenMilestones} uncommitted.`,
    ...(signals.daysSinceLastComment === undefined ? [] : [`- Last comment: ${signals.daysSinceLastComment} day${signals.daysSinceLastComment === 1 ? '' : 's'} ago.`]),
    ...(signals.daysSinceLastActivity === undefined ? [] : [`- Last activity: ${signals.daysSinceLastActivity} day${signals.daysSinceLastActivity === 1 ? '' : 's'} ago.`]),
    ...entries.map((entry) => `- \`${entry.ref}\` (${entry.ageDays}d ago${entry.author ? `, ${entry.author}` : ''}): ${entry.text!.replace(/\s+/g, ' ').slice(0, 200)}`),
    ...pack.coverage.gaps.map((gap) => `- Not available: ${gap}`)
  ]
  return ['## Recent evidence', '', ...lines].join('\n')
}
