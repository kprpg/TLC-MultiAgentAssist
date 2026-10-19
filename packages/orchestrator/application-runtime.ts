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
import type { MeetingTranscript } from '../common/contracts/meeting.js'
import type { MeetingTranscriptSummary } from '../common/contracts/meeting.js'
import { GraphMeetingConnector, type GraphAcquisitionResult } from '../connectors/graph/meetings.js'
import { createSellerDashboardHost, type SellerDashboardHost } from './seller-dashboard.js'
import type { MeetingAcquisitionRequest } from './collaboration/meeting-acquisition.js'

type MeetingConnector = Pick<LiveMeetingCaptureConnector, 'proposeMeetingChangeSet' | 'applyMeetingChangeSet'>
export interface ApplicationServices {
  orchestrator: ThinSliceOrchestrator
  workflows: WorkflowHost
  sellerDashboard: SellerDashboardHost
  meetings: MeetingConnector
  proposeTranscript(opportunityId: string, transcript: MeetingTranscript): ReturnType<MeetingConnector['proposeMeetingChangeSet']>
  acquireTranscripts(request: MeetingAcquisitionRequest): Promise<GraphAcquisitionResult>
  resolveMeeting(joinUrl: string): Promise<string>
  listTranscriptSources(opportunityId: string): Promise<MeetingTranscriptSummary[]>
  workflowScopes: Map<string, { accountIds: string[]; opportunityIds: string[] }>
  refreshSource(): void
  withReviewedVersions<T>(before: unknown, operation: () => Promise<T>): Promise<T>
  dispose(): Promise<void>
}

function assemble(msx: MsxConnector, guidance: McemGuidanceConnector, agents: TaskAgentRegistry, recordCreation: RecordCreationService, meetings: MeetingConnector, workflows: WorkflowHost, sellerDashboard: SellerDashboardHost, source: Pick<ApplicationServices, 'acquireTranscripts' | 'resolveMeeting' | 'listTranscriptSources'>, dispose: () => Promise<void>, refreshSource = () => {}): ApplicationServices {
  return {
    orchestrator: new ThinSliceOrchestrator(msx, guidance, agents, undefined, recordCreation),
    meetings, workflows, sellerDashboard, dispose, workflowScopes: new Map(), ...source,
    refreshSource,
    withReviewedVersions: (before, operation) => {
      const versions = before && typeof before === 'object' && 'revisionTokens' in before
        ? z.record(z.string(), z.string()).parse(before.revisionTokens) : {}
      return msx.withExpectedVersions ? msx.withExpectedVersions(versions, operation) : operation()
    },
    proposeTranscript: (opportunityId, transcript) => meetings.proposeMeetingChangeSet({ opportunityId, transcript })
  }
}

export async function createSampleApplicationServices(options: { dataPath?: string; workingDirectory?: string } = {}): Promise<ApplicationServices> {
  const store = new LocalStore(options.dataPath ? { path: options.dataPath } : {})
  const msx = new LocalStoreMsxConnector(store)
  const writer = msx.createRecordCreationWriter()
  const workflows = createSampleWorkflowHost(async () => {
    const accounts = await msx.listAccounts()
    const opportunities = (await Promise.all(accounts.map((account) => msx.listOpportunities(account.id)))).flat()
    return { accountIds: accounts.map((account) => account.id), opportunityIds: opportunities.map((opportunity) => opportunity.id) }
  })
  return assemble(
    msx, new LocalPdfMcemGuidanceConnector(resolve(options.workingDirectory ?? process.cwd(), 'docs/knowledge/MCEM Overview.pdf')),
    createSampleTaskAgents(), new RecordCreationService(msx, writer, { writer }), msx, workflows,
    createSellerDashboardHost({ mode: 'sample', resolveUserEmail: async () => undefined }), {
      listTranscriptSources: (opportunityId) => msx.listMeetingTranscripts(opportunityId),
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
  const msx = new LiveMsxConnector(
    { getAccessToken: () => options.getToken('msx') }, options.fetchImplementation ?? fetch, `${options.msxResource}/api/data/v9.2/`,
    undefined, msxWriteMetadataFromEnvironment(options.environment), options.preferences, { cachePortfolio: false, requireConditionalWrites: true }
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
  const graph = new GraphMeetingConnector(() => options.getToken('graph'))
  return assemble(
    msx, new LocalPdfMcemGuidanceConnector(resolve(root, options.environment['TLC_MCEM_GUIDANCE_PATH'] ?? 'docs/knowledge/MCEM Overview.pdf')),
    foundry && options.foundryCredential ? createFoundryTaskAgents(foundry, options.foundryCredential) : createDeterministicLiveTaskAgents(),
    new RecordCreationService(msx, msx), new LiveMeetingCaptureConnector(msx), configured.host,
    createSellerDashboardHost({ mode: 'live', allowLocalProfile: false, resolveUserEmail: async () => undefined }), {
      acquireTranscripts: (request) => graph.acquire(request),
      resolveMeeting: (url) => graph.resolveMeeting(url),
      listTranscriptSources: async () => { throw new Error('Live transcripts are discovered from the verified Graph meeting, not sample sources.') }
    }, configured.dispose, () => msx.refresh()
  )
}
