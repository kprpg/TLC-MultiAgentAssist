import type { AgentCapability } from '../../../../packages/common/index.js'
import type { AgentTaskContext } from '../../../../packages/orchestrator/index.js'

const capabilitySummary: Record<AgentCapability, (context: AgentTaskContext) => string> = {
    'account-pulse': (context) => `Focus this week on ${context.opportunityContext.opportunity.name} and close the highest-priority Stage ${context.guidance.stage} evidence gaps.`,
    'mcem-coach': (context) => context.localEvaluation.summary,
    'pursuit-executive': (context) => `Prepare the pursuit for ${context.opportunityContext.opportunity.name} around its Stage ${context.guidance.stage} gaps and customer commitments.`,
    'risk-solution-play': (context) => `${context.opportunityContext.opportunity.name} has ${context.localEvaluation.recommendations.length} progression risk${context.localEvaluation.recommendations.length === 1 ? '' : 's'} requiring action.`
}

export function buildSampleAgentResponse(capability: AgentCapability, context: AgentTaskContext): string {
    const { account, opportunity } = context.opportunityContext
    const criteria = context.localEvaluation.criteria
        .map((criterion) => `- **${criterion.label}: ${criterion.status}** - ${criterion.rationale}`)
        .join('\n')
    const recommendations = context.localEvaluation.recommendations
        .map((recommendation) => `| ${recommendation.ownerRole} | ${recommendation.action} | ${recommendation.confidence} |`)
        .join('\n')
    const missingInformation = context.localEvaluation.missingData.length > 0
        ? context.localEvaluation.missingData.join('; ')
        : 'No criterion evidence is missing; partially supported criteria still require confirmation.'

    return `## Summary

${capabilitySummary[capability](context)}

## Context used

**Opportunity:** ${opportunity.name}
**Account:** ${account.name}
**Recorded / evidence-based stage:** ${opportunity.recordedStage} / ${context.localEvaluation.evidenceBasedStage}

## Exit criteria

${criteria}

## Recommended actions

| Owner | Action | Confidence |
| --- | --- | --- |
${recommendations}

## Sources

Sanitized MSX sample evidence; ${context.guidance.title}, version ${context.guidance.version}.

## Assumptions and missing information

${missingInformation} External signals are unavailable in sample mode.

## Feedback prompt

Was this ${capability.replaceAll('-', ' ')} guidance actionable?`
}