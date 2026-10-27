import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { TokenCredential } from '@azure/core-auth'
import { loadDataverseEntityMap, loadMcpServerRegistry, loadMcpToolPolicy } from '../common/index.js'
import { loadFoundryEnvironmentFromEnvironment } from '../common/configuration/foundry-environment.js'
import type { PortfolioPreferenceStore, MsxConnector, McemGuidanceConnector } from '../connectors/common/index.js'
import { LocalStore, LocalStoreMsxConnector } from '../connectors/local-store/index.js'
import { LiveMeetingCaptureConnector, LiveMsxConnector, msxWriteMetadataFromEnvironment } from '../connectors/msx/index.js'
import { LocalPdfMcemGuidanceConnector } from '../connectors/sharepoint/index.js'
import { ThinSliceOrchestrator, type TaskAgentRegistry } from './index.js'
import { RecordCreationService } from './record-creation/service.js'
import { createLivePlayWorkflowHost, createSampleWorkflowHost, type WorkflowHost } from './workflows/index.js'
import { createDeterministicLiveTaskAgents, createFoundryTaskAgents, createSampleTaskAgents } from './task-agents.js'
import type { MeetingTranscript, MeetingType } from '../common/contracts/meeting.js'
import type { MeetingTranscriptSummary } from '../common/contracts/meeting.js'
import { GraphMeetingConnector, type GraphAcquisitionResult } from '../connectors/graph/meetings.js'
import { createSellerDashboardHost, type SellerDashboardHost } from './seller-dashboard.js'
import { createStagePipelineReviewHost, type StagePipelineReviewHost } from './stage-pipeline-review.js'
import { createSeReportingHost } from './se-reporting/composition.js'
import { createSampleSeReportingHost } from './se-reporting/sample.js'
import type { SeReportingHost, SeReportingOwner } from './se-reporting/host.js'
import type { SeReportingResource } from '../connectors/se-reporting/types.js'
import type { MeetingAcquisitionRequest } from './collaboration/meeting-acquisition.js'
import type { PerformanceReporter } from '../common/telemetry/performance.js'
import { bindSourceToken } from './mutations/core-adapter.js'
import { createKnowledgeSearch, type KnowledgeSearch } from './knowledge-search.js'
import type { SampleInference } from './sample-inference.js'

type MeetingConnector = Pick<LiveMeetingCaptureConnector, 'proposeMeetingChangeSet' | 'applyMeetingChangeSet'>
export interface ApplicationServices {
  performanceReporter?: PerformanceReporter
  orchestrator: ThinSliceOrchestrator
  workflows: WorkflowHost
  sellerDashboard: SellerDashboardHost
  seReporting: SeReportingHost
  stagePipelineReview: StagePipelineReviewHost
  meetings: MeetingConnector
  proposeTranscript(opportunityId: string, transcript: MeetingTranscript): ReturnType<MeetingConnector['proposeMeetingChangeSet']>
  acquireTranscripts(request: MeetingAcquisitionRequest): Promise<GraphAcquisitionResult>
  resolveMeeting(joinUrl: string): Promise<string>
  listTranscriptSources(opportunityId: string): Promise<MeetingTranscriptSummary[]>
  /** Live: the signed-in user's recent Teams meetings, from their own calendar. Sample: none (bundled transcripts are used). */
  listRecentMeetings(): Promise<MeetingTranscriptSummary[]>
  /** Verifies a listed meeting handle against the current calendar and returns its Graph meeting identity. */
  resolveRecentMeeting(handle: string): Promise<{ meetingId: string; meetingType: MeetingType }>
  workflowScopes: Map<string, { accountIds: string[]; opportunityIds: string[] }>
  refreshSource(): void
  withReadContext?<T>(operation: () => Promise<T>): Promise<T>
  withReviewedVersions<T>(before: unknown, operation: () => Promise<T>): Promise<T>
  dispose(): Promise<void>
}

