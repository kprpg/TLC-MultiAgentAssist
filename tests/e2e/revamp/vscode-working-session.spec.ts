import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { createWorkingSessionService, folderOutput } from '../../../packages/orchestrator/working-session/index.js'

declare global {
  interface Window { invokeWorkingSessionBridge(message: unknown): Promise<unknown> }
}

let documents: string | undefined
test.afterEach(async () => { if (documents) await rm(documents, { recursive: true, force: true }); documents = undefined })

/** The real built VS Code webview against the real host router; folder opening is a host-only effect, so it is recorded. */
async function mount(page: Page, opened: string[]): Promise<string> {
  documents = await mkdtemp(join(tmpdir(), 'tlc-ws-e2e-'))
  const provider = {
    ...createSampleDataProvider(),
    workingSession: createWorkingSessionService({ mode: 'sample', openOutput: async (name) => folderOutput(documents!, name) })
  }
  await page.exposeFunction('invokeWorkingSessionBridge', async (message: { method?: string; id?: string; params?: { folderPath?: string } }) => {
    if (message.method === 'workingSessionOpenFolder') { opened.push(String(message.params?.folderPath)); return { kind: 'response', id: message.id, ok: true, result: null } }
    return routeBridgeMessage(provider as never, message)
  })
  await page.route('**/', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><style>:root{--vscode-editor-background:#fff;--vscode-foreground:#333;--vscode-font-family:"Segoe UI",sans-serif;--vscode-textLink-foreground:#006ab1;--vscode-panel-border:#d1d1d1}</style></head><body><div id="root" data-mode="sample"></div></body></html>'
  }))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'acquireVsCodeApi', {
      value: () => ({
        getState: () => undefined, setState: () => undefined,
        postMessage: (message: { kind: string }) => {
          if (message.kind === 'request') void window.invokeWorkingSessionBridge(message).then((reply) => window.postMessage(reply, window.location.origin))
        }
      })
    })
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')
  await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
  await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
  return documents
}

test('VS Code prepares the folder beside Run MCEM Coach, writes it under Documents\\TLC and opens it', async ({ page }) => {
  const opened: string[] = []
  const root = await mount(page, opened)
  await expect(page.locator('.actions').filter({ has: page.getByRole('button', { name: 'Prepare working session' }) }).getByRole('button', { name: 'Run MCEM Coach' })).toBeVisible()
  await page.getByRole('button', { name: 'Prepare working session' }).click()
  const panel = page.getByRole('dialog', { name: 'Prepare working session' })

  await panel.getByRole('button', { name: 'Suggest topic' }).click()
  await expect(panel.getByRole('textbox', { name: 'Topic' })).not.toHaveValue('')
  await panel.getByRole('button', { name: 'Prepare' }).click()
  await expect(panel.getByRole('status').first()).toContainText(/Prepared \d+ file\(s\)/)
  await expect(panel.getByText(/Saved to .*TLC/)).toBeVisible()

  const [folderName] = await readdir(join(root, 'TLC'))
  expect(folderName).toContain(' - ')
  const files = await readdir(join(root, 'TLC', folderName!), { recursive: true })
  expect(files.map(String)).toEqual(expect.arrayContaining(['README.md', 'manifest.json', join('iac', 'main.bicep')]))
  expect(JSON.parse(await readFile(join(root, 'TLC', folderName!, 'manifest.json'), 'utf8')).mode).toBe('sample')

  await panel.getByRole('button', { name: 'Open folder' }).click()
  await expect.poll(() => opened.length).toBe(1)
  expect(opened[0]).toBe(join(root, 'TLC', folderName!))
})

test('VS Code shows why a working session could not be prepared', async ({ page }) => {
  await mount(page, [])
  await page.getByRole('button', { name: 'Prepare working session' }).click()
  const panel = page.getByRole('dialog', { name: 'Prepare working session' })
  await panel.getByRole('button', { name: 'Suggest topic' }).click()
  await panel.getByRole('textbox', { name: 'Topic' }).fill('')
  await panel.getByRole('button', { name: 'Prepare' }).click()
  await expect(panel.getByRole('alert')).toContainText('Check Topic.')
})
