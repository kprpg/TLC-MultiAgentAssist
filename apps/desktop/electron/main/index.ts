import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { AzureCliCredential } from '@azure/identity'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { accountListOptionsSchema, accountSearchRequestSchema, accountVisibilitySchema, agentTaskRequestSchema, createMilestoneActivityRequestSchema, emailComposeRequestSchema, exportResponseRequestSchema, loadDataverseEntityMap, loadMcpServerRegistry, loadMcpToolPolicy, mcemRequestSchema, mcemStageTransitionRequestSchema, meetingChangeSetApprovalSchema, meetingChangeSetProposalSchema, milestoneUpdateSchema, opportunityUpdateSchema, seDomainSchema, type AuthStatus, type DesktopDataStatus, type McpServer, type PerformanceReporter } from '../../../../packages/common/index.js'
import {
  loadFoundryEnvironment,
  type FoundryEnvironment
} from '../../../../packages/common/configuration/foundry-environment.js'
import { FixtureMsxConnector, LiveMeetingCaptureConnector, LiveMsxConnector, msxWriteMetadataFromEnvironment } from '../../../../packages/connectors/msx/index.js'
import { createLocalStoreMsxConnector } from '../../../../packages/connectors/local-store/index.js'
import { JsonFilePortfolioPreferenceStore } from '../../../../packages/connectors/common/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../../packages/connectors/sharepoint/index.js'
import { createFoundryOpenAIClient, FoundryPromptAgent } from '../../../../packages/connectors/foundry/index.js'
import { createFoundryMeetingExtractor } from '../../../../packages/agents/meeting-signal-extractor/src/foundry-extractor.js'
import { parseTranscriptContent } from '../../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'
import { ThinSliceOrchestrator, type AgentTaskContext, type TaskAgentRegistry } from '../../../../packages/orchestrator/index.js'
import { createLivePlayWorkflowHost, createSampleWorkflowHost } from '../../../../packages/orchestrator/workflows/index.js'
import { AzureCliMsxTokenProvider } from './azure-cli-token-provider.js'
import { prepareFoundryEnvironmentFile } from './packaged-configuration.js'
import { createRuntimeCredentials } from './runtime-credentials.js'
import { openOutlookDraft } from './outlook-compose.js'
import { createResponseDocumentBuffer } from './response-document.js'
import { showResponseSaveDialog } from './response-save-dialog.js'
import { buildSampleAgentResponse } from './sample-agent-response.js'
import { openConfigurationAndExit } from './startup-dialog.js'
import { createWorkflowIpcHandlers } from './workflow-ipc.js'
import { SharedVoiceInputHost } from '../../../../packages/orchestrator/voice-input.js'
import { WindowsVoiceCaptureDriver } from '../../../../packages/connectors/common/windows-voice.js'
import { createVoiceIpcHandler, voiceIpcChannel } from './voice-ipc.js'
import { createSellerDashboardHost } from '../../../../packages/orchestrator/seller-dashboard.js'
import { createSellerDashboardIpcHandler, sellerDashboardIpcChannel } from './seller-dashboard-ipc.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(currentDirectory, '../..')
const rendererFile = process.env['TLC_UI_MODE'] === 'legacy'
  ? resolve(desktopRoot, 'dist/renderer/index.html')
  : resolve(desktopRoot, 'dist/revamp/desktop.html')
const preloadFile = resolve(desktopRoot, 'dist-electron/preload/index.cjs')
const appIcon = resolve(desktopRoot, 'build/icon.png')
const developmentUrl = process.env['VITE_DEV_SERVER_URL']
const allowedRendererUrl = developmentUrl ?? pathToFileURL(rendererFile).toString()
const dataMode = process.env['TLC_DATA_MODE'] === 'sample' ? 'sample' : 'live'
const voiceHost = new SharedVoiceInputHost(new WindowsVoiceCaptureDriver(), () =>
  BrowserWindow.getAllWindows().some((window) => window.isVisible() && window.isFocused())
)

const preparedEnvironment = app.isPackaged || dataMode === 'live'
  ? await prepareFoundryEnvironmentFile({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    templatePath: resolve(process.resourcesPath, 'config/foundry.environment.default.json'),
    requiresConfigurationOnCreate: false
  })
  : undefined
let runtimeEnvironment: FoundryEnvironment | undefined
let startupBlocked = false