function assemble(msx: MsxConnector, guidance: McemGuidanceConnector, agents: TaskAgentRegistry, recordCreation: RecordCreationService, meetings: MeetingConnector, workflows: WorkflowHost, sellerDashboard: SellerDashboardHost, seReporting: SeReportingHost, stagePipelineReview: StagePipelineReviewHost, knowledge: KnowledgeSearch, source: Pick<ApplicationServices, 'acquireTranscripts' | 'resolveMeeting' | 'listTranscriptSources' | 'listRecentMeetings' | 'resolveRecentMeeting'>, dispose: () => Promise<void>, refreshSource = () => {}, performanceReporter?: PerformanceReporter): ApplicationServices {
  return {
    ...(performanceReporter ? { performanceReporter } : {}),
    orchestrator: new ThinSliceOrchestrator(msx, guidance, agents, performanceReporter, recordCreation, knowledge),
    meetings, workflows, sellerDashboard, seReporting, stagePipelineReview, dispose, workflowScopes: new Map(), ...source,
    refreshSource,
    withReadContext: (operation) => msx.withReadContext ? msx.withReadContext(operation) : operation(),
    withReviewedVersions: (before, operation) => {
      const versions = before && typeof before === 'object' && 'revisionTokens' in before
        ? z.record(z.string(), z.string()).parse(before.revisionTokens) : {}
      return msx.withExpectedVersions ? msx.withExpectedVersions(versions, operation) : operation()
    },
    proposeTranscript: (opportunityId, transcript) => meetings.proposeMeetingChangeSet({ opportunityId, transcript })
  }
}

export async function createSampleApplicationServices(options: { dataPath?: string; workingDirectory?: string; inference?: SampleInference } = {}): Promise<ApplicationServices> {
  const store = new LocalStore(options.dataPath ? { path: options.dataPath } : {})
  const msx = new LocalStoreMsxConnector(store)
  const writer = msx.createRecordCreationWriter()
  const workflows = createSampleWorkflowHost(async () => {
    const { accounts, opportunities } = await msx.getPortfolioIndex()
    return { accountIds: accounts.map((account) => account.id), opportunityIds: opportunities.map((opportunity) => opportunity.id) }
  })
  return assemble(
    msx, new LocalPdfMcemGuidanceConnector(resolve(options.workingDirectory ?? process.cwd(), 'docs/knowledge/MCEM Overview.pdf')),
    options.inference?.taskAgents(createSampleTaskAgents()) ?? createSampleTaskAgents(), new RecordCreationService(msx, writer, { writer }),
    { proposeMeetingChangeSet: (request) => msx.proposeMeetingChangeSet(request, options.inference?.meetingExtractor()),
      applyMeetingChangeSet: (request) => msx.applyMeetingChangeSet(request) }, workflows,
    createSellerDashboardHost({ mode: 'sample', resolveUserEmail: async () => undefined }), createSampleSeReportingHost(options.inference ? { inference: options.inference } : {}),
    createStagePipelineReviewHost({ mode: 'sample' }),
    createKnowledgeSearch({ mode: 'sample' }), {
      listTranscriptSources: (opportunityId) => msx.listMeetingTranscripts(opportunityId),
      listRecentMeetings: async () => [],
      resolveRecentMeeting: async () => { throw new Error('Sample mode uses the bundled transcript picker, not calendar meetings.') },
      resolveMeeting: async () => { throw new Error('Sample mode uses the bundled transcript picker, not a live meeting URL.') },
      acquireTranscripts: async (request) => {
        const transcript = await msx.getMeetingTranscript(request.meetingId)
        if (!transcript || transcript.opportunityId !== request.opportunityId) {
          return { state: 'waiting', meetingId: request.meetingId, transcripts: [], attribution: 'unknown', contentVersions: {} }
        }
        return {
          state: 'ready', meetingId: request.meetingId, transcripts: [{ ...transcript, meetingType: request.meetingType }],
          attribution: transcript.segments.some((segment) => segment.speaker) ? 'attributed' : 'unattributed',
          contentVersions: { [transcript.id]: createHash('sha256').update(JSON.stringify(transcript)).digest('hex') }
        }
      }
    }, async () => { store.close() }
  )
}

