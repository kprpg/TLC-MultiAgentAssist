import { workflowOutput, workflowRun } from './revamp/workflow-fixtures.js'
import { projectWorkflowOutput } from '../../packages/orchestrator/workflows/membership-projection.js'
import type { WorkflowResultsView } from '../../packages/common/contracts/workflow-membership.js'
import type { InitialWorkflowOutput } from '../../packages/common/contracts/workflow-output.js'

export const membershipRun = workflowRun('WF-001', 'completed', 'complete')
export const membershipOutput: InitialWorkflowOutput = {
  ...workflowOutput(), contractVersion: '2.0',
  card: { kind: 'record-table', title: 'Membership result records', evidenceIds: ['evidence-1'],
    columns: ['Opportunity'], rows: [{ Opportunity: 'Member result record' }, { Opportunity: 'Nonmember result record' }] },
  queueItems: [
    { id: 'member-item', workflowId: 'WF-001', priority: 'P1', title: 'Review member queue item',
      accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', evidenceIds: ['evidence-1'], status: 'new' },
    { id: 'nonmember-item', workflowId: 'WF-001', priority: 'P1', title: 'Review nonmember queue item',
      accountId: 'account-fabrikam', opportunityId: 'opp-ai-service', evidenceIds: ['evidence-1'], status: 'new' }
  ],
  projection: { records: [
    { recordId: 'opp-grid-modernization', kind: 'opportunity', opportunityId: 'opp-grid-modernization',
      accountId: 'account-contoso', queueItemId: 'member-item', cardIndex: 0 },
    { recordId: 'opp-ai-service', kind: 'opportunity', opportunityId: 'opp-ai-service',
      accountId: 'account-fabrikam', queueItemId: 'nonmember-item', cardIndex: 1 }
  ] }
}

export function membershipView(filter: 'all' | 'mine', runId = membershipRun.runId): WorkflowResultsView {
  return {
    ...projectWorkflowOutput(membershipOutput, filter, {
      dealTeamOpportunityIds: ['opp-grid-modernization'], milestoneTeamOpportunityIds: [], milestoneTeamMilestoneIds: []
    }), runId
  }
}
