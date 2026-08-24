import { contextBridge, ipcRenderer } from 'electron'
import type { Account, AuthStatus, DesktopDataStatus, McemRequest, McemResponse, Opportunity } from '../../../../packages/common/index.js'

export interface TlcDesktopApi {
  getDataStatus(): Promise<DesktopDataStatus>
  connectMcem(): Promise<AuthStatus>
  listAccounts(): Promise<Account[]>
  listOpportunities(accountId: string): Promise<Opportunity[]>
  runMcemCoach(request: McemRequest): Promise<McemResponse>
  openEvidence(url: string): Promise<void>
}

const api: TlcDesktopApi = {
  getDataStatus: () => ipcRenderer.invoke('tlc:get-data-status'),
  connectMcem: () => ipcRenderer.invoke('tlc:connect-mcem'),
  listAccounts: () => ipcRenderer.invoke('tlc:list-accounts'),
  listOpportunities: (accountId) => ipcRenderer.invoke('tlc:list-opportunities', accountId),
  runMcemCoach: (request) => ipcRenderer.invoke('tlc:run-mcem-coach', request),
  openEvidence: (url) => ipcRenderer.invoke('tlc:open-evidence', url)
}

contextBridge.exposeInMainWorld('tlc', api)