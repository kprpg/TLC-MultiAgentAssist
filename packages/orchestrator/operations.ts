import { z } from 'zod'
import * as c from '../common/contracts/index.js'
import { seDomainSchema } from '../common/configuration/se-domains.js'
import {
  listWorkflowDefinitionsRequestSchema, startWorkflowHostRequestSchema, workflowRunRequestSchema,
  listWorkflowRunsRequestSchema, workflowGuidanceRequestSchema
} from './workflows/host.js'
import { workflowRunViewSchema } from './workflows/view-contracts.js'
import type { ApplicationServices } from './application-runtime.js'
import { workflowContractVersion } from '../common/contracts/workflows.js'
import { canonicalJson } from './collaboration/reviewed-actions.js'
import { sellerDashboardRequestSchema, sellerDashboardResponseSchema } from '../common/contracts/seller-dashboard.js'
import { seReportingRequestSchema, seReportingResponseSchema } from '../common/contracts/se-reporting.js'
import { measurePerformance } from '../common/telemetry/performance.js'
import type { ThinSliceOrchestrator } from './index.js'
import type { SyncMutationOperation } from '../common/contracts/cache-sync.js'

export class WorkflowScopeAuthorizationError extends Error {
  constructor() { super('Workflow source scope is unavailable or changed. Start a fresh workflow after verifying current access.'); this.name = 'WorkflowScopeAuthorizationError' }
}

export type EffectClass = 'read' | 'preference' | 'source'
export interface ApplicationOperation {
  effect: EffectClass
  startsWork: boolean
  parse(input: unknown): Record<string, unknown>
  run(input: unknown): Promise<unknown>
}
const id = z.string().min(1).max(200)
const opportunity = z.object({ opportunityId: id }).strict()
const milestone = opportunity.extend({ milestoneId: id }).strict()

function operation<I extends Record<string, unknown>, O>(input: z.ZodType<I>, output: z.ZodType<O>, invoke: (input: I) => O | Promise<O>, effect: EffectClass = 'read', startsWork = false): ApplicationOperation {
  return { effect, startsWork, parse: (raw) => input.parse(raw), run: async (raw) => output.parse(await invoke(input.parse(raw))) }
}

export function createCoreMutationOperations(core: ThinSliceOrchestrator, applyMeeting?: ApplicationServices['meetings']['applyMeetingChangeSet']): Record<SyncMutationOperation, ApplicationOperation> {
  return {
    addAccount: operation(z.object({ accountId: id }).strict(), c.accountSchema, (input) => core.addAccount(input.accountId), 'preference'),
    setAccountVisibility: operation(z.object({ accountId: id, visibility: z.enum(['visible', 'hidden']) }).strict(), c.accountSchema, (input) => core.setAccountVisibility(input.accountId, input.visibility), 'preference'),
    joinDealTeam: operation(opportunity.extend({ domain: seDomainSchema.optional() }).strict(), c.dealTeamJoinResultSchema, (input) => core.joinDealTeam(input.opportunityId), 'source'),
    leaveDealTeam: operation(opportunity, c.dealTeamLeaveResultSchema, (input) => core.leaveDealTeam(input.opportunityId), 'source'),
    joinMilestoneTeam: operation(milestone.extend({ domain: seDomainSchema.optional() }).strict(), c.milestoneTeamJoinResultSchema, (input) => core.joinMilestoneTeam(input.opportunityId, input.milestoneId), 'source'),
    leaveMilestoneTeam: operation(milestone, c.milestoneTeamLeaveResultSchema, (input) => core.leaveMilestoneTeam(input.opportunityId, input.milestoneId), 'source'),
    updateOpportunity: operation(opportunity.extend({ update: c.opportunityUpdateSchema.strict() }).strict(), c.opportunitySchema, (input) => core.updateOpportunity(input.opportunityId, input.update), 'source'),
    updateMilestone: operation(milestone.extend({ update: c.milestoneUpdateSchema }).strict(), c.milestoneSchema, (input) => core.updateMilestone(input.opportunityId, input.milestoneId, input.update), 'source'),
    createMilestoneActivity: operation(milestone.extend({ request: c.createMilestoneActivityRequestSchema }).strict(), c.milestoneActivitySchema, (input) => core.createMilestoneActivity(input.opportunityId, input.milestoneId, input.request), 'source'),
    transitionOpportunityStage: operation(c.mcemStageTransitionRequestSchema, c.mcemStageTransitionResultSchema, (input) => core.transitionOpportunityStage(input), 'source'),
    commitRecordCreation: operation(c.recordCreationCommitRequestSchema, c.recordCreationResultSchema, (input) => core.commitRecordCreation(input), 'source'),
    applyMeetingChangeSet: operation(z.object({ proposal: c.meetingChangeSetProposalSchema, approval: c.meetingChangeSetApprovalSchema }).strict(), c.meetingChangeSetResultSchema, (input) => {
      if (!applyMeeting) throw new Error('Meeting writes are unavailable in this source profile.')
      return applyMeeting(input)
    }, 'source')
  }
}

