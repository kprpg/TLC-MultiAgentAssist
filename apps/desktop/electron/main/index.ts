import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { AzureCliCredential } from '@azure/identity'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { agentTaskRequestSchema, emailComposeRequestSchema, exportResponseRequestSchema, mcemRequestSchema, type AgentCapability, type AuthStatus, type DesktopDataStatus, type PerformanceReporter } from '../../../../packages/common/index.js'
import {
  loadFoundryEnvironment,
  type FoundryEnvironment
} from '../../../../packages/common/configuration/foundry-environment.js'
import { FixtureMsxConnector, LiveMsxConnector } from '../../../../packages/connectors/msx/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../../packages/connectors/sharepoint/index.js'
import { createFoundryOpenAIClient, FoundryPromptAgent } from '../../../../packages/connectors/foundry/index.js'
import { ThinSliceOrchestrator, type AgentTaskContext, type TaskAgentRegistry } from '../../../../packages/orchestrator/index.js'
import { AzureCliMsxTokenProvider } from './azure-cli-token-provider.js'
import { prepareFoundryEnvironmentFile } from './packaged-configuration.js'
import { createRuntimeCredentials } from './runtime-credentials.js'
import { createOutlookDraftMessage } from './outlook-compose.js'
import { createResponseDocumentBuffer } from './response-document.js'
import { buildSampleAgentResponse } from './sample-agent-response.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(currentDirectory, '../..')
const rendererFile = resolve(desktopRoot, 'dist/renderer/index.html')
const preloadFile = resolve(desktopRoot, 'dist-electron/preload/index.cjs')
const developmentUrl = process.env['VITE_DEV_SERVER_URL']
const allowedRendererUrl = developmentUrl ?? pathToFileURL(rendererFile).toString()
const dataMode = process.env['TLC_DATA_MODE'] === 'sample' ? 'sample' : 'live'

const preparedEnvironment = dataMode === 'live'
  ? await prepareFoundryEnvironmentFile({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    templatePath: resolve(process.resourcesPath, 'config/foundry.environment.example.json')
  })
  : undefined
let runtimeEnvironment: FoundryEnvironment | undefined
let startupBlocked = false

if (preparedEnvironment?.created) {
  startupBlocked = true
  await openConfigurationAndExit(
    preparedEnvironment.filePath,
    'Your configuration file has been created. Set the Foundry project, agent names, tenant, client ID, and authentication mode, then reopen the application.'
  )
} else if (preparedEnvironment) {
  try {
    runtimeEnvironment = await loadFoundryEnvironment(preparedEnvironment.filePath)
  } catch (error) {
    startupBlocked = true
    await openConfigurationAndExit(
      preparedEnvironment.filePath,
      `The configuration could not be loaded. Correct it, then reopen the application.\n\n${error instanceof Error ? error.message : String(error)}`
    )
  }
}

const authentication = runtimeEnvironment?.authentication
const fallbackCredential = new AzureCliCredential({ processTimeoutInMs: 30_000 })
const credentials = authentication
  ? createRuntimeCredentials(authentication)
  : { msx: fallbackCredential, foundry: fallbackCredential, graph: fallbackCredential }
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
const reportPerformance: PerformanceReporter = (event) => {
  console.info(`[performance] ${JSON.stringify(event)}`)
}
const mcemGuidancePath = app.isPackaged
  ? resolve(process.resourcesPath, 'docs/knowledge/MCEM Overview.pdf')
  : resolve(desktopRoot, '../../docs/knowledge/MCEM Overview.pdf')
const mcemConnector = new LocalPdfMcemGuidanceConnector(mcemGuidancePath)
const msxConnector = dataMode === 'sample'
  ? new FixtureMsxConnector()
  : new LiveMsxConnector(tokenProvider, fetch, undefined, reportPerformance)
const foundryOpenAIClient = runtimeEnvironment
  ? createFoundryOpenAIClient(runtimeEnvironment.foundry.projectEndpoint, credentials.foundry)
  : undefined
const taskAgents: TaskAgentRegistry = Object.fromEntries(
  (['account-pulse', 'mcem-coach', 'pursuit-executive', 'risk-solution-play'] as const).map((capability) => {
    if (!runtimeEnvironment) {
      return [capability, {
        version: 'sample-v2',
        agent: { invoke: async (context: AgentTaskContext) => buildSampleAgentResponse(capability, context) }
      }]
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
        credential: credentials.foundry,
        openAIClient: foundryOpenAIClient
      })
    }]
  })
) as TaskAgentRegistry
const orchestrator = new ThinSliceOrchestrator(
  msxConnector,
  mcemConnector,
  taskAgents,
  reportPerformance
)

async function openConfigurationAndExit(filePath: string, detail: string): Promise<void> {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'TLC MultiAgent Assist setup',
    message: 'Configure your environment before starting TLC MultiAgent Assist.',
    detail: `${detail}\n\nConfiguration file:\n${filePath}`,
    buttons: ['Open configuration', 'Exit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  if (result.response === 0) {
    const openError = await shell.openPath(filePath)
    if (openError) shell.showItemInFolder(filePath)
  }
  app.quit()
}

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
  ipcMain.handle('tlc:open-email-compose', async (event, rawRequest: unknown) => {
    assertTrustedSender(event)
    const request = emailComposeRequestSchema.parse(rawRequest)
    const draftDirectory = resolve(app.getPath('temp'), 'TLC-MultiAgentAssist', 'email-drafts')
    await mkdir(draftDirectory, { recursive: true })
    const draftPath = resolve(draftDirectory, `${safeFileName(request.responseTitle)}-${randomUUID()}.eml`)
    await writeFile(draftPath, createOutlookDraftMessage(request), 'utf8')
    const openError = await shell.openPath(draftPath)
    if (openError) throw new Error(`Outlook could not open the email draft: ${openError}`)
    return { state: 'opened' as const }
  })
  ipcMain.handle('tlc:export-agent-response', async (event, rawRequest: unknown) => {
    assertTrustedSender(event)
    const request = exportResponseRequestSchema.parse(rawRequest)
    const result = await dialog.showSaveDialog({
      title: 'Export agent response',
      defaultPath: `${safeFileName(request.responseTitle)}.docx`,
      filters: [{ name: 'Microsoft Word document', extensions: ['docx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (result.canceled || !result.filePath) return { state: 'cancelled' as const }
    const filePath = result.filePath.toLowerCase().endsWith('.docx') ? result.filePath : `${result.filePath}.docx`
    await writeFile(filePath, await createResponseDocumentBuffer(request))
    return { state: 'saved' as const, filePath }
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

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 120) || 'TLC agent response'
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

if (!startupBlocked) {
  registerReadOnlyIpc()
  void app.whenReady().then(createWindow)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})