if (dataMode === 'live' && preparedEnvironment?.requiresConfiguration) {
  startupBlocked = true
  await openConfigurationAndExit(
    app,
    dialog,
    shell,
    preparedEnvironment.filePath,
    'Your configuration file has been created. Set the Foundry project, agent names, tenant, client ID, and authentication mode, then reopen the application.'
  )
} else if (dataMode === 'live' && preparedEnvironment) {
  try {
    runtimeEnvironment = await loadFoundryEnvironment(preparedEnvironment.filePath)
  } catch (error) {
    startupBlocked = true
    await openConfigurationAndExit(
      app,
      dialog,
      shell,
      preparedEnvironment.filePath,
      `The configuration could not be loaded. Correct it, then reopen the application.\n\n${error instanceof Error ? error.message : String(error)}`
    )
  }
}

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
const sellerDashboardHost = createSellerDashboardHost({
  mode: dataMode,
  resolveUserEmail: async () => (await tokenProvider.getAuthStatus()).userEmail
})
const reportPerformance: PerformanceReporter = (event) => {
  console.info(`[performance] ${JSON.stringify(event)}`)
}
const mcemGuidancePath = app.isPackaged
  ? resolve(process.resourcesPath, 'docs/knowledge/MCEM Overview.pdf')
  : resolve(desktopRoot, '../../docs/knowledge/MCEM Overview.pdf')
const mcemConnector = new LocalPdfMcemGuidanceConnector(mcemGuidancePath)
const portfolioPreferenceStore = new JsonFilePortfolioPreferenceStore(
  resolve(app.getPath('userData'), 'portfolio-preferences.json')
)
const liveMsxConnector = dataMode === 'sample'
  ? undefined
  : new LiveMsxConnector(tokenProvider, fetch, undefined, reportPerformance, msxWriteMetadataFromEnvironment(process.env), portfolioPreferenceStore)
// Sample mode uses the in-memory fixture by default, or the relational SQLite test store when TLC_DATA_STORE=sqlite.
const localStoreMsxConnector = liveMsxConnector ? undefined : createLocalStoreMsxConnector()
const msxConnector = liveMsxConnector ?? localStoreMsxConnector ?? new FixtureMsxConnector()
// Meeting capture: absent for the in-memory fixture; the SQLite test store implements it directly,
// live wraps the delegated MSX connection (Graph transcript acquisition is not wired yet - paste/upload only).
const meetingConnector = liveMsxConnector ? new LiveMeetingCaptureConnector(liveMsxConnector) : localStoreMsxConnector
const foundryOpenAIClient = runtimeEnvironment
  ? createFoundryOpenAIClient(runtimeEnvironment.foundry.projectEndpoint, credentials.foundry)
  : undefined
/** Foundry model-backed meeting-signal extractor when TLC_MEETING_EXTRACTOR=foundry; else the deterministic offline extractor. */
const meetingExtractor = runtimeEnvironment && foundryOpenAIClient && (process.env['TLC_MEETING_EXTRACTOR'] ?? '').toLowerCase() === 'foundry'
  ? createFoundryMeetingExtractor({
    openAIClient: foundryOpenAIClient,
    model: process.env['TLC_MEETING_MODEL']?.trim() || 'gpt-6.1-sol',
    requestTimeoutMs: runtimeEnvironment.foundry.requestTimeoutMs
  })
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
const configurationRoot = app.isPackaged ? resolve(process.resourcesPath, 'config') : resolve(desktopRoot, '../../config')
const [mcpRegistry, mcpPolicy, dataverseEntityMap] = await Promise.all([
  loadMcpServerRegistry(resolve(configurationRoot, 'mcp.servers.json')),
  loadMcpToolPolicy(resolve(configurationRoot, 'mcp.tool-policy.json')),
  loadDataverseEntityMap(resolve(configurationRoot, 'dataverse.entity-map.json'))
])
const configuredWorkflowHost = dataMode === 'sample' ? undefined : createLivePlayWorkflowHost({
  registry: mcpRegistry,
  policy: mcpPolicy,
  entityMap: dataverseEntityMap,
  getAccessToken: async (server: McpServer) => {
    const token = await credentials.msx.getToken(server.authentication.scopes)
    if (!token) throw new Error('A delegated MCP access token is unavailable.')
    return token.token
  },
  resolveCurrentUserId: async () => {
    if (!liveMsxConnector) throw new Error('Live Plays require the live MSX connection.')
    return liveMsxConnector.getCurrentUserId()
  },
  resolveExcludedAccountIds: async () => {
    if (!liveMsxConnector) return []
    return (await liveMsxConnector.listAccounts({ includeHidden: true }))
      .filter((account) => account.visibility === 'hidden')
      .map((account) => account.id)
  },
  onStepError: (info) => {
    console.error(`[play ${info.workflowId}] ${info.connector}/${info.operation} ${info.required ? 'required' : 'optional'} step failed: ${info.message}`)
  }
})
const workflowHost = configuredWorkflowHost?.host ?? createSampleWorkflowHost(async () => {
  const accounts = await msxConnector.listAccounts()
  const opportunities = (await Promise.all(accounts.map((account) => msxConnector.listOpportunities(account.id)))).flat()
  return {
    accountIds: accounts.map((account) => account.id),
    opportunityIds: opportunities.map((opportunity) => opportunity.id)
  }
})

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

