import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, _electron as electron, type Page } from '@playwright/test'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { createSampleAuthentication } from '../../../apps/web/src/authentication.js'
import { buildStaticHandler, setSecurityHeaders } from '../../../apps/web/src/hosting.js'
import { createSampleDataProvider, type ExtensionDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { FixtureMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'

type Surface = 'desktop' | 'web' | 'vscode'
const servers = new Set<Server>()

declare global {
    interface Window {
        tlcRemovalBridge(message: unknown): Promise<unknown>
    }
}

test.afterEach(async () => {
    await Promise.all([...servers].map((server) => new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()))))
    servers.clear()
})

async function hostedWeb(page: Page): Promise<void> {
    const runtime: WebRuntime = Object.assign(
        new ThinSliceOrchestrator(new FixtureMsxConnector(), new FixtureMcemGuidanceConnector(), {}),
        {
            listMeetingTranscripts: async () => [],
            getMeetingTranscript: async () => null,
            proposeMeetingChangeSet: async () => { throw new Error('Meeting capture is outside this removal test.') },
            applyMeetingChangeSet: async () => { throw new Error('Meeting capture is outside this removal test.') }
        }
    )
    const api = buildWebApiHandler({ createRuntime: () => runtime, authenticate: createSampleAuthentication() })
    const staticHandler = buildStaticHandler(resolve('apps', 'desktop', 'dist', 'revamp'), 'sample')
    const server = createServer((request, response) => {
        setSecurityHeaders(response)
        void (async () => {
            if (!(await api(request, response))) await staticHandler(request, response)
        })().catch((error: unknown) => {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : 'Test host failed.')
        })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    servers.add(server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Removal test host did not start.')
    await page.goto(`http://127.0.0.1:${address.port}`)
}

async function vscodeWorkbench(page: Page, provider: ExtensionDataProvider): Promise<void> {
    await page.exposeFunction('tlcRemovalBridge', (message: unknown) => routeBridgeMessage(provider, message))
    await page.addInitScript(() => {
        Object.defineProperty(window, 'acquireVsCodeApi', {
            value: () => ({
                getState: () => undefined,
                setState: () => undefined,
                postMessage: (message: unknown) => {
                    void window.tlcRemovalBridge(message).then((response) => window.postMessage(response, window.location.origin))
                }
            })
        })
    })
    await page.route('**/', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><link rel="stylesheet" href="/removal-webview.css"></head><body><div id="root" data-mode="sample"></div><script src="/removal-webview.js"></script></body></html>'
    }))
    await page.route('**/removal-webview.css', (route) => route.fulfill({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css'), contentType: 'text/css' }))
    await page.route('**/removal-webview.js', (route) => route.fulfill({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js'), contentType: 'text/javascript' }))
    await page.goto('/')
}

function accountsPane(page: Page, surface: Surface) {
    return surface === 'vscode' ? page.locator('#portfolio-accounts-panel') : page.getByRole('region', { name: 'Accounts blade' })
}

async function tab(page: Page, surface: Surface, name: 'Portfolio' | 'Discover' | 'New') {
    const navigation = surface === 'vscode' ? page.locator('.app-header > nav.tabs') : page.getByRole('navigation', { name: 'Primary tabs' })
    await navigation.getByRole('button', { name, exact: true }).click()
}

async function selectContoso(page: Page, surface: Surface) {
    const accounts = accountsPane(page, surface)
    if (surface === 'vscode') await accounts.getByRole('combobox', { name: 'Customer account' }).selectOption('account-contoso')
    else await accounts.locator('.account-button').filter({ hasText: 'Contoso Energy' }).click()
    if (surface === 'vscode') await expect(accounts.getByText('Grid operations modernization', { exact: true })).toBeVisible()
    else await expect(page.getByRole('table', { name: 'Contoso Energy opportunities' })).toContainText('Grid operations modernization')
}

async function removalJourney(page: Page, surface: Surface) {
    await page.setViewportSize({ width: 1600, height: 950 })
    const accounts = accountsPane(page, surface)
    const chooser = accounts.getByRole('button', { name: 'Remove customer', exact: true })
    await expect(chooser).toBeVisible()
    await chooser.click()
    const confirmation = page.getByRole('dialog', { name: 'Remove customer account' })
    await expect(confirmation.getByRole('button', { name: 'Remove customer', exact: true })).toBeDisabled()
    await confirmation.getByRole('combobox', { name: 'Choose a tracked customer' }).selectOption('account-contoso')
    await expect(confirmation).toContainText('Contoso Energy')
    await expect(confirmation).toContainText('team membership will not change')
    await page.setViewportSize({ width: 420, height: 844 })
    const box = await confirmation.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.width).toBeLessThanOrEqual(420)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    await confirmation.screenshot({ path: test.info().outputPath('remove-customer.png') })
    await page.keyboard.press('Escape')
    await expect(confirmation).not.toBeVisible()
    await expect(chooser).toBeFocused()
    await page.setViewportSize({ width: 1600, height: 950 })

    await selectContoso(page, surface)
    const contextual = surface === 'vscode'
        ? accounts.getByRole('button', { name: 'Remove this customer', exact: true })
        : accounts.locator('.account-row').filter({ hasText: 'Contoso Energy' }).getByRole('button', { name: 'Remove this customer', exact: true })
    await contextual.click()
    await expect(confirmation).toContainText('Contoso Energy')
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await confirmation.getByRole('button', { name: 'Remove customer', exact: true }).click()
    await expect(confirmation).not.toBeVisible()
    await expect.poll(() => page.evaluate(() => ({
        active: document.activeElement?.getAttribute('aria-label'),
        focused: document.hasFocus(),
        openDialogs: document.querySelectorAll('dialog[open]').length
    }))).toEqual({ active: 'Add customer', focused: true, openDialogs: 0 })
    if (surface === 'vscode') {
        await expect(accounts.getByRole('combobox', { name: 'Customer account' }).locator('option[value="account-contoso"]')).toHaveCount(0)
    } else {
        await expect(accounts.locator('.account-row').filter({ hasText: 'Contoso Energy' })).toHaveCount(0)
        await expect(page.getByRole('table', { name: 'Contoso Energy opportunities' })).toHaveCount(0)
    }
    await expect(accounts).toContainText('Fabrikam Retail')
    await expect(page.getByRole('button', { name: /Show hidden/ })).toHaveCount(0)

    const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })
    await search.fill('Contoso')
    await expect(page.getByRole('listbox', { name: 'Search results' })).toContainText('No accounts or opportunities found.')
    await search.press('Escape')
    await tab(page, surface, 'Discover')
    const discovery = page.getByRole('region', { name: 'Discover opportunities' })
    await expect(discovery.getByRole('button', { name: 'Remove customer', exact: true })).toBeVisible()
    await expect(discovery.getByText(/^Showing \d+ of \d+ opportunities$/)).toBeVisible()
    await expect(discovery.getByRole('row').filter({ hasText: 'Contoso Energy' })).toHaveCount(0)

    await tab(page, surface, 'New')
    const creation = page.getByRole('region', { name: 'New record creation' })
    await creation.getByRole('button', { name: 'Opportunity', exact: true }).click()
    const accountSelector = creation.getByRole('combobox', { name: 'Account', exact: true })
    await expect(accountSelector.locator('option[value="account-fabrikam"]')).toHaveCount(1)
    await expect(accountSelector.locator('option[value="account-contoso"]')).toHaveCount(0)

    await tab(page, surface, 'Discover')
    await discovery.getByRole('button', { name: 'Add customer', exact: true }).click()
    const add = page.getByRole('dialog', { name: 'Add customer account' })
    await add.getByRole('textbox', { name: 'Account name', exact: true }).fill('Contoso')
    await add.getByRole('button', { name: 'Search', exact: true }).click()
    await add.getByRole('button', { name: 'Add again', exact: true }).click()
    await expect(add).not.toBeVisible()
    await tab(page, surface, 'Portfolio')
    await selectContoso(page, surface)
}

test('removes and re-adds a customer consistently through hosted Web HTTP', async ({ page }) => {
    await hostedWeb(page)
    await removalJourney(page, 'web')
})

test('removes and re-adds a customer consistently through Desktop IPC', async () => {
    test.slow()
    const directory = await mkdtemp(join(tmpdir(), 'tlc-removal-desktop-'))
    const app = await electron.launch({
        args: [resolve('apps', 'desktop'), `--user-data-dir=${directory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '', TLC_DATA_STORE: 'fixture' }
    })
    try {
        await removalJourney(await app.firstWindow(), 'desktop')
    } finally {
        await app.close()
        await rm(directory, { recursive: true, force: true })
    }
})

test('removes and re-adds a customer consistently through the VS Code bridge', async ({ page }) => {
    const provider = createSampleDataProvider()
    try {
        await vscodeWorkbench(page, provider)
        await removalJourney(page, 'vscode')
    } finally {
        await provider.setAccountVisibility('account-contoso', 'visible')
        await provider.dispose()
    }
})

test('keeps a failed removal actionable and prevents dismissal or repeat submission while saving', async ({ page }) => {
    await hostedWeb(page)
    const accounts = accountsPane(page, 'web')
    await accounts.getByRole('button', { name: 'Remove customer', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove customer account' })
    await dialog.getByRole('combobox').selectOption('account-contoso')
    const path = '**/api/accounts/account-contoso/visibility'
    await page.route(path, (route) => route.fulfill({ status: 500, json: { error: 'Preference store unavailable' } }))
    const remove = dialog.getByRole('button', { name: 'Remove customer', exact: true })
    await remove.click()
    await expect(dialog.getByRole('alert')).toContainText('Could not remove customer')
    await expect(dialog.getByRole('alert')).toContainText('Preference store unavailable')
    await expect(accounts.locator('.account-row').filter({ hasText: 'Contoso Energy' })).toHaveCount(1)
    await expect(remove).toBeEnabled()
    await page.unroute(path)

    let release!: () => void
    const pending = new Promise<void>((done) => { release = done })
    let submissions = 0
    await page.route(path, async (route) => {
        submissions++
        await pending
        await route.continue()
    })
    try {
        await remove.click()
        await expect(remove).toBeDisabled()
        await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
        await page.keyboard.press('Escape')
        await expect(dialog).toBeVisible()
        release()
        await expect(dialog).not.toBeVisible()
        expect(submissions).toBe(1)
    } finally {
        release()
    }
})

test('does not let a late opportunity response restore a removed selected customer', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 950 })
    await hostedWeb(page)
    const accounts = accountsPane(page, 'web')
    await expect(accounts.locator('.account-row')).toHaveCount(8)
    let release!: () => void
    let captured!: () => void
    const pending = new Promise<void>((done) => { release = done })
    const snapshot = new Promise<void>((done) => { captured = done })
    await page.route('**/api/accounts/account-contoso/opportunities', async (route) => {
        const response = await route.fetch()
        captured()
        await pending
        await route.fulfill({ response })
    })
    try {
        await accounts.locator('.account-button').filter({ hasText: 'Contoso Energy' }).click()
        await snapshot
        await accounts.locator('.account-row').filter({ hasText: 'Contoso Energy' }).getByRole('button', { name: 'Remove this customer', exact: true }).click()
        await page.getByRole('dialog', { name: 'Remove customer account' }).getByRole('button', { name: 'Remove customer', exact: true }).click()
        await expect(accounts.locator('.account-row').filter({ hasText: 'Contoso Energy' })).toHaveCount(0)
        const response = page.waitForResponse((item) => new URL(item.url()).pathname === '/api/accounts/account-contoso/opportunities')
        release()
        await (await response).finished()
        await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())))
        await expect(page.getByRole('table', { name: 'Contoso Energy opportunities' })).toHaveCount(0)
        await expect(page.getByRole('region', { name: 'Opportunity workbench' })).not.toContainText('Contoso Energy')
        await expect(page.getByRole('region', { name: 'Opportunity workbench' })).not.toContainText('Grid operations modernization')
    } finally {
        release()
    }
})

test('reports a persisted removal separately from a failed portfolio refresh', async ({ page }) => {
    await hostedWeb(page)
    const accounts = accountsPane(page, 'web')
    await expect(accounts.locator('.account-row')).toHaveCount(8)
    await accounts.getByRole('button', { name: 'Remove customer', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove customer account' })
    await dialog.getByRole('combobox').selectOption('account-contoso')
    await page.route('**/api/accounts', (route) => route.fulfill({ status: 500, json: { error: 'Refresh unavailable' } }))
    await dialog.getByRole('button', { name: 'Remove customer', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Customer removed, but TLC could not refresh the portfolio.')
    await expect(accounts.locator('.account-row').filter({ hasText: 'Contoso Energy' })).toHaveCount(0)
    await page.unroute('**/api/accounts')
    await page.reload()
    await expect(accounts.locator('.account-row')).toHaveCount(7)
    await expect(accounts.locator('.account-row').filter({ hasText: 'Contoso Energy' })).toHaveCount(0)
})

test('keeps an unrelated selected account when removing another customer', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 950 })
    await hostedWeb(page)
    await selectContoso(page, 'web')
    const accounts = accountsPane(page, 'web')
    await accounts.getByRole('button', { name: 'Remove customer', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove customer account' })
    await dialog.getByRole('combobox').selectOption('account-fabrikam')
    await dialog.getByRole('button', { name: 'Remove customer', exact: true }).click()
    await expect(accounts.locator('.account-row').filter({ hasText: 'Fabrikam Retail' })).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'Contoso Energy opportunities' })).toContainText('Grid operations modernization')
    await accounts.getByRole('button', { name: 'Remove customer', exact: true }).click()
    await expect(dialog.getByRole('combobox').locator('option[value="account-fabrikam"]')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('clears the last VS Code customer and its details, then restores it through Add customer', async ({ page }) => {
    const provider = createSampleDataProvider()
    const initial = await provider.listAccounts()
    try {
        for (const account of initial) if (account.id !== 'account-contoso') await provider.setAccountVisibility(account.id, 'hidden')
        await vscodeWorkbench(page, provider)
        await selectContoso(page, 'vscode')
        const accounts = accountsPane(page, 'vscode')
        await accounts.getByRole('button', { name: 'Remove this customer', exact: true }).click()
        await page.getByRole('dialog', { name: 'Remove customer account' }).getByRole('button', { name: 'Remove customer', exact: true }).click()
        await expect(accounts.getByRole('status').filter({ hasText: 'No customer accounts' })).toBeVisible()
        await expect(page.getByText('Grid operations modernization', { exact: true })).toHaveCount(0)
        await accounts.getByRole('button', { name: 'Remove customer', exact: true }).click()
        const remove = page.getByRole('dialog', { name: 'Remove customer account' })
        await expect(remove).toContainText('No customers to remove')
        await expect(remove.getByRole('button', { name: 'Remove customer', exact: true })).toBeDisabled()
        await remove.getByRole('button', { name: 'Cancel', exact: true }).click()
        await accounts.getByRole('button', { name: 'Add customer', exact: true }).click()
        const add = page.getByRole('dialog', { name: 'Add customer account' })
        await add.getByRole('textbox', { name: 'Account name', exact: true }).fill('Contoso')
        await add.getByRole('button', { name: 'Search', exact: true }).click()
        await add.getByRole('button', { name: 'Add again', exact: true }).click()
        await selectContoso(page, 'vscode')
    } finally {
        for (const account of initial) await provider.setAccountVisibility(account.id, 'visible')
        await provider.dispose()
    }
})
