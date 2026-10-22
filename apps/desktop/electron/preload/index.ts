import { contextBridge, ipcRenderer } from 'electron'
import type { Account, AccountCandidate, AccountListOptions, AccountSearchRequest, AccountVisibility, AgentTaskRequest, AgentTaskResponse, AuthStatus, CreateMilestoneActivityRequest, DealTeamJoinResult, DealTeamLeaveResult, DesktopDataStatus, DiscoverableOpportunity, EmailComposeRequest, EmailComposeResult, ExportResponseRequest, ExportResponseResult, McemRequest, McemResponse, McemStageTransitionRequest, McemStageTransitionResult, MeetingChangeSetApproval, MeetingChangeSetProposal, MeetingChangeSetResult, MeetingTranscript, MeetingTranscriptSummary, MeetingType, Milestone, MilestoneActivity, MilestoneTeamJoinResult, MilestoneTeamLeaveResult, MilestoneUpdate, Opportunity, OpportunityUpdate, RecordCreationCatalog, RecordCreationCatalogRequest, RecordCreationPreview, RecordCreationPreviewRequest, RecordCreationCommitRequest, RecordCreationResult, RecordCreationDraftResult, SeDomainId } from '../../../../packages/common/index.js'
import type { WorkflowHostOperation } from '../../../../packages/orchestrator/workflows/index.js'
import type { VoiceRequest, VoiceResponse } from '../../../../packages/common/contracts/voice.js'
import type { SellerDashboardRequest, SellerDashboardResponse } from '../../../../packages/common/contracts/seller-dashboard.js'
import type { DiscoverySnapshot, DiscoverySnapshotRequest, PortfolioReadRequest, PortfolioIndex, PortfolioWorkspaceRequest, PortfolioWorkspace } from '../../../../packages/common/contracts/index.js'
import {
  cacheControlResponseSchema, mutationSyncResponseSchema, type CacheControlRequest, type CacheControlResponse,
  type MutationSyncRequest, type MutationSyncResponse, type CacheReadState
} from '../../../../packages/common/contracts/cache-sync.js'

export interface TlcDesktopApi {
  invokeMutationSync(request: MutationSyncRequest): Promise<MutationSyncResponse>
  cacheControl(request: CacheControlRequest): Promise<CacheControlResponse>
  onCacheChanged(listener: (state: CacheReadState) => void): () => void
  invokeSellerDashboard(request: SellerDashboardRequest): Promise<SellerDashboardResponse>
  invokeVoice(request: VoiceRequest): Promise<VoiceResponse>
  exitApplication(): Promise<void>
  getDataStatus(): Promise<DesktopDataStatus>
  connectMcem(): Promise<AuthStatus>
  listAccounts(options?: AccountListOptions): Promise<Account[]>
  getPortfolioIndex(request: PortfolioReadRequest): Promise<PortfolioIndex>
  getPortfolioWorkspace(request: PortfolioWorkspaceRequest): Promise<PortfolioWorkspace>
  getDiscoverySnapshot(request: DiscoverySnapshotRequest): Promise<DiscoverySnapshot>
  searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]>
  addAccount(accountId: string): Promise<Account>
  setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account>
  listOpportunities(accountId: string): Promise<Opportunity[]>
  getRecordCreationCatalog(request: RecordCreationCatalogRequest): Promise<RecordCreationCatalog>
  previewRecordCreation(request: RecordCreationPreviewRequest): Promise<RecordCreationPreview>
  commitRecordCreation(request: RecordCreationCommitRequest): Promise<RecordCreationResult>
  exportRecordCreationDraft(request: RecordCreationCommitRequest): Promise<RecordCreationDraftResult>
  discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]>
  joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult>
  leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult>
  joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult>
  leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult>
  listMilestones(opportunityId: string): Promise<Milestone[]>
  listDiscoverableMilestones(opportunityId: string): Promise<Milestone[]>
  listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]>
  createMilestoneActivity(opportunityId: string, milestoneId: string, request: CreateMilestoneActivityRequest): Promise<MilestoneActivity>
  listMeetingTranscripts(opportunityId?: string): Promise<MeetingTranscriptSummary[]>
  getMeetingTranscript(transcriptId: string): Promise<MeetingTranscript | null>
  proposeMeetingChangeSet(request: { opportunityId: string; transcriptId?: string; rawTranscript?: { content: string; format?: 'vtt' | 'text'; meetingType?: MeetingType } }): Promise<MeetingChangeSetProposal>
  applyMeetingChangeSet(proposal: MeetingChangeSetProposal, approval: MeetingChangeSetApproval): Promise<MeetingChangeSetResult>
  updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone>
  updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity>
  runMcemCoach(request: McemRequest): Promise<McemResponse>
  transitionOpportunityStage(request: McemStageTransitionRequest): Promise<McemStageTransitionResult>
  runAgentTask(request: AgentTaskRequest): Promise<AgentTaskResponse>
  /** Progressive run; events are delivered in order and always end with `complete` or `error`. Events are validated by the renderer. */
  runAgentTaskStream(request: AgentTaskRequest, onEvent: (event: unknown) => void): { cancel(): void; done: Promise<void> }
  openEmailCompose(request: EmailComposeRequest): Promise<EmailComposeResult>
  exportAgentResponse(request: ExportResponseRequest): Promise<ExportResponseResult>
  openEvidence(url: string): Promise<void>
  invokeWorkflow(operation: WorkflowHostOperation, request: unknown): Promise<unknown>
}

