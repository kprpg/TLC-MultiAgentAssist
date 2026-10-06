import { contextBridge, ipcRenderer } from 'electron'
import type { Account, AccountCandidate, AccountListOptions, AccountSearchRequest, AccountVisibility, AgentTaskRequest, AgentTaskResponse, AuthStatus, CreateMilestoneActivityRequest, DealTeamJoinResult, DealTeamLeaveResult, DesktopDataStatus, DiscoverableOpportunity, EmailComposeRequest, EmailComposeResult, ExportResponseRequest, ExportResponseResult, McemRequest, McemResponse, McemStageTransitionRequest, McemStageTransitionResult, Milestone, MilestoneActivity, MilestoneTeamJoinResult, MilestoneTeamLeaveResult, MilestoneUpdate, Opportunity, OpportunityUpdate, SeDomainId } from '../../../../packages/common/index.js'
import type { WorkflowHostOperation } from '../../../../packages/orchestrator/workflows/index.js'

export interface TlcDesktopApi {
  exitApplication(): Promise<void>
  getDataStatus(): Promise<DesktopDataStatus>
  connectMcem(): Promise<AuthStatus>
  listAccounts(options?: AccountListOptions): Promise<Account[]>
  searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]>
  addAccount(accountId: string): Promise<Account>
  setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account>
  listOpportunities(accountId: string): Promise<Opportunity[]>
  discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]>
  joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult>
  leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult>
  joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult>
  leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult>
  listMilestones(opportunityId: string): Promise<Milestone[]>
  listDiscoverableMilestones(opportunityId: string): Promise<Milestone[]>
  listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]>
  createMilestoneActivity(opportunityId: string, milestoneId: string, request: CreateMilestoneActivityRequest): Promise<MilestoneActivity>
  updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone>
  updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity>
  runMcemCoach(request: McemRequest): Promise<McemResponse>
  transitionOpportunityStage(request: McemStageTransitionRequest): Promise<McemStageTransitionResult>
  runAgentTask(request: AgentTaskRequest): Promise<AgentTaskResponse>
  openEmailCompose(request: EmailComposeRequest): Promise<EmailComposeResult>
  exportAgentResponse(request: ExportResponseRequest): Promise<ExportResponseResult>
  openEvidence(url: string): Promise<void>
  invokeWorkflow(operation: WorkflowHostOperation, request: unknown): Promise<unknown>
}

const api: TlcDesktopApi = {
  exitApplication: () => ipcRenderer.invoke('tlc:exit-application'),
  getDataStatus: () => ipcRenderer.invoke('tlc:get-data-status'),
  connectMcem: () => ipcRenderer.invoke('tlc:connect-mcem'),
  listAccounts: (options) => ipcRenderer.invoke('tlc:list-accounts', options),
  searchAccounts: (request) => ipcRenderer.invoke('tlc:search-accounts', request),
  addAccount: (accountId) => ipcRenderer.invoke('tlc:add-account', accountId),
  setAccountVisibility: (accountId, visibility) => ipcRenderer.invoke('tlc:set-account-visibility', accountId, visibility),
  listOpportunities: (accountId) => ipcRenderer.invoke('tlc:list-opportunities', accountId),
  discoverOpportunities: (domain) => ipcRenderer.invoke('tlc:discover-opportunities', domain),
  joinDealTeam: (opportunityId) => ipcRenderer.invoke('tlc:join-deal-team', opportunityId),
  leaveDealTeam: (opportunityId) => ipcRenderer.invoke('tlc:leave-deal-team', opportunityId),
  joinMilestoneTeam: (opportunityId, milestoneId) => ipcRenderer.invoke('tlc:join-milestone-team', opportunityId, milestoneId),
  leaveMilestoneTeam: (opportunityId, milestoneId) => ipcRenderer.invoke('tlc:leave-milestone-team', opportunityId, milestoneId),
  listMilestones: (opportunityId) => ipcRenderer.invoke('tlc:list-milestones', opportunityId),
  listDiscoverableMilestones: (opportunityId) => ipcRenderer.invoke('tlc:list-discoverable-milestones', opportunityId),
  listMilestoneActivities: (opportunityId, milestoneId) => ipcRenderer.invoke('tlc:list-milestone-activities', opportunityId, milestoneId),
  createMilestoneActivity: (opportunityId, milestoneId, request) => ipcRenderer.invoke('tlc:create-milestone-activity', opportunityId, milestoneId, request),
  updateMilestone: (opportunityId, milestoneId, update) => ipcRenderer.invoke('tlc:update-milestone', opportunityId, milestoneId, update),
  updateOpportunity: (opportunityId, update) => ipcRenderer.invoke('tlc:update-opportunity', opportunityId, update),
  runMcemCoach: (request) => ipcRenderer.invoke('tlc:run-mcem-coach', request),
  transitionOpportunityStage: (request) => ipcRenderer.invoke('tlc:transition-opportunity-stage', request),
  runAgentTask: (request) => ipcRenderer.invoke('tlc:run-agent-task', request),
  openEmailCompose: (request) => ipcRenderer.invoke('tlc:open-email-compose', request),
  exportAgentResponse: (request) => ipcRenderer.invoke('tlc:export-agent-response', request),
  openEvidence: (url) => ipcRenderer.invoke('tlc:open-evidence', url),
  invokeWorkflow: (operation, request) => ipcRenderer.invoke(`tlc:workflow-${operation}`, request)
}

contextBridge.exposeInMainWorld('tlc', api)