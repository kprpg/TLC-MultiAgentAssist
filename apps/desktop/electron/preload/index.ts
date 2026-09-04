import { contextBridge, ipcRenderer } from 'electron'
import type { Account, AgentTaskRequest, AgentTaskResponse, AuthStatus, DesktopDataStatus, EmailComposeRequest, EmailComposeResult, ExportResponseRequest, ExportResponseResult, McemRequest, McemResponse, Opportunity } from '../../../../packages/common/index.js'

export interface TlcDesktopApi {
  getDataStatus(): Promise<DesktopDataStatus>
  connectMcem(): Promise<AuthStatus>
  listAccounts(): Promise<Account[]>
  listOpportunities(accountId: string): Promise<Opportunity[]>
  runMcemCoach(request: McemRequest): Promise<McemResponse>
  runAgentTask(request: AgentTaskRequest): Promise<AgentTaskResponse>
  openEmailCompose(request: EmailComposeRequest): Promise<EmailComposeResult>
  exportAgentResponse(request: ExportResponseRequest): Promise<ExportResponseResult>
  openEvidence(url: string): Promise<void>
}

const api: TlcDesktopApi = {
  getDataStatus: () => ipcRenderer.invoke('tlc:get-data-status'),
  connectMcem: () => ipcRenderer.invoke('tlc:connect-mcem'),
  listAccounts: () => ipcRenderer.invoke('tlc:list-accounts'),
  listOpportunities: (accountId) => ipcRenderer.invoke('tlc:list-opportunities', accountId),
  runMcemCoach: (request) => ipcRenderer.invoke('tlc:run-mcem-coach', request),
  runAgentTask: (request) => ipcRenderer.invoke('tlc:run-agent-task', request),
  openEmailCompose: (request) => ipcRenderer.invoke('tlc:open-email-compose', request),
  exportAgentResponse: (request) => ipcRenderer.invoke('tlc:export-agent-response', request),
  openEvidence: (url) => ipcRenderer.invoke('tlc:open-evidence', url)
}

contextBridge.exposeInMainWorld('tlc', api)