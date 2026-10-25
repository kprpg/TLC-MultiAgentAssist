import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { expect, test, type Page } from '@playwright/test'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { createSampleAuthentication } from '../../../apps/web/src/authentication.js'
import { buildStaticHandler, setSecurityHeaders } from '../../../apps/web/src/hosting.js'
import { createWebWorkingSessionResolver } from '../../../apps/web/src/working-session.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'

let server: Server | undefined
let store: LocalStore | undefined
const requests: Array<{ path: string; body: string }> = []

test.afterEach(async () => {
  if (server) await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()))
  server = undefined
  store?.close()
  store = undefined
  requests.length = 0
})

/** The hosted Web app with the real working-session service in sample mode (bundled content, no network). */
async function hostedWeb(): Promise<string> {
  store = new LocalStore()
  const msx = new LocalStoreMsxConnector(store)
  const runtime = new ThinSliceOrchestrator(msx, new LocalPdfMcemGuidanceConnector(resolve('docs', 'knowledge', 'MCEM Overview.pdf')), {}) as unknown as WebRuntime
  const api = buildWebApiHandler({
    createRuntime: () => runtime, authenticate: createSampleAuthentication(),
    resolveWorkingSessionHost: createWebWorkingSessionResolver({ mode: 'sample', createRuntime: () => runtime })
  })
  const staticHandler = buildStaticHandler(resolve('apps', 'desktop', 'dist', 'revamp'), 'sample')
  server = createServer((request, response) => {
    setSecurityHeaders(response)
    void (async () => { if (!(await api(request, response))) await staticHandler(request, response) })().catch((error: unknown) => {
      response.statusCode = 500
      response.end(error instanceof Error ? error.message : 'Test host failed.')
    })
  })
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

async function openLauncher(page: Page, base: string) {
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/working-session/')) requests.push({ path: new URL(request.url()).pathname, body: request.postData() ?? '' })
  })
  await page.goto(base)
  await page.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
  const blade = page.getByRole('region', { name: 'Opportunities blade' })
  await blade.getByRole('button', { name: /^Grid operations modernization/ }).click()
  await blade.locator('.blade-header').getByRole('button', { name: 'Prepare working session' }).click()
  return page.getByRole('dialog', { name: 'Prepare working session' })
}

test('deduces an editable topic, prepares the folder and downloads it as a zip', async ({ page }) => {
  const base = await hostedWeb()
  const panel = await openLauncher(page, base)

  await expect(panel.getByRole('combobox', { name: 'Milestone' })).toBeVisible()
  expect(requests).toEqual([])
  await panel.getByRole('button', { name: 'Suggest topic' }).click()

  const topic = panel.getByRole('textbox', { name: 'Topic' })
  await expect(topic).toBeVisible()
  await expect(panel.getByText(/Matched from the titles and comments/)).toBeVisible()
  await topic.fill('Grid analytics proof of concept')
  await panel.getByRole('checkbox', { name: /PowerPoint decks/ }).uncheck()
  await panel.getByRole('button', { name: 'Prepare' }).click()

  await expect(panel.getByRole('status').first()).toContainText(/Prepared \d+ file\(s\)/)
  await expect(panel.getByText('Microsoft Learn', { exact: true }).first()).toBeVisible()
  await expect(panel.getByText('Deployment templates')).toBeVisible()
  expect(JSON.parse(requests.find((request) => request.path.endsWith('/prepare'))!.body)).toMatchObject({
    topic: { topic: 'Grid analytics proof of concept' }, deliverables: { decks: false, learn: true, iac: true }
  })

  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download zip' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
  const zip = await JSZip.loadAsync(await readFile((await download.path())!))
  const names = Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name)
  expect(names.some((name) => name.endsWith('/iac/main.bicep'))).toBe(true)
  expect(names.some((name) => name.endsWith('/manifest.json'))).toBe(true)
  const readme = names.find((name) => name.endsWith('/README.md'))!
  expect(await zip.file(readme)!.async('string')).toContain('Grid analytics proof of concept')
})

test('explains a failure and keeps the panel usable', async ({ page }) => {
  const base = await hostedWeb()
  const panel = await openLauncher(page, base)
  await page.route('**/api/working-session/topic', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'The topic service is unavailable.' }) }))
  await panel.getByRole('button', { name: 'Suggest topic' }).click()
  await expect(panel.getByRole('alert')).toContainText('The topic service is unavailable.')
  await expect(panel.getByRole('button', { name: 'Suggest topic' })).toBeEnabled()
})
