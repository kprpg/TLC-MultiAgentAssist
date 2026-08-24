import { contextBridge, ipcRenderer } from 'electron'
import type { Account, DesktopDataStatus, McemRequest, McemResponse, Opportunity } from '../../../../packages/common/index.js'

export interface TlcDesktopApi {
  getDataStatus(): Promise<DesktopDataStatus>
  listAccounts(): Promise<Account[]>
  listOpportunities(accountId: string): Promise<Opportunity[]>
  runMcemCoach(request: McemRequest): Promise<McemResponse>
  openEvidence(url: string): Promise<void>
}

const api: TlcDesktopApi = {
  getDataStatus: () => ipcRenderer.invoke('tlc:get-data-status'),
  listAccounts: () => ipcRenderer.invoke('tlc:list-accounts'),
  listOpportunities: (accountId) => ipcRenderer.invoke('tlc:list-opportunities', accountId),
  runMcemCoach: (request) => ipcRenderer.invoke('tlc:run-mcem-coach', request),
  openEvidence: (url) => ipcRenderer.invoke('tlc:open-evidence', url)
}

contextBridge.exposeInMainWorld('tlc', api)