export async function createLiveApplicationServices(options: {
  environment: NodeJS.ProcessEnv
  workingDirectory?: string
  msxResource: string
  getToken(resource: 'msx' | 'mcp' | 'graph'): Promise<string>
  preferences: PortfolioPreferenceStore
  foundryCredential?: TokenCredential
  guidanceMode?: 'foundry' | 'deterministic'
  fetchImplementation?: typeof fetch
  performanceReporter?: PerformanceReporter
  reportingIdentity?(): Promise<SeReportingOwner | undefined>
  getReportingToken?(resource: SeReportingResource): Promise<string>
  reportingFetcher?: typeof fetch
}): Promise<ApplicationServices> {
  const root = options.workingDirectory ?? process.cwd()
  const guidanceMode = options.guidanceMode ?? 'foundry'
  if (guidanceMode === 'foundry' && !options.foundryCredential) throw new Error('Foundry guidance requires its own configured credential.')
  const [foundry, registry, policy, entityMap] = await Promise.all([
    guidanceMode === 'foundry' ? loadFoundryEnvironmentFromEnvironment(options.environment, root) : undefined,
    loadMcpServerRegistry(resolve(root, 'config/mcp.servers.json')),
    loadMcpToolPolicy(resolve(root, 'config/mcp.tool-policy.json')),
    loadDataverseEntityMap(resolve(root, 'config/dataverse.entity-map.json'))
  ])
  const sourceToken = options.environment['TLC_BACKGROUND_SYNC'] === '1'
    ? bindSourceToken(() => options.getToken('msx'), options.msxResource) : () => options.getToken('msx')
  const msx = new LiveMsxConnector(
    { getAccessToken: sourceToken }, options.fetchImplementation ?? fetch, `${options.msxResource}/api/data/v9.2/`,
    options.performanceReporter, msxWriteMetadataFromEnvironment(options.environment), options.preferences, { cachePortfolio: false, requireConditionalWrites: true }
  )
  if (registry.servers.some((server) => server.enabled && new URL(server.serverUrl).origin !== options.msxResource)) {
    throw new Error('An enabled MCP server does not match the configured delegated MSX resource.')
  }
  const configured = createLivePlayWorkflowHost({
    registry, policy, entityMap,
    getAccessToken: () => options.getToken('mcp'),
    resolveCurrentUserId: () => msx.getCurrentUserId(),
    resolveExcludedAccountIds: () => msx.listAccounts({ includeHidden: true }).then((accounts) =>
      accounts.filter((account) => account.visibility === 'hidden').map((account) => account.id))
  })
  const graph = new GraphMeetingConnector(() => options.getToken('graph'), options.fetchImplementation)
  return assemble(
    msx, new LocalPdfMcemGuidanceConnector(resolve(root, options.environment['TLC_MCEM_GUIDANCE_PATH'] ?? 'docs/knowledge/MCEM Overview.pdf')),
    foundry && options.foundryCredential ? createFoundryTaskAgents(foundry, options.foundryCredential) : createDeterministicLiveTaskAgents(),
    new RecordCreationService(msx, msx), new LiveMeetingCaptureConnector(msx), configured.host,
    createSellerDashboardHost({ mode: 'live', allowLocalProfile: false, resolveUserEmail: async () => undefined }),
    createSeReportingHost({
      mode: 'live', identity: options.reportingIdentity ?? (async () => undefined), environment: options.environment, dataverse: msx,
      ...(options.getReportingToken ? { getToken: options.getReportingToken } : {}),
      ...(options.foundryCredential ? { foundryCredential: options.foundryCredential } : {}),
      ...(options.reportingFetcher ? { fetcher: options.reportingFetcher } : {})
    }), createStagePipelineReviewHost({ mode: 'live', source: msx }), createKnowledgeSearch({
      mode: 'live', environment: options.environment, getGraphToken: () => options.getToken('graph'),
      ...(options.fetchImplementation ? { fetcher: options.fetchImplementation } : {})
    }), {
      acquireTranscripts: (request) => graph.acquire(request),
      resolveMeeting: (url) => graph.resolveMeeting(url),
      listTranscriptSources: async () => { throw new Error('Live transcripts are discovered from the verified Graph meeting, not sample sources.') },
      listRecentMeetings: async () => (await graph.listRecentMeetings()).map((meeting) => ({
        id: meeting.handle, subject: meeting.subject, occurredAt: meeting.startsAt, meetingType: meeting.meetingType, source: 'teams' as const
      })),
      resolveRecentMeeting: async (handle) => {
        const meeting = await graph.resolveRecentMeeting(handle)
        return { meetingId: meeting.meetingId, meetingType: meeting.meetingType }
      }
    }, configured.dispose, () => msx.refresh(), options.performanceReporter
  )
}
