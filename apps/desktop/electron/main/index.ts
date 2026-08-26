import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { AzureCliCredential } from '@azure/identity'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { agentTaskRequestSchema, mcemRequestSchema, type AgentCapability, type AuthStatus, type DesktopDataStatus } from '../../../../packages/common/index.js'
import {
  loadFoundryEnvironment,
  resolveFoundryEnvironmentPath
} from '../../../../packages/common/configuration/foundry-environment.js'
import { FixtureMsxConnector, LiveMsxConnector } from '../../../../packages/connectors/msx/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../../packages/connectors/sharepoint/index.js'
import { FoundryMcemAgent, FoundryPromptAgent, RecordingMcemAgent, StaticPromptAgent } from '../../../../packages/connectors/foundry/index.js'
import { ThinSliceOrchestrator, type AgentTaskContext, type TaskAgentRegistry } from '../../../../packages/orchestrator/index.js'
import { AzureCliMsxTokenProvider } from './azure-cli-token-provider.js'
import { createRuntimeCredentials } from './runtime-credentials.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(currentDirectory, '../..')
const rendererFile = resolve(desktopRoot, 'dist/renderer/index.html')
const preloadFile = resolve(desktopRoot, 'dist-electron/preload/index.cjs')
const developmentUrl = process.env['VITE_DEV_SERVER_URL']
const allowedRendererUrl = developmentUrl ?? pathToFileURL(rendererFile).toString()
const dataMode = process.env['TLC_DATA_MODE'] === 'sample' ? 'sample' : 'live'
const runtimeEnvironment = dataMode === 'live'
  ? await loadFoundryEnvironment(resolveFoundryEnvironmentPath())
  : undefined
const authentication = runtimeEnvironment?.authentication
const fallbackCredential = new AzureCliCredential({ processTimeoutInMs: 30_000 })
const credentials = authentication
  ? createRuntimeCredentials(authentication)
  : { msx: fallbackCredential, foundry: fallbackCredential }
const tokenProvider = new AzureCliMsxTokenProvider({
  credential: credentials.msx,
  ...(authentication
    ? {
        scope: authentication.scopes.msx[0],
        expectedUserDomain: authentication.expectedUserDomain,
        authenticationLabel: authentication.mode === 'interactive-browser' ? 'Interactive sign-in' : 'Azure CLI'
      }
    : {})
})
const mcemConnector = new LocalPdfMcemGuidanceConnector(resolve(desktopRoot, '../../docs/knowledge/MCEM Overview.pdf'))
const msxConnector = dataMode === 'sample'
  ? new FixtureMsxConnector()
  : new LiveMsxConnector(tokenProvider)
const smokeCapturePath = process.env['TLC_SMOKE_FOUNDRY_CAPTURE_PATH']?.trim()
const mcemAgent = smokeCapturePath
  ? new RecordingMcemAgent(resolve(smokeCapturePath))
  : runtimeEnvironment
    ? new FoundryMcemAgent({
        projectEndpoint: runtimeEnvironment.foundry.projectEndpoint,
        agentName: runtimeEnvironment.foundry.agents.mcemCoach.name,
        requestTimeoutMs: runtimeEnvironment.foundry.requestTimeoutMs,
        credential: credentials.foundry
      })
    : undefined
