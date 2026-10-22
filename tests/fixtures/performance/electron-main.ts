import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { createPortfolioIpcHandlers } from '../../../apps/desktop/electron/main/portfolio-ipc.js'
import { accountListOptionsSchema, mcemRequestSchema, agentTaskRequestSchema } from '../../../packages/common/contracts/index.js'
import { seDomainSchema } from '../../../packages/common/configuration/se-domains.js'
import { createControlledLiveBackend } from './backend.js'

declare global {
  var tlcPerformanceFixture: { reset(): void; metrics(): { tokenCalls: number; logicalCalls: number } }
}

async function main() {
  const upstream = process.env['TLC_PERFORMANCE_UPSTREAM']
  if (!upstream) throw new Error('The isolated performance source is required.')
  let backend = createControlledLiveBackend(upstream, true)
  let logicalCalls = 0
  globalThis.tlcPerformanceFixture = {
    reset: () => { backend = createControlledLiveBackend(upstream, true); logicalCalls = 0 },
    metrics: () => ({ tokenCalls: backend.tokenCalls(), logicalCalls })
  }
  await app.whenReady()
  const window = new BrowserWindow({
    show: false, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  const handlers: Record<string, (input: unknown) => Promise<unknown>> = {
    'tlc:list-accounts': (input) => backend.core.listAccounts(accountListOptionsSchema.parse(input ?? {})),
    'tlc:list-opportunities': (input) => backend.core.listOpportunities(z.string().parse(input)),
    'tlc:list-milestones': (input) => backend.core.listMilestones(z.string().parse(input)),
    'tlc:discover-opportunities': (input) => backend.core.discoverOpportunities(seDomainSchema.parse(input)),
    'tlc:run-mcem-coach': (input) => backend.core.runMcemCoach(mcemRequestSchema.parse(input)),
    'tlc:run-agent-task': (input) => backend.core.runAgentTask(agentTaskRequestSchema.parse(input)),
    ...createPortfolioIpcHandlers({
      getPortfolioIndex: (input) => backend.core.getPortfolioIndex(input),
      getDiscoverySnapshot: (input) => backend.core.getDiscoverySnapshot(input),
      getPortfolioWorkspace: (input) => backend.core.getPortfolioWorkspace(input)
    })
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, input: unknown) => {
      if (event.sender.id !== window.webContents.id) throw new Error('Untrusted performance fixture sender.')
      logicalCalls++
      return handler(input)
    })
  }
  await window.loadURL('data:text/html,<!doctype html><title>Isolated backend performance fixture</title>')
  window.on('closed', () => app.quit())
}

void main().catch((error: unknown) => { console.error('Backend performance fixture failed.', error); app.exit(1) })
