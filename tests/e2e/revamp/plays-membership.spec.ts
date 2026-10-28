import { expect, test, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { membershipOutput, membershipRun, membershipView } from '../workflow-membership-fixtures.js'
import { workflowDefinitions } from './workflow-fixtures.js'

const definition = workflowDefinitions[0]!

async function exercise(page: Page, surface: 'web' | 'desktop' | 'vscode') {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.getByRole('button', { name: 'Plays', exact: true }).click()
  await page.locator(surface === 'vscode' ? '.play-row' : '.workflow-card').filter({ hasText: 'WF-001' })
    .getByRole('button', { name: surface === 'vscode' ? /^(Run|Re-run)$/ : 'Run workflow' }).click()
  const filter = page.getByLabel('Filter Play results')
  await expect(filter).toHaveValue('all')
  const row = (title: string) => page.locator(surface === 'vscode' ? '.queue-item' : '.workflow-queue article').filter({ hasText: title })
  await expect(row('Review member queue item').getByRole('button', { name: /^Send to/ })).toBeEnabled()
  const disabled = row('Review nonmember queue item').getByRole('button', { name: /^Send to/ })
  await expect(disabled).toBeDisabled()
  await disabled.locator('..').hover()
  await expect(page.getByRole('tooltip').filter({ hasText: /not a member/ })).toBeVisible()
  await filter.selectOption('mine')
  await expect(page.getByText('1 of 2 items', { exact: true })).toBeVisible()
  await expect(row('Review nonmember queue item')).toHaveCount(0)
  await expect(page.getByText('Nonmember result record', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Member result record', { exact: true })).toBeVisible()
  await filter.selectOption('all')
  await expect(page.getByText('2 of 2 items', { exact: true })).toBeVisible()
  await expect(row('Review nonmember queue item')).toBeVisible()
  await expect(page.getByText('Nonmember result record', { exact: true })).toBeVisible()
}

test('Web restores All results and disables nonmember Guidance without rerunning the Play or model', async ({ page }) => {
  let starts = 0
  let modelCalls = 0
  await page.route('**/api/agent-task*', (route) => { modelCalls++; return route.fulfill({ status: 500, json: { error: 'Unexpected model call' } }) })
  await page.route('**/api/workflows/*', (route) => {
    const operation = new URL(route.request().url()).pathname.split('/').at(-1)
    if (operation === 'list') return route.fulfill({ json: [definition] })
    if (operation === 'history') return route.fulfill({ json: [] })
    if (operation === 'start') { starts++; return route.fulfill({ json: membershipRun }) }
    if (operation === 'view') return route.fulfill({ json: membershipView(route.request().postDataJSON().filter) })
    return route.fulfill({ json: { run: membershipRun, output: membershipOutput } })
  })
  await page.goto('/')
  await exercise(page, 'web')
  expect(starts).toBe(1)
  expect(modelCalls).toBe(0)
})

declare global { interface Window { invokeMembershipBridge(message: unknown): Promise<unknown> } }

test('VS Code filters records and queues consistently and explains disabled Guidance', async ({ page }) => {
  const base = createSampleDataProvider()
  let starts = 0
  let modelCalls = 0
  const provider = {
    ...base, listWorkflowDefinitions: async () => [definition],
    startWorkflow: async () => { starts++; return membershipRun },
    getWorkflowRun: async () => ({ run: membershipRun, output: membershipOutput }),
    getWorkflowResultsView: async (_runId: string, filter: 'all' | 'mine') => membershipView(filter),
    runAgentTask: async () => { modelCalls++; throw new Error('Unexpected model call') }
  }
  try {
    await page.exposeFunction('invokeMembershipBridge', (message: unknown) => routeBridgeMessage(provider, message))
    await page.route('**/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root" data-mode="sample"></div></body></html>' }))
    await page.addInitScript(() => {
      Object.defineProperty(window, 'acquireVsCodeApi', { value: () => ({
        getState: () => undefined, setState: () => undefined,
        postMessage: (message: { kind: string }) => {
          if (message.kind === 'request') void window.invokeMembershipBridge(message).then((reply) => window.postMessage(reply, window.location.origin))
        }
      }) })
    })
    await page.goto('/')
    await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
    await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
    await exercise(page, 'vscode')
    expect(starts).toBe(1)
    expect(modelCalls).toBe(0)
  } finally { await base.dispose() }
})

test('Desktop uses IPC for the same reversible membership filter and disabled-action tooltip', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tlc-membership-'))
  const app = await electron.launch({
    args: [resolve('apps', 'desktop'), `--user-data-dir=${directory}`],
    env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_AI_MODE: 'sample', TLC_UI_MODE: '' }
  })
  try {
    await app.evaluate(({ ipcMain }, fixtures) => {
      process.env.TLC_MEMBERSHIP_STARTS = '0'
      for (const operation of ['list', 'history', 'start', 'get', 'view']) ipcMain.removeHandler(`tlc:workflow-${operation}`)
      ipcMain.handle('tlc:workflow-list', () => [fixtures.definition])
      ipcMain.handle('tlc:workflow-history', () => [])
      ipcMain.handle('tlc:workflow-start', () => {
        process.env.TLC_MEMBERSHIP_STARTS = String(Number(process.env.TLC_MEMBERSHIP_STARTS) + 1)
        return fixtures.run
      })
      ipcMain.handle('tlc:workflow-get', () => ({ run: fixtures.run, output: fixtures.output }))
      ipcMain.handle('tlc:workflow-view', (_event, request: { filter: 'all' | 'mine' }) => fixtures.views[request.filter])
    }, { definition, run: membershipRun, output: membershipOutput, views: { all: membershipView('all'), mine: membershipView('mine') } })
    await exercise(await app.firstWindow(), 'desktop')
    expect(await app.evaluate(() => process.env.TLC_MEMBERSHIP_STARTS)).toBe('1')
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }) }
})