export function createApplicationOperations(services: ApplicationServices) {
  const core = services.orchestrator
  const workflows = services.workflows
  const operations: Record<string, ApplicationOperation> = {
    ...createCoreMutationOperations(core, (input) => services.meetings.applyMeetingChangeSet(input)),
    sellerDashboard: operation(sellerDashboardRequestSchema, sellerDashboardResponseSchema, (input) => services.sellerDashboard.invoke(input)),
    seReporting: operation(seReportingRequestSchema.refine((input) => !['run', 'publish'].includes(input.operation)), seReportingResponseSchema, (input) => services.seReporting.invoke(input)),
    seReportingRun: operation(seReportingRequestSchema.refine((input) => input.operation === 'run'), seReportingResponseSchema, (input) => services.seReporting.invoke(input), 'read', true),
    publishSeReporting: operation(seReportingRequestSchema.refine((input) => input.operation === 'publish'), seReportingResponseSchema, async (input) => {
      const response = await services.seReporting.invoke(input)
      if (response.kind === 'error') throw new Error(response.message)
      return response
    }, 'source'),
    listAccounts: operation(c.accountListOptionsSchema.strict(), z.array(c.accountSchema), (input) => core.listAccounts(input)),
    getPortfolioIndex: operation(c.portfolioReadRequestSchema, c.portfolioIndexSchema, (input) => core.getPortfolioIndex(input)),
    getPortfolioWorkspace: operation(c.portfolioWorkspaceRequestSchema, c.portfolioWorkspaceSchema, (input) => core.getPortfolioWorkspace(input)),
    getDiscoverySnapshot: operation(c.discoverySnapshotRequestSchema, c.discoverySnapshotSchema, (input) => core.getDiscoverySnapshot(input)),
    searchAccounts: operation(c.accountSearchRequestSchema.strict(), z.array(c.accountCandidateSchema), (input) => core.searchAccounts(input)),
    listOpportunities: operation(z.object({ accountId: id }).strict(), z.array(c.opportunitySchema), (input) => core.listOpportunities(input.accountId)),
    getOpportunityContext: operation(opportunity, z.object({ account: c.accountSchema, opportunity: c.opportunitySchema, milestones: z.array(c.milestoneSchema), revisionTokens: z.record(z.string(), z.string()).optional() }).strict(), (input) => core.getOpportunitySnapshot(input.opportunityId)),
    discoverOpportunities: operation(z.object({ domain: seDomainSchema }).strict(), z.array(c.discoverableOpportunitySchema), (input) => core.discoverOpportunities(input.domain)),
    listMilestones: operation(opportunity, z.array(c.milestoneSchema), (input) => core.listMilestones(input.opportunityId)),
    listDiscoverableMilestones: operation(opportunity, z.array(c.milestoneSchema), (input) => core.listDiscoverableMilestones(input.opportunityId)),
    listMilestoneActivities: operation(milestone, z.array(c.milestoneActivitySchema), (input) => core.listMilestoneActivities(input.opportunityId, input.milestoneId)),
    runMcemCoach: operation(c.mcemRequestSchema.strict(), c.mcemResponseSchema, (input) => core.runMcemCoach(input), 'read', true),
    runAgentTask: operation(c.agentTaskRequestSchema.strict(), c.agentTaskResponseSchema, (input) => core.runAgentTask(input), 'read', true),
    getRecordCreationCatalog: operation(c.recordCreationCatalogRequestSchema, c.recordCreationCatalogSchema, (input) => core.getRecordCreationCatalog(input)),
    previewRecordCreation: operation(c.recordCreationPreviewRequestSchema, c.recordCreationPreviewSchema, (input) => core.previewRecordCreation(input)),
    exportRecordCreationDraft: operation(c.recordCreationCommitRequestSchema, c.recordCreationDraftResultSchema, (input) => core.exportRecordCreationDraft(input)),
    'workflows.list': operation(listWorkflowDefinitionsRequestSchema, z.array(c.workflowDefinitionSchema), (input) => workflows.listDefinitions(input)),
    'workflows.start': operation(startWorkflowHostRequestSchema, c.workflowRunSchema, (input) => workflows.start(input), 'read', true),
    'workflows.get': operation(workflowRunRequestSchema, workflowRunViewSchema, (input) => workflows.get(input)),
    'workflows.cancel': operation(workflowRunRequestSchema, c.workflowRunSchema, (input) => workflows.cancel(input)),
    'workflows.history': operation(listWorkflowRunsRequestSchema, z.array(c.workflowRunSchema), (input) => workflows.listRuns(input)),
    'workflows.guidance': operation(workflowGuidanceRequestSchema, c.workflowGuidanceHandoffSchema, (input) => workflows.prepareGuidance(input), 'read', true)
  }
  function describe(name: string): ApplicationOperation {
    if (!Object.hasOwn(operations, name)) throw new Error('Unknown application operation.')
    return operations[name]!
  }
  async function workingSet() {
    const capture = async () => {
      const { accounts, opportunities } = await core.getPortfolioIndex({ contractVersion: c.portfolioReadVersion })
      return { accountIds: accounts.map((account) => account.id).sort(), opportunityIds: opportunities.map((opportunity) => opportunity.id).sort() }
    }
    return services.withReadContext ? services.withReadContext(capture) : capture()
  }
  async function verifyWorkflow(runId: string) {
    const captured = services.workflowScopes.get(runId)
    if (!captured || canonicalJson(captured) !== canonicalJson(await workingSet())) throw new WorkflowScopeAuthorizationError()
    const view = workflows.get({ contractVersion: workflowContractVersion, runId })
    if (view.output?.queueItems.some((item) => item.accountId && !captured.accountIds.includes(item.accountId)
      || item.opportunityId && !captured.opportunityIds.includes(item.opportunityId))) throw new WorkflowScopeAuthorizationError()
  }
  return {
    describe,
    names: () => Object.keys(operations),
    /** Progressive agent run; parses the request, validates every emitted event, and never throws for run outcomes. */
    async streamAgentTask(input: unknown, onEvent: (event: c.AgentTaskStreamEvent) => void, signal?: AbortSignal): Promise<void> {
      const request = c.agentTaskRequestSchema.strict().parse(input)
      services.refreshSource()
      await measurePerformance('operation.runAgentTaskStream', services.performanceReporter,
        () => core.runAgentTaskStream(request, (event) => onEvent(c.agentTaskStreamEventSchema.parse(event)), signal))
    },
    async invoke(name: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
      const entry = describe(name)
      return measurePerformance(`operation.${name}`, services.performanceReporter, async () => {
        signal?.throwIfAborted()
        services.refreshSource()
        if (name === 'workflows.start') {
          const request = entry.parse(input)
          const captured = await workingSet()
          const run = c.workflowRunSchema.parse(await entry.run(request))
          if (services.workflowScopes.size >= 100) services.workflowScopes.delete(services.workflowScopes.keys().next().value!)
          services.workflowScopes.set(run.runId, captured)
          return run
        }
        const read = async () => {
          if (name === 'workflows.get' || name === 'workflows.guidance') {
            const request = entry.parse(input)
            await verifyWorkflow(String(request['runId']))
          }
          return entry.run(input)
        }
        return entry.effect === 'read' && name !== 'workflows.cancel'
          ? core.withReadContext(read, signal) : entry.run(input)
      })
    },
    async snapshot(name: string, input: unknown): Promise<unknown> {
      services.refreshSource()
      const parsed = describe(name).parse(input)
      if (name === 'publishSeReporting') {
        const state = await services.seReporting.invoke({ contractVersion: '1.0', operation: 'get' })
        if (state.kind !== 'state' || !state.run || !state.publishPreview ||
            state.run.id !== parsed['runId'] || state.publishPreview.token !== parsed['token']) throw new Error('Prepare a fresh report publication review.')
        return { runId: state.run.id, profileId: state.run.profileId, ...state.publishPreview }
      }
      if (['joinDealTeam', 'joinMilestoneTeam'].includes(name) && parsed['domain']) {
        const domain = seDomainSchema.parse(parsed['domain'])
        const candidate = (await core.discoverOpportunities(domain)).find((entry) => entry.id === parsed['opportunityId'])
        if (!candidate) throw new Error('The opportunity is outside the current Discovery scope.')
        const milestones = await core.listDiscoverableMilestones(candidate.id)
        if (parsed['milestoneId'] && !milestones.some((entry) => entry.id === parsed['milestoneId'])) throw new Error('The milestone is outside the selected opportunity.')
        return { opportunity: candidate, milestones }
      }
      if (typeof parsed['opportunityId'] === 'string') return core.getOpportunitySnapshot(parsed['opportunityId'])
      if (name === 'applyMeetingChangeSet') {
        const proposal = c.meetingChangeSetProposalSchema.parse(parsed['proposal'])
        return core.getOpportunitySnapshot(proposal.opportunityId)
      }
      return core.listAccounts({ includeHidden: true })
    }
  }
}
export type ApplicationOperations = ReturnType<typeof createApplicationOperations>
