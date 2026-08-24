import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { mcemRequestSchema, type AuthStatus, type DesktopDataStatus } from '../../../../packages/common/index.js'
import { FixtureMsxConnector, LiveMsxConnector } from '../../../../packages/connectors/msx/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator } from '../../../../packages/orchestrator/index.js'
import { AzureCliMsxTokenProvider } from './azure-cli-token-provider.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(currentDirectory, '../..')
const rendererFile = resolve(desktopRoot, 'dist/renderer/index.html')
const preloadFile = resolve(desktopRoot, 'dist-electron/preload/index.cjs')
const developmentUrl = process.env['VITE_DEV_SERVER_URL']
const allowedRendererUrl = developmentUrl ?? pathToFileURL(rendererFile).toString()
const dataMode = process.env['TLC_DATA_MODE'] === 'sample' ? 'sample' : 'live'
const tokenProvider = new AzureCliMsxTokenProvider()
const mcemConnector = new LocalPdfMcemGuidanceConnector(resolve(desktopRoot, '../../docs/knowledge/MCEM Overview.pdf'))
const msxConnector = dataMode === 'sample'
  ? new FixtureMsxConnector()
  : new LiveMsxConnector(tokenProvider)
const orchestrator = new ThinSliceOrchestrator(
  msxConnector,
  mcemConnector
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