const previewResponses: Record<AgentCapability, string> = {
  'account-pulse': 'Summary\nFocus this week on the selected opportunity and validate its incomplete milestones.\n\nContext used\nSample account and opportunity context.\n\nObserved signals\nMSX sample evidence and local MCEM guidance.\n\nRecommended actions\nAccount Executive: confirm the next customer commitment.\n\nSources\nMSX sample; MCEM local snapshot.\n\nAssumptions and missing information\nExternal signals are unavailable in sample mode.\n\nFeedback prompt\nWas this focus actionable?',
  'mcem-coach': 'Use the deterministic MCEM diagnostic shown in the workbench.',
  'pursuit-executive': 'Summary\nPrepare the pursuit around the selected opportunity gaps.\n\nContext used\nSample account, opportunity, and MCEM context.\n\nObserved signals\nThe local evaluation identifies incomplete exit criteria.\n\nRecommended actions\nSpecialist / SSP: schedule validation and confirm owners.\n\nExecutive brief or 30/60 day pursuit plan\nDays 1-30: close evidence gaps. Days 31-60: validate value and executive alignment.\n\nSources\nMSX sample; MCEM local snapshot.\n\nAssumptions and missing information\nRecent customer activity is not available.\n\nFeedback prompt\nWas this plan useful?',
  'risk-solution-play': 'Summary\nThe selected opportunity has execution risk where exit-criteria evidence is incomplete.\n\nContext used\nSample account, opportunity, and MCEM context.\n\nObserved signals\nMissing or partial criterion evidence.\n\nRisks\nMedium: progression may be premature.\n\nRecommended actions\nAccount Executive: confirm the next customer step.\n\nSources\nMSX sample; MCEM local snapshot.\n\nAssumptions and missing information\nApproved content sources are unavailable in sample mode.\n\nFeedback prompt\nWas this risk review grounded?'
}
const taskAgents: TaskAgentRegistry = Object.fromEntries(
  (['account-pulse', 'mcem-coach', 'pursuit-executive', 'risk-solution-play'] as const).map((capability) => {
    if (!runtimeEnvironment) {
      return [capability, { version: 'sample-v1', agent: new StaticPromptAgent<AgentTaskContext>(previewResponses[capability]) }]
    }
    const binding = {
      'account-pulse': runtimeEnvironment.foundry.agents.accountPulse,
      'mcem-coach': runtimeEnvironment.foundry.agents.mcemCoach,
      'pursuit-executive': runtimeEnvironment.foundry.agents.pursuitExecutive,
      'risk-solution-play': runtimeEnvironment.foundry.agents.riskSolutionPlay
    }[capability]
    return [capability, {
      version: 'active',
      agent: new FoundryPromptAgent<AgentTaskContext>({
        projectEndpoint: runtimeEnvironment.foundry.projectEndpoint,
        agentName: binding.name,
        requestTimeoutMs: runtimeEnvironment.foundry.requestTimeoutMs,
        credential: credentials.foundry
      })
    }]
  })
) as TaskAgentRegistry
const orchestrator = new ThinSliceOrchestrator(
  msxConnector,
  mcemConnector,
  mcemAgent,
  taskAgents
)

async function getDataStatus(): Promise<DesktopDataStatus> {
  if (dataMode === 'sample') {
    return {
      mode: 'sample',
      auth: { state: 'ready', detail: 'Automated fixture mode is active.' }
    }
  }
  return { mode: 'live', auth: await tokenProvider.getAuthStatus() }
}

async function connectMcem(): Promise<AuthStatus> {
  await mcemConnector.getStageGuidance(1)
  return {
    state: 'ready',
    detail: 'MCEM guidance is loaded from docs/knowledge/MCEM Overview.pdf. No live SharePoint request was made.'
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url
  if (!senderUrl || !senderUrl.startsWith(allowedRendererUrl)) {
    throw new Error('Rejected IPC request from an untrusted renderer.')
  }
}

function registerReadOnlyIpc(): void {
  ipcMain.handle('tlc:get-data-status', (event) => {
    assertTrustedSender(event)
    return getDataStatus()
  })
  ipcMain.handle('tlc:list-accounts', (event) => {
    assertTrustedSender(event)
    return orchestrator.listAccounts()
  })
  ipcMain.handle('tlc:connect-mcem', (event) => {
    assertTrustedSender(event)
    return connectMcem()
  })
  ipcMain.handle('tlc:list-opportunities', (event, accountId: unknown) => {
    assertTrustedSender(event)
    return orchestrator.listOpportunities(z.string().min(1).parse(accountId))
  })
  ipcMain.handle('tlc:run-mcem-coach', (event, request: unknown) => {
    assertTrustedSender(event)
    return orchestrator.runMcemCoach(mcemRequestSchema.parse(request))
  })
  ipcMain.handle('tlc:run-agent-task', (event, request: unknown) => {
    assertTrustedSender(event)
    return orchestrator.runAgentTask(agentTaskRequestSchema.parse(request))
  })
  ipcMain.handle('tlc:open-evidence', async (event, rawUrl: unknown) => {
    assertTrustedSender(event)
    const url = new URL(z.string().url().parse(rawUrl))
    if (url.protocol !== 'https:') {
      throw new Error('Only HTTPS evidence links are allowed.')
    }
    await shell.openExternal(url.toString())
  })
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f5f7fa',
    title: 'TLC Account Team Intelligence',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedRendererUrl)) event.preventDefault()
  })

  if (developmentUrl) {
    await window.loadURL(developmentUrl)
  } else {
    await window.loadFile(rendererFile)
  }
}

app.whenReady().then(() => {
  registerReadOnlyIpc()
  void createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})