const api: TlcDesktopApi = {
  invokeMutationSync: async (request) => mutationSyncResponseSchema.parse(await ipcRenderer.invoke('tlc:mutation-sync', request)),
  cacheControl: async (request) => cacheControlResponseSchema.parse(await ipcRenderer.invoke('tlc:cache-control', request)),
  onCacheChanged: (listener) => {
    const changed = (_event: Electron.IpcRendererEvent, value: unknown) => { listener(cacheControlResponseSchema.parse(value).state) }
    ipcRenderer.on('tlc:cache-changed', changed)
    return () => { ipcRenderer.removeListener('tlc:cache-changed', changed) }
  },
  invokeSellerDashboard: (request) => ipcRenderer.invoke('tlc:seller-dashboard', request),
  invokeVoice: (request) => ipcRenderer.invoke('tlc:voice-input', request),
  exitApplication: () => ipcRenderer.invoke('tlc:exit-application'),
  getDataStatus: () => ipcRenderer.invoke('tlc:get-data-status'),
  connectMcem: () => ipcRenderer.invoke('tlc:connect-mcem'),
  listAccounts: (options) => ipcRenderer.invoke('tlc:list-accounts', options),
  getPortfolioIndex: (request) => ipcRenderer.invoke('tlc:portfolio-index', request),
  getPortfolioWorkspace: (request) => ipcRenderer.invoke('tlc:portfolio-workspace', request),
  getDiscoverySnapshot: (request) => ipcRenderer.invoke('tlc:discovery-snapshot', request),
  searchAccounts: (request) => ipcRenderer.invoke('tlc:search-accounts', request),
  addAccount: (accountId) => ipcRenderer.invoke('tlc:add-account', accountId),
  setAccountVisibility: (accountId, visibility) => ipcRenderer.invoke('tlc:set-account-visibility', accountId, visibility),
  listOpportunities: (accountId) => ipcRenderer.invoke('tlc:list-opportunities', accountId),
  getRecordCreationCatalog: (request) => ipcRenderer.invoke('tlc:get-record-creation-catalog', request),
  previewRecordCreation: (request) => ipcRenderer.invoke('tlc:preview-record-creation', request),
  commitRecordCreation: (request) => ipcRenderer.invoke('tlc:commit-record-creation', request),
  exportRecordCreationDraft: (request) => ipcRenderer.invoke('tlc:export-record-creation-draft', request),
  discoverOpportunities: (domain) => ipcRenderer.invoke('tlc:discover-opportunities', domain),
  joinDealTeam: (opportunityId) => ipcRenderer.invoke('tlc:join-deal-team', opportunityId),
  leaveDealTeam: (opportunityId) => ipcRenderer.invoke('tlc:leave-deal-team', opportunityId),
  joinMilestoneTeam: (opportunityId, milestoneId) => ipcRenderer.invoke('tlc:join-milestone-team', opportunityId, milestoneId),
  leaveMilestoneTeam: (opportunityId, milestoneId) => ipcRenderer.invoke('tlc:leave-milestone-team', opportunityId, milestoneId),
  listMilestones: (opportunityId) => ipcRenderer.invoke('tlc:list-milestones', opportunityId),
  listDiscoverableMilestones: (opportunityId) => ipcRenderer.invoke('tlc:list-discoverable-milestones', opportunityId),
  listMilestoneActivities: (opportunityId, milestoneId) => ipcRenderer.invoke('tlc:list-milestone-activities', opportunityId, milestoneId),
  createMilestoneActivity: (opportunityId, milestoneId, request) => ipcRenderer.invoke('tlc:create-milestone-activity', opportunityId, milestoneId, request),
  listMeetingTranscripts: (opportunityId) => ipcRenderer.invoke('tlc:list-meeting-transcripts', opportunityId),
  getMeetingTranscript: (transcriptId) => ipcRenderer.invoke('tlc:get-meeting-transcript', transcriptId),
  proposeMeetingChangeSet: (request) => ipcRenderer.invoke('tlc:propose-meeting-change-set', request),
  applyMeetingChangeSet: (proposal, approval) => ipcRenderer.invoke('tlc:apply-meeting-change-set', proposal, approval),
  updateMilestone: (opportunityId, milestoneId, update) => ipcRenderer.invoke('tlc:update-milestone', opportunityId, milestoneId, update),
  updateOpportunity: (opportunityId, update) => ipcRenderer.invoke('tlc:update-opportunity', opportunityId, update),
  runMcemCoach: (request) => ipcRenderer.invoke('tlc:run-mcem-coach', request),
  transitionOpportunityStage: (request) => ipcRenderer.invoke('tlc:transition-opportunity-stage', request),
  runAgentTask: (request) => ipcRenderer.invoke('tlc:run-agent-task', request),
  runAgentTaskStream: (request, onEvent) => {
    const streamId = globalThis.crypto.randomUUID()
    const listener = (_event: Electron.IpcRendererEvent, message: { streamId?: string; event?: unknown }) => {
      if (message?.streamId === streamId) onEvent(message.event)
    }
    ipcRenderer.on('tlc:agent-task-event', listener)
    const done = (ipcRenderer.invoke('tlc:run-agent-task-stream', request, streamId) as Promise<void>)
      .finally(() => { ipcRenderer.removeListener('tlc:agent-task-event', listener) })
    return { cancel: () => { void ipcRenderer.invoke('tlc:cancel-agent-task-stream', streamId) }, done }
  },
  openEmailCompose: (request) => ipcRenderer.invoke('tlc:open-email-compose', request),
  exportAgentResponse: (request) => ipcRenderer.invoke('tlc:export-agent-response', request),
  openEvidence: (url) => ipcRenderer.invoke('tlc:open-evidence', url),
  invokeWorkflow: (operation, request) => ipcRenderer.invoke(`tlc:workflow-${operation}`, request)
}

contextBridge.exposeInMainWorld('tlc', api)