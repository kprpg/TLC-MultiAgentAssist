/**
 * Pure, node-free helpers that turn an opportunity's milestones into MCEM progression
 * signals. Shared by the deterministic evaluator and the sample generators so every
 * surface produces the same milestone-grounded, role-based recommendations.
 *
 * Attention is derived only from deterministic milestone state (status and customer
 * commitment); the target date is surfaced descriptively but never used as a trigger,
 * which keeps the signal stable regardless of the current clock.
 */

export interface MilestoneSignalInput {
  name: string
  status?: string | undefined
  commitment?: string | undefined
  targetDate?: string | undefined
  owner?: string | undefined
}

export interface MilestoneAttention {
  name: string
  status: string
  commitment: string | undefined
  targetDate: string | undefined
  reasons: string[]
  ownerRole: string
  confidence: 'high' | 'medium'
  severity: number
}

export interface MilestoneSummary {
  total: number
  attention: MilestoneAttention[]
  headline: string
}

export interface MilestoneRecommendation {
  id: string
  action: string
  ownerRole: string
  rationale: string
  evidenceIds: string[]
  assumption: boolean
  confidence: 'high' | 'medium' | 'low'
}

const RISK_STATUSES = new Set(['at risk', 'blocked'])
const UNCOMMITTED = 'uncommitted'
const MAX_ATTENTION = 3

function slug(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned : 'item'
}

function evaluateMilestone(milestone: MilestoneSignalInput): MilestoneAttention | undefined {
  const status = milestone.status?.trim() || 'In Progress'
  const normalizedStatus = status.toLowerCase()
  const normalizedCommitment = milestone.commitment?.trim().toLowerCase()
  const reasons: string[] = []
  let severity = 0

  if (normalizedStatus === 'blocked') {
    reasons.push('status is Blocked')
    severity += 3
  } else if (RISK_STATUSES.has(normalizedStatus)) {
    reasons.push(`status is ${status}`)
    severity += 2
  }

  if (normalizedCommitment === UNCOMMITTED) {
    reasons.push('customer commitment is Uncommitted')
    severity += 2
  }

  if (reasons.length === 0) return undefined

  const ownerRole = RISK_STATUSES.has(normalizedStatus) ? 'Solution Engineer' : 'Account Executive'
  const confidence: 'high' | 'medium' = normalizedStatus === 'blocked' ? 'high' : 'medium'

  return {
    name: milestone.name,
    status,
    commitment: milestone.commitment,
    targetDate: milestone.targetDate,
    reasons,
    ownerRole,
    confidence,
    severity
  }
}

/** Derives the milestones that threaten stage progression, ordered by severity. */
export function summarizeMilestones(milestones: readonly MilestoneSignalInput[]): MilestoneSummary {
  const attention = milestones
    .map((milestone) => evaluateMilestone(milestone))
    .filter((item): item is MilestoneAttention => item !== undefined)
    .sort((left, right) => right.severity - left.severity)
    .slice(0, MAX_ATTENTION)

  const headline = attention.length === 0
    ? ''
    : `${attention.length} of ${milestones.length} milestone${milestones.length === 1 ? '' : 's'} need attention: ${attention
        .map((item) => `${item.name} (${item.reasons.join('; ')})`)
        .join(', ')}.`

  return { total: milestones.length, attention, headline }
}

/** Builds role-owned, milestone-grounded recommendations from a milestone summary. */
export function milestoneRecommendations(summary: MilestoneSummary, evidenceIds: readonly string[]): MilestoneRecommendation[] {
  return summary.attention.map((item, index) => {
    const targetClause = item.targetDate ? `, target ${item.targetDate}` : ''
    const commitmentClause = item.commitment ? `, commitment ${item.commitment}` : ''
    return {
      id: `recommendation-milestone-${slug(item.name)}-${index + 1}`,
      action: `Resolve milestone "${item.name}" (${item.reasons.join('; ')}): confirm the owner, mitigation, and customer commitment, then update MSX.`,
      ownerRole: item.ownerRole,
      rationale: `Milestone "${item.name}" is ${item.status}${commitmentClause}${targetClause}, which puts the current MCEM stage at risk until it is resolved.`,
      evidenceIds: [...evidenceIds],
      assumption: false,
      confidence: item.confidence
    }
  })
}
