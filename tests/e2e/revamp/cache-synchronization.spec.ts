import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, _electron as electron } from '@playwright/test'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { createMutationSession } from '../../../packages/orchestrator/mutations/composition.js'
import { buildWebApiHandler } from '../../../apps/web/src/app.js'
import { createSampleAuthentication } from '../../../apps/web/src/authentication.js'
import { buildStaticHandler, setSecurityHeaders } from '../../../apps/web/src/hosting.js'
import { createTeamsHandler, readBody } from '../../../apps/teams/src/app.js'
import { createTeamsDataModeRouter } from '../../../apps/teams/src/data-mode-router.js'
import { buildLiveDataProvider } from '../../../apps/vscode-extension/src/live-provider-core.js'
import { withPresentationCache } from '../../../apps/vscode-extension/src/presentation-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'

const cleanup: Array<() => Promise<void>> = []
test.afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function controlledSource(surface: 'web' | 'vscode' | 'teams') {
  const services = await createSampleApplicationServices()
  const store = new SqliteDocumentStore()
  const core = services.orchestrator
  const original = core.updateOpportunity.bind(core)
  let release!: () => void
  const gate = new Promise<void>((resolveWrite) => { release = resolveWrite })
  let writes = 0
  core.updateOpportunity = async (id, input) => { writes++; await gate; return original(id, input) }
  const mutations = createMutationSession({
    core, mode: 'sample', source: 'sanitized-ui-test', state: { store, durable: true, close() {} },
    enabled: true, readCacheOwner: surface === 'vscode' ? 'host' : 'client'
  })
  const provider = withPresentationCache(buildLiveDataProvider({
    orchestrator: core, host: services.workflows, account: 'synthetic', dispose: async () => {}
  }, 'sample'))
  provider.mutationSync = (input) => mutations.invoke(input)
  const configuration = { mode: 'sample' as const, origin: 'http://127.0.0.1', environmentId: 'sample' }
  const teams = createTeamsHandler({
    configuration, store, backgroundSync: true, durableMutationState: true, resolveServices: async () => services,
    authority: { verify: async () => ({ revision: 'synthetic', canConfigure: true, canPublish: true, audienceEligible: true }) }
  })
  const teamsRouter = createTeamsDataModeRouter({ configuration, initialMode: 'sample', sample: teams })
  const api = buildWebApiHandler({
    authenticate: createSampleAuthentication(),
    createRuntime: () => Object.assign(core, {
      mutationSync: (input: Parameters<typeof mutations.invoke>[0]) => mutations.invoke(input),
      listMeetingTranscripts: async () => [], getMeetingTranscript: async () => null,
      proposeMeetingChangeSet: async () => { throw new Error('Not used by this controlled write test.') },
      applyMeetingChangeSet: async () => { throw new Error('Not used by this controlled write test.') }
    })
  })
  const serve = buildStaticHandler(resolve('apps', surface === 'teams' ? 'teams' : 'desktop', 'dist', surface === 'teams' ? 'client' : 'revamp'), 'sample', true)
  const server = createServer((request, response) => {
    setSecurityHeaders(response)
    void (async () => {
      if (request.url === '/__test/bridge' && request.method === 'POST') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(await routeBridgeMessage(provider, await readBody(request))))
      } else if (surface === 'vscode' && ['/__test/webview.js', '/__test/webview.css'].includes(request.url ?? '')) {
        const css = request.url?.endsWith('.css')
        response.setHeader('content-type', css ? 'text/css' : 'text/javascript')
        response.end(await readFile(resolve('apps', 'vscode-extension', 'dist', 'webview', css ? 'webview.css' : 'webview.js')))
      } else if (surface === 'vscode' && request.url === '/') {
        response.setHeader('content-type', 'text/html')
        response.end('<!doctype html><html><head><style>:root{--vscode-editor-background:#fff;--vscode-foreground:#333;--vscode-font-family:"Segoe UI",sans-serif;--vscode-textLink-foreground:#006ab1;--vscode-panel-border:#ddd}</style><link rel="stylesheet" href="/__test/webview.css"></head><body><div id="root" data-mode="sample" data-background-sync="1" data-cache-owner="host"></div><script src="/__test/webview.js" defer></script></body></html>')
      } else if (!(surface === 'teams' ? await teamsRouter(request, response) : await api(request, response))) {
        await serve(request, response)
      }
    })().catch(() => { response.statusCode = 500; response.end('Controlled source fixture failed.') })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Controlled source listener did not start.')
  const base = `http://127.0.0.1:${address.port}`
  configuration.origin = base
  cleanup.push(async () => {
    release()
    await Promise.all([mutations.drain(), teams.drainMutations()])
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()))
    await provider.dispose(); store.close(); await services.dispose()
  })
  return { base, release, writes: () => writes, core,
    changeSource: (comments: string) => original('opp-grid-modernization', { comments }) }
}

