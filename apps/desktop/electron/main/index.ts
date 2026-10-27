import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, shell, type IpcMainInvokeEvent } from 'electron'
import { AzureCliCredential } from '@azure/identity'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { accountListOptionsSchema, accountSearchRequestSchema, accountVisibilitySchema, agentTaskRequestSchema, agentTaskStreamEventSchema, createMilestoneActivityRequestSchema, emailComposeRequestSchema, exportResponseRequestSchema, loadDataverseEntityMap, loadMcpServerRegistry, loadMcpToolPolicy, mcemRequestSchema, mcemStageTransitionRequestSchema, meetingChangeSetApprovalSchema, meetingChangeSetProposalSchema, milestoneUpdateSchema, opportunityUpdateSchema, seDomainSchema, type AgentTaskStreamEvent, type AuthStatus, type DesktopDataStatus, type McpServer, type PerformanceReporter } from '../../../../packages/common/index.js'
import {
  loadFoundryEnvironment,
  type FoundryEnvironment
} from '../../../../packages/common/configuration/foundry-environment.js'
import { FixtureMsxConnector, LiveMeetingCaptureConnector, LiveMsxConnector, msxWriteMetadataFromEnvironment } from '../../../../packages/connectors/msx/index.js'
import { createLocalStoreMsxConnector } from '../../../../packages/connectors/local-store/index.js'
import { SampleRecordCreationCatalog } from '../../../../packages/connectors/local-store/sample-record-creation-catalog.js'
import { JsonFilePortfolioPreferenceStore } from '../../../../packages/connectors/common/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../../packages/connectors/sharepoint/index.js'
import { createFoundryOpenAIClient } from '../../../../packages/connectors/foundry/index.js'
import { createFoundryMeetingExtractor } from '../../../../packages/agents/meeting-signal-extractor/src/foundry-extractor.js'
import { parseTranscriptContent } from '../../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'
import { ThinSliceOrchestrator, prewarmAgentDependencies, type AgentTaskContext, type TaskAgentRegistry } from '../../../../packages/orchestrator/index.js'
import { RecordCreationService } from '../../../../packages/orchestrator/record-creation/service.js'
import { createLivePlayWorkflowHost, createSampleWorkflowHost } from '../../../../packages/orchestrator/workflows/index.js'
import { createDesktopTaskAgents } from './task-agents.js'
import { AzureCliMsxTokenProvider } from './azure-cli-token-provider.js'
import { prepareFoundryEnvironmentFile } from './packaged-configuration.js'
import { createRuntimeCredentials } from './runtime-credentials.js'
import { openOutlookDraft } from './outlook-compose.js'
import { createResponseDocumentBuffer } from './response-document.js'
import { showResponseSaveDialog } from './response-save-dialog.js'
import { buildSampleAgentResponse } from './sample-agent-response.js'
import { openConfigurationAndExit } from './startup-dialog.js'
import { createWorkflowIpcHandlers } from './workflow-ipc.js'
import { createRecordCreationIpcHandlers } from './record-creation-ipc.js'
import { SharedVoiceInputHost } from '../../../../packages/orchestrator/voice-input.js'
import { WindowsVoiceCaptureDriver } from '../../../../packages/connectors/common/windows-voice.js'
import { createVoiceIpcHandler, voiceIpcChannel } from './voice-ipc.js'
import { createSellerDashboardHost } from '../../../../packages/orchestrator/seller-dashboard.js'
import { createSeReportingHost, seReportingScopes } from '../../../../packages/orchestrator/se-reporting/composition.js'
import { createSeReportingIpcHandler, seReportingIpcChannel } from './se-reporting-ipc.js'
import { createSellerDashboardIpcHandler, sellerDashboardIpcChannel } from './seller-dashboard-ipc.js'
import { createStagePipelineIpcHandler, stagePipelineIpcChannel } from './stage-pipeline-ipc.js'
import { createStagePipelineReviewHost } from '../../../../packages/orchestrator/stage-pipeline-review.js'
import { desktopWindowBounds } from './window-bounds.js'
import { createMutationSyncIpcHandler, createPortfolioIpcHandlers } from './portfolio-ipc.js'
import { createPresentationOwner } from '../../../shared/presentation-owner.js'
import { localMutationState, protectedMutationKey, type MutationState } from '../../../../packages/connectors/common/mutation-state.js'
import { createMutationSession, type MutationSession } from '../../../../packages/orchestrator/mutations/composition.js'
import { bindSourceToken } from '../../../../packages/orchestrator/mutations/core-adapter.js'
import { cacheControlRequestSchema, cacheControlResponseSchema } from '../../../../packages/common/contracts/cache-sync.js'
import { createKnowledgeSearch } from '../../../../packages/orchestrator/knowledge-search.js'
import { seismicGraphDefaultScope, seismicGraphScopes } from '../../../../packages/common/configuration/knowledge-sources.js'
import { meetingGraphDefaultScope, meetingScopesFor } from '../../../../packages/common/configuration/meeting-sources.js'
import { assertCliTokenCanReadMeetings, meetingSignInFailure } from '../../../../packages/connectors/common/meeting-source.js'
import { GraphMeetingConnector } from '../../../../packages/connectors/graph/meetings.js'
import { createKnowledgeSearchIpcHandler, knowledgeSearchIpcChannel } from './knowledge-ipc.js'
import {
  createWorkingSessionIpcHandlers, workingSessionOpenIpcChannel, workingSessionPrepareIpcChannel, workingSessionTopicIpcChannel
} from './working-session-ipc.js'
import {
  createBicepCliCompiler, createWorkingSessionService, deckConfigurationFromEnvironment, folderOutput, foundryStructuredModel, workingSessionModelName
} from '../../../../packages/orchestrator/working-session/index.js'
import { renderMarkdownDocument } from '../../../../packages/documents/markdown-document.js'
import { SampleInference } from '../../../../packages/orchestrator/sample-inference.js'
import { resolveSampleInferenceMode } from '../../../../packages/common/contracts/inference.js'

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
const sampleAiMode = dataMode === 'sample' ? resolveSampleInferenceMode(process.env) : undefined
// Concurrent Live and Sample processes must not lock the same Chromium caches.
if (dataMode === 'sample') {
  const sampleSessionDirectory = resolve(app.getPath('userData'), 'sample-session')
  mkdirSync(sampleSessionDirectory, { recursive: true })
  app.setPath('sessionData', sampleSessionDirectory)
}
const voiceHost = new SharedVoiceInputHost(new WindowsVoiceCaptureDriver(), () =>
  BrowserWindow.getAllWindows().some((window) => window.isVisible() && window.isFocused())
)

