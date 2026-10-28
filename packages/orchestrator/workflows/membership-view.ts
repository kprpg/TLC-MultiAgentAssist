import {
  workflowMembershipSnapshotSchema, workflowResultsViewRequestSchema, workflowResultsViewSchema,
  type WorkflowMembershipSnapshot, type WorkflowResultsView
} from '../../common/contracts/workflow-membership.js'
import type { InitialWorkflowOutput } from '../../common/contracts/workflow-output.js'
import { workflowGuidanceRequestSchema, type WorkflowHost } from './host.js'
import { WorkflowRuntimeError } from './runtime.js'
import { projectWorkflowOutput } from './membership-projection.js'

interface ResultSource { get(request: unknown): { output?: InitialWorkflowOutput | undefined } }
type ReadMemberships = () => Promise<WorkflowMembershipSnapshot>

export async function readWorkflowResultsView(host: ResultSource, readMemberships: ReadMemberships, rawRequest: unknown): Promise<WorkflowResultsView> {
  const request = workflowResultsViewRequestSchema.parse(rawRequest)
  const view = host.get({ contractVersion: '1.0', runId: request.runId })
  if (!view.output) return workflowResultsViewSchema.parse({
    contractVersion: '1.0', runId: request.runId, filter: request.filter, state: 'pending',
    totalItems: 0, visibleItems: 0, eligibility: []
  })
  let memberships: WorkflowMembershipSnapshot | undefined
  try { memberships = workflowMembershipSnapshotSchema.parse(await readMemberships()) }
  catch { console.warn('[workflow-membership] read-unavailable') }
  return workflowResultsViewSchema.parse({
    ...projectWorkflowOutput(view.output, request.filter, memberships), runId: request.runId
  })
}

export async function prepareMemberWorkflowGuidance(
  host: ResultSource & Pick<WorkflowHost, 'prepareGuidance'>, readMemberships: ReadMemberships, rawRequest: unknown
) {
  const request = workflowGuidanceRequestSchema.parse(rawRequest)
  const view = await readWorkflowResultsView(host, readMemberships, {
    contractVersion: '1.0', runId: request.runId, filter: 'all'
  })
  const item = view.eligibility.find((candidate) => candidate.queueItemId === request.queueItemId)
  if (!item?.eligible) throw new WorkflowRuntimeError(
    'membership_required', item?.reason || 'Current team membership is required before preparing queue Guidance.'
  )
  return host.prepareGuidance(request)
}