test('requires a new explicit current-values confirmation when an open editor loses its source base', async ({ page }) => {
  const source = await controlledSource('web')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(source.base)
  await page.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
  await page.getByRole('button', { name: 'Edit Grid operations modernization' }).click()
  await page.getByRole('menuitem', { name: 'Opportunity Comments' }).click()
  const editor = page.getByLabel('Edit opportunity comments')
  const draft = 'Retained sanitized draft requiring new review'
  await editor.getByRole('textbox', { name: 'Opportunity Comments' }).fill(draft)
  await source.changeSource('Updated by another source editor')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Review current source values', exact: true })).toBeVisible()
  expect(source.writes()).toBe(0)
  await page.getByRole('button', { name: 'Review current source values', exact: true }).click()
  const review = page.getByRole('region', { name: 'Review updated source values', exact: true })
  await expect(review).toContainText('Updated by another source editor')
  await expect(review).toContainText(draft)
  await expect(review.getByRole('button', { name: 'Confirm reviewed change' })).toBeDisabled()
  expect(source.writes()).toBe(0)
  await review.getByRole('checkbox').check()
  await review.getByRole('button', { name: 'Confirm reviewed change' }).click()
  await expect(page.getByText('Saving 1 confirmed change in the background', { exact: true })).toBeVisible()
  source.release()
  await expect(page.getByText('Saving 1 confirmed change in the background', { exact: true })).toBeHidden()
  expect((await source.core.getOpportunitySnapshot('opp-grid-modernization')).opportunity.comments).toBe(draft)
  expect(source.writes()).toBe(1)
})

