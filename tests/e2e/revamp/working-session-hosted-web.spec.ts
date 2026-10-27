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
import { deferredSignal } from './operation-result-fixtures.js'

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

test('@operation-retention restores a Web preparation completed after navigating away without another request', async ({ page }) => {
  const base = await hostedWeb()
  const panel = await openLauncher(page, base)
  await panel.getByRole('button', { name: 'Suggest topic' }).click()
  await panel.getByRole('textbox', { name: 'Topic' }).fill('Retained grid preparation')
  await panel.getByRole('checkbox', { name: /PowerPoint decks/ }).uncheck()
  const arrived = deferredSignal()
  const release = deferredSignal()
  const delivered = deferredSignal()
  let preparations = 0
  await page.route('**/api/working-session/prepare', async (route) => {
    preparations++
    const response = await route.fetch()
    arrived.resolve()
    await release.promise
    await route.fulfill({ response })
    delivered.resolve()
  })

  try {
    await panel.getByRole('button', { name: 'Prepare', exact: true }).click()
    await arrived.promise
    await page.getByRole('button', { name: 'Discover', exact: true }).click()
    await expect(panel).toHaveCount(0)
    release.resolve()
    await delivered.promise
    await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
    await page.getByRole('button', { name: 'Prepare working session', exact: true }).click()
    await expect(panel.getByRole('status').first()).toContainText(/Prepared \d+ file/)
    await expect(panel.getByRole('button', { name: 'Download zip' })).toBeVisible()
    expect(preparations).toBe(1)
    await panel.getByRole('button', { name: 'Prepare again' }).click()
    await expect(panel.getByRole('textbox', { name: 'Topic' })).toHaveValue('Retained grid preparation')
  } finally {
    release.resolve()
  }
})

test('@operation-retention restores pending Web work without dispatching it twice', async ({ page }) => {
  const panel = await openLauncher(page, await hostedWeb())
  const arrived = deferredSignal()
  const release = deferredSignal()
  let topics = 0
  await page.route('**/api/working-session/topic', async (route) => {
    topics++
    const response = await route.fetch()
    arrived.resolve()
    await release.promise
    await route.fulfill({ response })
  })
  try {
    await panel.getByRole('button', { name: 'Suggest topic' }).click()
    await arrived.promise
    await page.getByRole('button', { name: 'Discover', exact: true }).click()
    await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
    await page.getByRole('button', { name: 'Prepare working session' }).click()
    await expect(panel.getByRole('status')).toContainText('Working...')
    await expect(panel.getByRole('button', { name: 'Suggest topic' })).toHaveCount(0)
    expect(topics).toBe(1)
    release.resolve()
    await expect(panel.getByRole('textbox', { name: 'Topic' })).not.toHaveValue('')
    expect(topics).toBe(1)
  } finally { release.resolve() }
})

test('@operation-retention retains a background Web failure without notifying another view', async ({ page }) => {
  const panel = await openLauncher(page, await hostedWeb())
  const arrived = deferredSignal()
  const release = deferredSignal()
  const delivered = deferredSignal()
  await page.route('**/api/working-session/topic', async (route) => {
    arrived.resolve()
    await release.promise
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Background topic unavailable' }) })
    delivered.resolve()
  })
  try {
    await panel.getByRole('button', { name: 'Suggest topic' }).click()
    await arrived.promise
    await page.getByRole('button', { name: 'Discover', exact: true }).click()
    release.resolve()
    await delivered.promise
    await expect(page.getByText('Background topic unavailable')).toHaveCount(0)
    await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
    await page.getByRole('button', { name: 'Prepare working session' }).click()
    await expect(panel.getByRole('alert')).toContainText('Background topic unavailable')
    await expect(panel.getByRole('button', { name: 'Suggest topic' })).toBeEnabled()
    expect(requests.filter((entry) => entry.path.endsWith('/topic'))).toHaveLength(1)
  } finally { release.resolve() }
})

test('@operation-retention keeps expired download errors explicit without regenerating retained output', async ({ page }) => {
  const panel = await openLauncher(page, await hostedWeb())
  await panel.getByRole('button', { name: 'Suggest topic' }).click()
  await expect(panel.getByRole('textbox', { name: 'Topic' })).toBeVisible()
  await panel.getByRole('checkbox', { name: /PowerPoint decks/ }).uncheck()
  await panel.getByRole('button', { name: 'Prepare', exact: true }).click()
  await expect(panel.getByRole('status').first()).toContainText(/Prepared \d+ file/)
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Discover', exact: true }).click()
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare working session' }).click()
  await expect(panel.getByRole('button', { name: 'Download zip' })).toBeVisible()
  await page.route('**/api/working-session/download/**', (route) => route.fulfill({
    status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'The download has expired. Prepare the working session again.' })
  }))
  await panel.getByRole('button', { name: 'Download zip' }).click()
  await expect(panel.getByRole('alert')).toContainText('expired')
  expect(requests.filter((entry) => entry.path.endsWith('/prepare'))).toHaveLength(1)
})