const preparedEnvironment = app.isPackaged || dataMode === 'live' || sampleAiMode === 'foundry'
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
} else if ((dataMode === 'live' || sampleAiMode === 'foundry') && preparedEnvironment) {
  try {
    runtimeEnvironment = await loadFoundryEnvironment(preparedEnvironment.filePath)
  } catch (error) {
    if (dataMode === 'sample') {
      console.warn('[sample-ai] configuration-unavailable; offline fallback will be labeled.')
    } else {
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
}

const authentication = runtimeEnvironment?.authentication
const fallbackCredential = new AzureCliCredential({ processTimeoutInMs: 30_000 })
const credentials = authentication
  ? createRuntimeCredentials(authentication)
  : { msx: fallbackCredential, foundry: fallbackCredential }
const sampleInference = dataMode === 'sample' ? new SampleInference({
  credential: credentials.foundry,
  ...(runtimeEnvironment ? { loadEnvironment: async () => runtimeEnvironment! } : {})
}) : undefined
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
const seReportingHost = createSeReportingHost({
  mode: dataMode,
  // The live MSX connector is created below; it is only dereferenced when a report is generated.
  dataverse: {
    readRows: (entitySet, parameters) => liveMsxConnector!.readRows(entitySet, parameters),
    listMilestoneTeamMilestoneIds: (userId) => liveMsxConnector!.listMilestoneTeamMilestoneIds(userId)
  },
  identity: async () => {
    const email = (await tokenProvider.getAuthStatus()).userEmail
    return email ? { key: email, email } : undefined
  },
  getToken: async (resource) => {
    const token = await credentials.msx.getToken(seReportingScopes[resource])
    if (!token) throw new Error('The reporting resource did not return a delegated token.')
    return token.token
  },
  foundryCredential: credentials.foundry,
  ...(sampleInference ? { inference: sampleInference } : {})
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
const sourceToken = bindSourceToken(() => tokenProvider.getAccessToken(), 'https://microsoftsales.crm.dynamics.com', () => clearSourceSession())
const liveMsxConnector = dataMode === 'sample'
  ? undefined
  : new LiveMsxConnector({ getAccessToken: sourceToken }, fetch, undefined, reportPerformance, msxWriteMetadataFromEnvironment(process.env), portfolioPreferenceStore)
// Keep the opt-in SQLite sample store across Desktop restarts; fixture mode remains in memory.
const localStoreMsxConnector = liveMsxConnector ? undefined : createLocalStoreMsxConnector({
  ...process.env,
  TLC_DATA_STORE: process.env['TLC_DATA_STORE'] || (sampleAiMode === 'foundry' ? 'sqlite' : 'fixture'),
  TLC_DATA_STORE_PATH: process.env['TLC_DATA_STORE_PATH']?.trim() || resolve(app.getPath('userData'), 'sample.sqlite')
})
if (sampleAiMode === 'foundry' && !localStoreMsxConnector) {
  throw new Error('Hybrid sample AI requires TLC_DATA_STORE=sqlite. Set TLC_AI_MODE=sample for offline fixtures.')
}
const msxConnector = liveMsxConnector ?? localStoreMsxConnector ?? new FixtureMsxConnector()
const stagePipelineHost = liveMsxConnector
  ? createStagePipelineReviewHost({ mode: 'live', source: liveMsxConnector })
  : createStagePipelineReviewHost({ mode: 'sample' })
const creationWriter = localStoreMsxConnector?.createRecordCreationWriter()
const recordCreation = new RecordCreationService(
  msxConnector,
  creationWriter ?? liveMsxConnector ?? new SampleRecordCreationCatalog(msxConnector),
  creationWriter ? { writer: creationWriter } : {}
)
// Meeting capture: absent for the in-memory fixture; the SQLite test store implements it directly. Live wraps the
// delegated MSX connection and lists/reads Teams meetings with a separate delegated Graph token.
const meetingGraph = liveMsxConnector ? new GraphMeetingConnector(async (purpose) => {
  const interactive = authentication?.mode === 'interactive-browser'
  let token: Awaited<ReturnType<typeof credentials.msx.getToken>>
  try { token = await credentials.msx.getToken(interactive ? [...meetingScopesFor(purpose)] : meetingGraphDefaultScope) } catch (error) {
    throw meetingSignInFailure(error)
  }
  if (!token) throw meetingSignInFailure('A delegated Microsoft Graph token was not returned.')
  return interactive ? token.token : assertCliTokenCanReadMeetings(token.token, purpose)
}) : undefined
const meetingConnector = liveMsxConnector ? new LiveMeetingCaptureConnector(liveMsxConnector, undefined, meetingGraph) : localStoreMsxConnector
const foundryOpenAIClient = dataMode === 'live' && runtimeEnvironment
  ? createFoundryOpenAIClient(runtimeEnvironment.foundry.projectEndpoint, credentials.foundry)
  : undefined
/** Foundry model-backed meeting-signal extractor when TLC_MEETING_EXTRACTOR=foundry; else the deterministic offline extractor. */
const meetingExtractor = sampleInference?.meetingExtractor() ?? (runtimeEnvironment && foundryOpenAIClient && (process.env['TLC_MEETING_EXTRACTOR'] ?? '').toLowerCase() === 'foundry'
  ? createFoundryMeetingExtractor({
    openAIClient: foundryOpenAIClient,
    model: process.env['TLC_MEETING_MODEL']?.trim() || 'gpt-6.1-sol',
    requestTimeoutMs: runtimeEnvironment.foundry.requestTimeoutMs
  })
  : undefined)
const taskAgents: TaskAgentRegistry = createDesktopTaskAgents({
  ...(sampleInference ? { inference: sampleInference } : {}),
  environment: runtimeEnvironment,
  credential: credentials.foundry,
  client: foundryOpenAIClient,
  performanceReporter: reportPerformance,
  sample: () => Object.fromEntries(
    (['account-pulse', 'mcem-coach', 'pursuit-executive', 'risk-solution-play'] as const).map((capability) => [capability, {
      version: 'sample-v2',
      agent: { invoke: async (context: AgentTaskContext) => buildSampleAgentResponse(capability, context) }
    }])
  ) as TaskAgentRegistry
})
const orchestrator = new ThinSliceOrchestrator(
  msxConnector,
  mcemConnector,
  taskAgents,
  reportPerformance,
  recordCreation,
  createKnowledgeSearch({
    mode: dataMode,
    getGraphToken: async () => {
      const token = await credentials.msx.getToken(authentication?.mode === 'interactive-browser' ? [...seismicGraphScopes] : seismicGraphDefaultScope)
      if (!token) throw new Error('A delegated Microsoft Graph token was not returned.')
      return token.token
    }
  })
)
const workingSessionModelId = workingSessionModelName(process.env)
const documentsFolder = () => process.env['TLC_DOCUMENTS_FOLDER']?.trim() || app.getPath('documents')
const workingSession = createWorkingSessionService({
  mode: dataMode,
  ...(sampleInference ? { inference: sampleInference } : {}),
  openOutput: async (folderName) => folderOutput(documentsFolder(), folderName),
  renderDocx: (title, markdown) => renderMarkdownDocument(title, markdown),
  knowledgeSearch: orchestrator,
  ...deckConfigurationFromEnvironment(process.env),
  ...(process.env['TLC_GITHUB_TOKEN']?.trim() ? { githubToken: process.env['TLC_GITHUB_TOKEN'].trim() } : {}),
  ...(dataMode === 'live' ? { compiler: createBicepCliCompiler() } : {}),
  ...(dataMode === 'live' && foundryOpenAIClient && workingSessionModelId ? { model: foundryStructuredModel(foundryOpenAIClient, workingSessionModelId) } : {})
})
const presentation = createPresentationOwner(orchestrator)
const clearSourceSession = () => presentation.session.clear()
const backgroundEnabled = process.env['TLC_BACKGROUND_SYNC'] === '1'
let mutationClosing = false
let mutationDisposed = false
let quitDrainComplete = false
let mutationState: MutationState = { durable: false, close() {} }
async function initializeMutations(): Promise<MutationSession> {
  if (backgroundEnabled || existsSync(resolve(app.getPath('userData'), 'mutation-state', `${dataMode}.sqlite`))) {
    const root = resolve(app.getPath('userData'), 'mutation-state')
    let key: Buffer | undefined
    if (dataMode === 'live') {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Protected receipt storage requires Windows encryption. Background writes were not enabled.')
      const keyPath = resolve(root, 'protected-key.bin')
      key = await protectedMutationKey({
        lockPath: resolve(root, 'key-init.lock'),
        read: async () => {
          try { return safeStorage.decryptString(await readFile(keyPath)) } catch (error) {
            if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined
            throw error
          }
        },
        write: (value) => writeFile(keyPath, safeStorage.encryptString(value), { flag: 'wx' })
      })
    }
    mutationState = await localMutationState(resolve(root, `${dataMode}.sqlite`), key)
  }
  return createMutationSession({
    core: orchestrator, mode: dataMode, source: 'desktop:https://microsoftsales.crm.dynamics.com',
    state: mutationState, enabled: backgroundEnabled, readCacheOwner: 'host',
    isCurrent: () => !mutationDisposed,
    ...(dataMode === 'live' ? { getToken: sourceToken,
      conditionalOperations: () => orchestrator.conditionalWriteOperations() } : {}),
    ...(meetingConnector ? { applyMeeting: (input) => meetingConnector.applyMeetingChangeSet(input) } : {})
  })
}
const mutationsReady = app.whenReady().then(initializeMutations)
void mutationsReady.catch(() => console.error('[mutation-sync] protected-state-unavailable'))
const mutations: MutationSession = {
  invoke: async (request) => (await mutationsReady).invoke(request),
  drain: async () => (await mutationsReady).drain(),
  resumeAdmission: async () => (await mutationsReady).resumeAdmission()
}
presentation.session.subscribe(() => {
  const state = presentation.session.getState()
  if (state.refreshing) return
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents.getURL().startsWith(allowedRendererUrl)) {
      window.webContents.send('tlc:cache-changed', { contractVersion: '1.0', state })
    }
  }
})
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
  ...(reportPerformance ? { performanceReporter: reportPerformance } : {}),
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
    if (!liveMsxConnector) throw new Error('Live Plays require the live MSX connection.')
    return (await portfolioPreferenceStore.read(await liveMsxConnector.getCurrentUserId())).hiddenAccountIds
  },
  onStepError: (info) => {
    console.error(`[play ${info.workflowId}] ${info.connector}/${info.operation} ${info.required ? 'required' : 'optional'} step failed: ${info.message}`)
  }
})
const workflowHost = configuredWorkflowHost?.host ?? createSampleWorkflowHost(async () => {
  const { accounts, opportunities } = await orchestrator.getPortfolioIndex({ contractVersion: '1.0' })
  return {
    accountIds: accounts.map((account) => account.id),
    opportunityIds: opportunities.map((opportunity) => opportunity.id)
  }
})

