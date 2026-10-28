import { initialWorkflowOutputSchema, type InitialWorkflowOutput, type WorkflowRecordReference } from '../../common/contracts/workflow-output.js'
import type { WorkflowMembershipSnapshot, WorkflowResultsProjection } from '../../common/contracts/workflow-membership.js'
import type { WorkflowResultCard } from '../../common/contracts/workflows.js'
import { aggregateResultCard, ownerWorkloadQueue } from './aggregate-results.js'

const noMembership = 'You are not a member of this opportunity Deal Team or the applicable milestone team.'
const unknownMembership = 'Your team membership could not be verified. Refresh the result and try again.'
const noScope = 'Guidance requires an opportunity-scoped item.'

export function projectWorkflowOutput(
  output: InitialWorkflowOutput, filter: 'all' | 'mine', memberships?: WorkflowMembershipSnapshot
): WorkflowResultsProjection {
  const base = { contractVersion: '1.0' as const, filter, totalItems: output.queueItems.length }
  const unavailable = (state: 'unavailable' | 'legacy', message: string): WorkflowResultsProjection => ({
    ...base, state, message, visibleItems: filter === 'all' ? output.queueItems.length : 0,
    eligibility: output.queueItems.map((item) => ({ queueItemId: item.id, eligible: false, reason: message })),
    ...(filter === 'all' ? { output } : {})
  })
  if (!memberships) return unavailable('unavailable', unknownMembership)
  if (!output.projection) return unavailable('legacy', 'Run this Play again to verify membership for its saved result.')

  const dealTeams = new Set(memberships.dealTeamOpportunityIds.map(normalize))
  const milestoneOpportunities = new Set(memberships.milestoneTeamOpportunityIds.map(normalize))
  const milestoneTeams = new Set(memberships.milestoneTeamMilestoneIds.map(normalize))
  const member = (record: WorkflowRecordReference): boolean => {
    if (!record.opportunityId) return false
    if (dealTeams.has(normalize(record.opportunityId))) return true
    return record.kind === 'milestone'
      ? Boolean(record.milestoneId && milestoneTeams.has(normalize(record.milestoneId)))
      : milestoneOpportunities.has(normalize(record.opportunityId))
  }
  const records = output.projection.records
  const known = (record: WorkflowRecordReference) => Boolean(record.opportunityId && (record.kind !== 'milestone' || record.milestoneId))
  const byItem = new Map(records.filter((record) => record.queueItemId).map((record) => [record.queueItemId!, record]))
  const eligibility = output.queueItems.map((item) => {
    const record = byItem.get(item.id)
    const scopeMatches = record?.opportunityId && item.opportunityId
      && normalize(record.opportunityId) === normalize(item.opportunityId)
      && (!record.accountId || Boolean(item.accountId && normalize(record.accountId) === normalize(item.accountId)))
    const eligible = Boolean(item.accountId && item.opportunityId && record && scopeMatches && known(record) && member(record))
    return {
      queueItemId: item.id, eligible,
      reason: eligible ? '' : !item.accountId || !item.opportunityId ? noScope
        : !record || !known(record) || !scopeMatches ? unknownMembership : noMembership
    }
  })
  if (filter === 'all') return { ...base, state: 'ready', eligibility, visibleItems: output.queueItems.length, output }
  if (records.some((record) => !known(record))
    || output.queueItems.some((item) => item.opportunityId && !byItem.has(item.id))) {
    return unavailable('unavailable', unknownMembership)
  }
  const selected = records.filter(member)
  const selectedIds = new Set(eligibility.filter((item) => item.eligible).map((item) => item.queueItemId))
  const queueItems = output.workflowId === 'WF-009'
    ? ownerWorkloadQueue(selected, output.projection.maximumActiveItems ?? 20, output.card.evidenceIds)
    : output.queueItems.filter((item) => selectedIds.has(item.id))
  const indexes = new Set(selected.map((record) => record.cardIndex))
  let card: WorkflowResultCard
  switch (output.card.kind) {
    case 'record-table': card = { ...output.card, rows: output.card.rows.filter((_row, index) => indexes.has(index)) }; break
    case 'timeline': card = { ...output.card, events: output.card.events.filter((_event, index) => indexes.has(index)) }; break
    case 'exception-list': card = { ...output.card, exceptions: output.card.exceptions.filter((item) => selectedIds.has(item.id)) }; break
    case 'action-list': card = { ...output.card, actions: output.card.actions.filter((item) => selectedIds.has(item.id)) }; break
    case 'metric-strip':
      if (output.workflowId !== 'WF-008' && output.workflowId !== 'WF-009') {
        return unavailable('unavailable', 'Run this Play again to obtain membership-aware metric contributors.')
      }
      card = aggregateResultCard(output.workflowId, output.card.title, selected, queueItems.length, output.card.evidenceIds)
      break
  }
  const projected = initialWorkflowOutputSchema.parse({
    ...output, card, queueItems, projection: { ...output.projection, records: selected }
  })
  return { ...base, state: 'ready', eligibility, visibleItems: queueItems.length, output: projected }
}

function normalize(id: string): string { return id.toLowerCase() }