for (const surface of ['web', 'vscode', 'teams'] as const) {
  test(`${surface} keeps confirmed writes pending while unrelated browsing remains available`, async ({ page }) => {
    const source = await controlledSource(surface)
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await page.setViewportSize({ width: 1600, height: 1000 })
    if (surface === 'vscode') {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'acquireVsCodeApi', { value: () => ({
          getState: () => undefined, setState: () => undefined,
          postMessage: (message: { kind: string; id: string }) => {
            if (message.kind !== 'request') return
            void fetch('/__test/bridge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) })
              .then((response) => response.json()).then((response: unknown) => window.postMessage(response, location.origin))
          }
        }) })
      })
    }
    await page.goto(source.base)
    const draft = `Sanitized pending ${surface} comment`
    if (surface === 'teams') {
      await page.getByLabel('Customer account', { exact: true }).selectOption('account-contoso')
      await page.getByLabel('Opportunity', { exact: true }).selectOption('opp-grid-modernization')
      await page.getByText('Opportunity notes and reviewed updates', { exact: true }).click()
      await page.getByLabel('Opportunity notes', { exact: true }).fill(draft)
      await page.getByRole('button', { name: 'Review opportunity update', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Review exact changes' })
      await dialog.getByLabel('Review reason').fill('Confirmed sanitized source test')
      await dialog.getByRole('button', { name: 'Confirm selected changes' }).click()
      await expect(dialog).toBeHidden()
    } else if (surface === 'vscode') {
      await page.getByRole('combobox', { name: 'Customer account', exact: true }).selectOption('account-contoso')
      const row = page.getByRole('row').filter({ hasText: 'Grid operations modernization' }).first()
      await row.getByRole('button', { name: 'Comments', exact: true }).click()
      const editor = page.locator('.record-editor-row')
      await editor.getByRole('textbox').fill(draft)
      await editor.getByRole('button', { name: 'Save', exact: true }).click()
    } else {
      await page.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
      await page.getByRole('button', { name: 'Edit Grid operations modernization' }).click()
      await page.getByRole('menuitem', { name: 'Opportunity Comments' }).click()
      const editor = page.getByLabel('Edit opportunity comments')
      await editor.getByRole('textbox', { name: 'Opportunity Comments' }).fill(draft)
      await editor.getByRole('button', { name: 'Save', exact: true }).click()
    }
    await expect(page.getByText('Saving 1 confirmed change in the background', { exact: true })).toBeVisible()
    expect((await source.core.getOpportunitySnapshot('opp-grid-modernization')).opportunity.comments).not.toBe(draft)
    await page.getByRole('button', { name: 'Discover', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Discover opportunities', exact: true })).toBeVisible()
    await expect(page.getByText('Saving 1 confirmed change in the background', { exact: true })).toBeVisible()
    source.release()
    await expect(page.getByText('Saving 1 confirmed change in the background', { exact: true })).toBeHidden()
    expect((await source.core.getOpportunitySnapshot('opp-grid-modernization')).opportunity.comments).toBe(draft)
    expect(source.writes()).toBe(1)
    expect(errors).toEqual([])
  })
}

test('Desktop keeps normal cache status compact and gives the remaining viewport to the work panes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tlc-status-layout-'))
  const app = await electron.launch({
    args: [resolve('apps', 'desktop'), `--user-data-dir=${root}`],
    env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_DATA_STORE_PATH: '', TLC_BACKGROUND_SYNC: '0', TLC_UI_MODE: '' }
  })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1444, height: 768 })
    await expect(page.getByText('Acknowledged save mode', { exact: true })).toBeVisible()
    await expect(page.getByText(/^Last checked /)).toBeVisible()
    const layout = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const element = document.querySelector(selector)
        if (!element) throw new Error(`Missing layout region: ${selector}`)
        const rect = element.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom, height: rect.height }
      }
      return { status: bounds('.source-sync-region'), tabs: bounds('.primary-tabs'), workspace: bounds('main.workspace'), viewport: innerHeight }
    })
    expect(layout.status.height).toBeLessThanOrEqual(64)
    expect(layout.tabs.top).toBeLessThan(130)
    expect(layout.workspace.top - layout.tabs.bottom).toBeLessThanOrEqual(1)
    expect(layout.workspace.height).toBeGreaterThanOrEqual(layout.viewport - 180)
    expect(layout.workspace.bottom).toBeGreaterThanOrEqual(layout.viewport - 1)
    await page.screenshot({ path: test.info().outputPath('desktop-compact-status.png') })
    console.info(`Desktop layout: status=${layout.status.height}px, tabs=${layout.tabs.top}px, workspace=${layout.workspace.height}/${layout.viewport}px`)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Desktop keeps an admitted save across navigation and completes it without a second write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tlc-background-desktop-'))
  const app = await electron.launch({
    args: [resolve('apps', 'desktop'), `--user-data-dir=${root}`],
    env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_DATA_STORE_PATH: '', TLC_BACKGROUND_SYNC: '1', TLC_UI_MODE: '' }
  })
  const page = await app.firstWindow()
  try {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
    await page.getByRole('button', { name: 'Edit Grid operations modernization' }).click()
    await page.getByRole('menuitem', { name: 'Opportunity Comments' }).click()
    const editor = page.getByLabel('Edit opportunity comments')
    await editor.getByRole('textbox', { name: 'Opportunity Comments' }).fill('Sanitized background Desktop comment')
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    await editor.getByRole('button', { name: 'Save', exact: true }).click({ force: true })
    await expect(page.getByText('Saving 1 confirmed change in the background', { exact: true })).toBeVisible()
    await page.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'Discover', exact: true }).click({ force: true })
    await expect(page.getByRole('heading', { name: 'Discover opportunities', exact: true })).toBeVisible()
    await page.clock.resume()
    await expect(page.getByText('Saving 1 confirmed change in the background', { exact: true })).toBeHidden()
    await page.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'Portfolio', exact: true }).click()
    await page.getByRole('button', { name: 'Edit Grid operations modernization' }).click()
    await page.getByRole('menuitem', { name: 'Opportunity Comments' }).click()
    await expect(editor.getByRole('textbox', { name: 'Opportunity Comments' })).toHaveValue('Sanitized background Desktop comment')
  } finally {
    await page.clock.resume()
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