let agentPrewarmed = false
const agentStreams = new Map<string, AbortController>()
async function getDataStatus(): Promise<DesktopDataStatus> {
  if (dataMode === 'sample') {
    return {
      mode: 'sample',
      inference: { contractVersion: '1.0', mode: sampleInference!.mode },
      auth: { state: 'ready', detail: 'Automated fixture mode is active.' }
    }
  }
  const auth = await tokenProvider.getAuthStatus()
  if (auth.state === 'ready' && !agentPrewarmed && runtimeEnvironment) {
    agentPrewarmed = true
    void prewarmAgentDependencies({
      credential: credentials.foundry, scopes: runtimeEnvironment.authentication.scopes.foundry,
      guidance: mcemConnector, performanceReporter: reportPerformance
    })
  }
  return { mode: 'live', auth }
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
  const invokeMutationSync = createMutationSyncIpcHandler(mutations)
  ipcMain.handle('tlc:mutation-sync', async (event, request: unknown) => {
    assertTrustedSender(event)
    return invokeMutationSync(request)
  })
  ipcMain.handle('tlc:cache-control', (event, raw: unknown) => {
    assertTrustedSender(event)
    const request = cacheControlRequestSchema.parse(raw)
    if (request.operation === 'interest') {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const prefix = `renderer:${event.sender.id}`
      presentation.suspend(prefix, !owner?.isVisible() || !owner.isFocused())
      presentation.interest(`${prefix}:${request.consumer ?? 'main'}`, request.keys, request.active)
    }
    if (request.operation === 'refresh') presentation.session.refresh(request.opportunityId)
    return cacheControlResponseSchema.parse({ contractVersion: '1.0', state: presentation.session.getState() })
  })
  const invokeSellerDashboard = createSellerDashboardIpcHandler(sellerDashboardHost)
  const invokeSeReporting = createSeReportingIpcHandler(seReportingHost)
  const searchKnowledge = createKnowledgeSearchIpcHandler(orchestrator)
  const workingSessionHandlers = createWorkingSessionIpcHandlers(workingSession, {
    documentsFolder, openPath: (path) => shell.openPath(path)
  })
  ipcMain.handle(workingSessionTopicIpcChannel, (event, request: unknown) => {
    assertTrustedSender(event)
    return workingSessionHandlers.topic(request)
  })
  ipcMain.handle(workingSessionPrepareIpcChannel, (event, request: unknown) => {
    assertTrustedSender(event)
    return workingSessionHandlers.prepare(request)
  })
  ipcMain.handle(workingSessionOpenIpcChannel, (event, request: unknown) => {
    assertTrustedSender(event)
    return workingSessionHandlers.open(request)
  })
  ipcMain.handle(knowledgeSearchIpcChannel, (event, request: unknown) => {
    assertTrustedSender(event)
    return searchKnowledge(request)
  })
  ipcMain.handle(seReportingIpcChannel, (event, request: unknown) => {
    assertTrustedSender(event)
    return invokeSeReporting(request)
  })
  ipcMain.handle(sellerDashboardIpcChannel, (event, request: unknown) => {
    assertTrustedSender(event)
    return invokeSellerDashboard(request)
  })
  const invokeStagePipeline = createStagePipelineIpcHandler(stagePipelineHost)
  ipcMain.handle(stagePipelineIpcChannel, (event, request: unknown) => {
    assertTrustedSender(event)
    return invokeStagePipeline(request)
  })
  const invokeVoice = createVoiceIpcHandler(voiceHost)
  ipcMain.handle(voiceIpcChannel, (event, request: unknown) => {
    assertTrustedSender(event)
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Voice capture requires the main renderer frame.')
    return invokeVoice(request)
  })
  for (const [channel, handler] of Object.entries(createWorkflowIpcHandlers(workflowHost, () => orchestrator.getTeamMemberships()))) {
    ipcMain.handle(channel, (event, request: unknown) => {
      assertTrustedSender(event)
      return handler(request)
    })
  }
  for (const [channel, handler] of Object.entries(createRecordCreationIpcHandlers(orchestrator))) {
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
  ipcMain.handle('tlc:get-inference-mode', (event) => {
    assertTrustedSender(event)
    return sampleInference?.mode ?? null
  })
  ipcMain.handle('tlc:list-accounts', (event, options: unknown) => {
    assertTrustedSender(event)
    return presentation.session.listAccounts(accountListOptionsSchema.parse(options ?? {}).includeHidden)
  })
  for (const [channel, handler] of Object.entries(createPortfolioIpcHandlers({
    getPortfolioIndex: (request) => presentation.session.getPortfolioIndex(request.includeHidden),
    getPortfolioWorkspace: (request) => presentation.session.getPortfolioWorkspace(request),
    getDiscoverySnapshot: () => presentation.session.getDiscoverySnapshot()
  }))) {
    ipcMain.handle(channel, (event, request: unknown) => {
      assertTrustedSender(event)
      return handler(request)
    })
  }
  ipcMain.handle('tlc:search-accounts', (event, request: unknown) => {
    assertTrustedSender(event)
    const parsed = accountSearchRequestSchema.parse(request)
    return presentation.session.readDataset(`search:${parsed.matchBy}:${parsed.query}`, () => orchestrator.withFreshReadContext(() => orchestrator.searchAccounts(parsed)))
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
    return presentation.session.listOpportunities(z.string().min(1).parse(accountId))
  })
  ipcMain.handle('tlc:discover-opportunities', (event, domain: unknown) => {
    assertTrustedSender(event)
    return presentation.session.discoverOpportunities(seDomainSchema.parse(domain))
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
    return presentation.session.listMilestones(z.string().min(1).parse(opportunityId))
  })
  ipcMain.handle('tlc:list-discoverable-milestones', (event, opportunityId: unknown) => {
    assertTrustedSender(event)
    return presentation.session.listMilestones(z.string().min(1).max(200).parse(opportunityId), true)
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
  ipcMain.handle('tlc:run-agent-task-stream', async (event, request: unknown, streamId: unknown) => {
    assertTrustedSender(event)
    const id = z.string().uuid().parse(streamId)
    const parsed = agentTaskRequestSchema.parse(request)
    const controller = new AbortController()
    agentStreams.set(id, controller)
    try {
      let terminal: AgentTaskStreamEvent | undefined
      await orchestrator.runAgentTaskStream(parsed, (agentEvent) => {
        const validated = agentTaskStreamEventSchema.parse(agentEvent)
        if (validated.type === 'complete' || validated.type === 'error') terminal = validated
        if (!event.sender.isDestroyed()) event.sender.send('tlc:agent-task-event', { streamId: id, event: validated })
      }, controller.signal)
      if (!terminal) throw new Error('The agent response ended before it completed.')
      return terminal
    } finally {
      agentStreams.delete(id)
    }
  })
  ipcMain.handle('tlc:cancel-agent-task-stream', (event, streamId: unknown) => {
    assertTrustedSender(event)
    agentStreams.get(z.string().uuid().parse(streamId))?.abort()
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
    ...desktopWindowBounds(screen.getPrimaryDisplay().workArea),
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
  const prefix = `renderer:${window.webContents.id}`
  const updateInterest = () => presentation.suspend(prefix, !window.isVisible() || !window.isFocused())
  window.on('focus', updateInterest)
  window.on('show', updateInterest)
  window.on('hide', updateInterest)
  window.on('minimize', updateInterest)
  window.on('blur', () => { voiceHost.cancel(); updateInterest() })
  window.webContents.on('destroyed', () => { presentation.forget(prefix); voiceHost.dispose() })
  window.webContents.on('will-prevent-unload', (event) => {
    const close = dialog.showMessageBoxSync(window, {
      type: 'warning', buttons: ['Keep open', 'Close and recover later'], defaultId: 0, cancelId: 0,
      message: 'Confirmed source changes may still be pending.',
      detail: 'Closing does not undo a sent change. Reopen with the same source account to check private receipts before repeating an uncertain write.'
    })
    if (close === 1) event.preventDefault()
    else {
      mutationClosing = false; quitDrainComplete = false
      void mutations.resumeAdmission().catch(() => console.error('[mutation-sync] resume-admission-failed'))
    }
  })

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

app.on('before-quit', (event) => {
  if ((!backgroundEnabled && !mutationState.durable) || quitDrainComplete) return
  event.preventDefault()
  if (mutationClosing) return
  mutationClosing = true
  void mutations.drain().then(() => { quitDrainComplete = true; setImmediate(() => app.quit()) },
    () => { console.error('[mutation-sync] shutdown-outcome-unconfirmed'); quitDrainComplete = true; setImmediate(() => app.quit()) })
})
app.on('will-quit', () => {
  mutationDisposed = true
  presentation.dispose()
  mutationState.close()
  voiceHost.dispose()
  void configuredWorkflowHost?.dispose()
})