function registerIpc(): void {
  const invokeSellerDashboard = createSellerDashboardIpcHandler(sellerDashboardHost)
  ipcMain.handle(sellerDashboardIpcChannel, (event, request: unknown) => {
    assertTrustedSender(event)
    return invokeSellerDashboard(request)
  })
  const invokeVoice = createVoiceIpcHandler(voiceHost)
  ipcMain.handle(voiceIpcChannel, (event, request: unknown) => {
    assertTrustedSender(event)
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Voice capture requires the main renderer frame.')
    return invokeVoice(request)
  })
  for (const [channel, handler] of Object.entries(createWorkflowIpcHandlers(workflowHost))) {
    ipcMain.handle(channel, (event, request: unknown) => {
      assertTrustedSender(event)
      return handler(request)
    })
  }
  ipcMain.handle('tlc:exit-application', (event) => {
    assertTrustedSender(event)
    setImmediate(() => app.quit())
  })
  ipcMain.handle('tlc:get-data-status', (event) => {
    assertTrustedSender(event)
    return getDataStatus()
  })
  ipcMain.handle('tlc:list-accounts', (event, options: unknown) => {
    assertTrustedSender(event)
    return orchestrator.listAccounts(accountListOptionsSchema.parse(options ?? {}))
  })
  ipcMain.handle('tlc:search-accounts', (event, request: unknown) => {
    assertTrustedSender(event)
    return orchestrator.searchAccounts(accountSearchRequestSchema.parse(request))
  })
  ipcMain.handle('tlc:add-account', (event, accountId: unknown) => {
    assertTrustedSender(event)
    return orchestrator.addAccount(z.string().min(1).max(200).parse(accountId))
  })
  ipcMain.handle('tlc:set-account-visibility', (event, accountId: unknown, visibility: unknown) => {
    assertTrustedSender(event)
    return orchestrator.setAccountVisibility(
      z.string().min(1).max(200).parse(accountId),
      accountVisibilitySchema.parse(visibility)
    )
  })
  ipcMain.handle('tlc:connect-mcem', (event) => {
    assertTrustedSender(event)
    return connectMcem()
  })
  ipcMain.handle('tlc:list-opportunities', (event, accountId: unknown) => {
    assertTrustedSender(event)
    return orchestrator.listOpportunities(z.string().min(1).parse(accountId))
  })
  ipcMain.handle('tlc:discover-opportunities', (event, domain: unknown) => {
    assertTrustedSender(event)
    return orchestrator.discoverOpportunities(seDomainSchema.parse(domain))
  })
  ipcMain.handle('tlc:join-deal-team', (event, opportunityId: unknown) => {
    assertTrustedSender(event)
    return orchestrator.joinDealTeam(z.string().min(1).parse(opportunityId))
  })
  ipcMain.handle('tlc:leave-deal-team', (event, opportunityId: unknown) => {
    assertTrustedSender(event)
    return orchestrator.leaveDealTeam(z.string().min(1).max(200).parse(opportunityId))
  })
  ipcMain.handle('tlc:join-milestone-team', (event, opportunityId: unknown, milestoneId: unknown) => {
    assertTrustedSender(event)
    return orchestrator.joinMilestoneTeam(z.string().min(1).max(200).parse(opportunityId), z.string().min(1).max(200).parse(milestoneId))
  })
  ipcMain.handle('tlc:leave-milestone-team', (event, opportunityId: unknown, milestoneId: unknown) => {
    assertTrustedSender(event)
    return orchestrator.leaveMilestoneTeam(z.string().min(1).max(200).parse(opportunityId), z.string().min(1).max(200).parse(milestoneId))
  })
  ipcMain.handle('tlc:list-milestones', (event, opportunityId: unknown) => {
    assertTrustedSender(event)
    return orchestrator.listMilestones(z.string().min(1).parse(opportunityId))
  })
  ipcMain.handle('tlc:list-discoverable-milestones', (event, opportunityId: unknown) => {
    assertTrustedSender(event)
    return orchestrator.listDiscoverableMilestones(z.string().min(1).max(200).parse(opportunityId))
  })
  ipcMain.handle('tlc:list-milestone-activities', (event, opportunityId: unknown, milestoneId: unknown) => {
    assertTrustedSender(event)
    return orchestrator.listMilestoneActivities(z.string().min(1).max(200).parse(opportunityId), z.string().min(1).max(200).parse(milestoneId))
  })
  ipcMain.handle('tlc:create-milestone-activity', (event, opportunityId: unknown, milestoneId: unknown, request: unknown) => {
    assertTrustedSender(event)
    return orchestrator.createMilestoneActivity(z.string().min(1).max(200).parse(opportunityId), z.string().min(1).max(200).parse(milestoneId), createMilestoneActivityRequestSchema.parse(request))
  })
  ipcMain.handle('tlc:list-meeting-transcripts', (event, opportunityId: unknown) => {
    assertTrustedSender(event)
    if (!meetingConnector) throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.')
    return meetingConnector.listMeetingTranscripts(opportunityId === undefined ? undefined : z.string().min(1).max(200).parse(opportunityId))
  })
  ipcMain.handle('tlc:get-meeting-transcript', async (event, transcriptId: unknown) => {
    assertTrustedSender(event)
    if (!meetingConnector) throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.')
    return (await meetingConnector.getMeetingTranscript(z.string().min(1).max(200).parse(transcriptId))) ?? null
  })
  ipcMain.handle('tlc:propose-meeting-change-set', (event, request: unknown) => {
    assertTrustedSender(event)
    if (!meetingConnector) throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.')
    const params = z.object({
      opportunityId: z.string().min(1).max(200),
      transcriptId: z.string().min(1).max(200).optional(),
      rawTranscript: z.object({
        content: z.string().min(1),
        format: z.enum(['vtt', 'text']).optional(),
        meetingType: z.enum(['customer', 'internal']).optional()
      }).optional()
    }).parse(request)
    const transcript = params.rawTranscript
      ? parseTranscriptContent(params.rawTranscript.content, {
        opportunityId: params.opportunityId,
        ...(params.rawTranscript.format ? { format: params.rawTranscript.format } : {}),
        ...(params.rawTranscript.meetingType ? { meetingType: params.rawTranscript.meetingType } : {})
      })
      : undefined
    return meetingConnector.proposeMeetingChangeSet({
      opportunityId: params.opportunityId,
      ...(params.transcriptId ? { transcriptId: params.transcriptId } : {}),
      ...(transcript ? { transcript } : {})
    }, meetingExtractor)
  })
  ipcMain.handle('tlc:apply-meeting-change-set', (event, proposal: unknown, approval: unknown) => {
    assertTrustedSender(event)
    if (!meetingConnector) throw new Error('Meeting capture requires the SQLite test store (sample data) or a live Graph connection.')
    return meetingConnector.applyMeetingChangeSet({
      proposal: meetingChangeSetProposalSchema.parse(proposal),
      approval: meetingChangeSetApprovalSchema.parse(approval)
    })
  })
  ipcMain.handle('tlc:update-milestone', (event, opportunityId: unknown, milestoneId: unknown, update: unknown) => {
    assertTrustedSender(event)
    return orchestrator.updateMilestone(z.string().min(1).parse(opportunityId), z.string().min(1).parse(milestoneId), milestoneUpdateSchema.parse(update))
  })
  ipcMain.handle('tlc:update-opportunity', (event, opportunityId: unknown, update: unknown) => {
    assertTrustedSender(event)
    return orchestrator.updateOpportunity(z.string().min(1).parse(opportunityId), opportunityUpdateSchema.parse(update))
  })
  ipcMain.handle('tlc:run-mcem-coach', (event, request: unknown) => {
    assertTrustedSender(event)
    return orchestrator.runMcemCoach(mcemRequestSchema.parse(request))
  })
  ipcMain.handle('tlc:transition-opportunity-stage', (event, request: unknown) => {
    assertTrustedSender(event)
    return orchestrator.transitionOpportunityStage(mcemStageTransitionRequestSchema.parse(request))
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
    await openOutlookDraft(request, draftPath, {
      writeFile,
      openPath: (path) => shell.openPath(path),
      openExternal: (url) => shell.openExternal(url)
    })
    return { state: 'opened' as const }
  })
  ipcMain.handle('tlc:export-agent-response', async (event, rawRequest: unknown) => {
    assertTrustedSender(event)
    const request = exportResponseRequestSchema.parse(rawRequest)
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await showResponseSaveDialog(parentWindow, `${safeFileName(request.responseTitle)}.docx`, (options, parent) => {
      return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
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
  return [...value].map((character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character).join('').replace(/[. ]+$/g, '').slice(0, 120) || 'TLC agent response'
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f5f7fa',
    title: 'TLC Account Team Intelligence',
    icon: appIcon,
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
  window.on('blur', () => voiceHost.cancel())
  window.webContents.on('destroyed', () => voiceHost.dispose())

  if (developmentUrl) {
    await window.loadURL(developmentUrl)
  } else {
    await window.loadFile(rendererFile)
  }
}

if (!startupBlocked) {
  registerIpc()
  void app.whenReady().then(createWindow)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})

app.on('before-quit', () => {
  voiceHost.dispose()
  void configuredWorkflowHost?.dispose()
})