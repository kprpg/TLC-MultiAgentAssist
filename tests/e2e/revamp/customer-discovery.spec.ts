import { expect, test, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function addMissingCustomer(page: Page, host: 'desktop' | 'web' | 'vscode'): Promise<void> {
    await page.setViewportSize({ width: 1600, height: 900 })
    const portfolioAdd = page.getByRole('button', { name: 'Add customer', exact: true })
    await portfolioAdd.click()
    await expect(page.getByRole('dialog', { name: 'Add customer account' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Add customer account' })).not.toBeVisible()
    await expect(portfolioAdd).toBeFocused()

    if (host === 'vscode') await page.getByRole('button', { name: 'Discover', exact: true }).click()
    else await page.getByRole('button', { name: 'Discover opportunities', exact: true }).click()

    const discovery = page.getByRole('region', { name: 'Discover opportunities' })
    await discovery.getByRole(host === 'vscode' ? 'tab' : 'button', { name: 'Data', exact: true }).click()
    await expect(discovery.getByText('Clinical data platform modernization', { exact: true })).toHaveCount(0)
    await discovery.getByRole('button', { name: 'Add customer', exact: true }).click({ timeout: 5_000 })

    const dialog = page.getByRole('dialog', { name: 'Add customer account' })
    await expect(dialog).toBeVisible()
    const query = dialog.getByRole('textbox', { name: 'Account name', exact: true })
    const search = dialog.getByRole('button', { name: 'Search', exact: true })
    await query.fill('N')
    await expect(search).toBeDisabled()
    await query.press('Enter')
    await expect(dialog.getByText('No matching customer accounts were found.')).toHaveCount(0)

    await query.fill('No-such-test-customer')
    await search.click()
    await expect(dialog.getByText('No matching customer accounts were found.')).toBeVisible()
    await query.fill('Northwind')
    await expect(dialog.getByText('No matching customer accounts were found.')).toHaveCount(0)
    await query.press('Enter')
    await expect(dialog).toContainText('Northwind Health')
    await dialog.getByRole('button', { name: 'Add account', exact: true }).click()
    await expect(dialog).not.toBeVisible()

    const opportunity = discovery.getByRole('row').filter({ hasText: 'Clinical data platform modernization' })
    await expect(opportunity).toContainText('Northwind Health')
    await expect(opportunity.getByRole('button', { name: 'Add me', exact: true })).toBeVisible()
    await opportunity.getByRole('button', { name: 'Add me', exact: true }).click()
    await expect(opportunity).toContainText('On deal team')

    if (host === 'vscode') {
        await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
        const accounts = page.locator('#portfolio-accounts-panel')
        await accounts.locator(':scope > select').selectOption('account-northwind')
        await expect(accounts.getByText('Clinical data platform modernization', { exact: true })).toBeVisible()
    } else {
        await page.getByRole('button', { name: 'Accounts', exact: true }).click()
        await page.locator('.account-button').filter({ hasText: 'Northwind Health' }).click()
        await expect(page.getByRole('region', { name: 'Opportunities blade' })).toContainText('Clinical data platform modernization')
    }
}

test('adds a missing customer directly from Web Discovery before joining its opportunity', async ({ page }) => {
    await page.goto('/')
    await addMissingCustomer(page, 'web')
})

for (const state of ['not-added', 'hidden'] as const) {
    test(`shows search and ${state === 'hidden' ? 'unhide' : 'add'} failures in the dialog and allows retry`, async ({ page }) => {
        const account = { id: 'account-northwind', name: 'Northwind Health', segment: 'Enterprise', provenance: 'manual', visibility: 'visible' }
        const opportunity = {
            id: 'opp-discover-northwind-data', accountId: account.id, accountName: account.name,
            name: 'Clinical data platform modernization', domain: 'data', recordedStage: 1,
            value: 2100000, currency: 'USD', closeDate: '2027-05-20', onDealTeam: false
        }
        let searches = 0
        let saved = false
        const mutations: string[] = []
        const unexpected: string[] = []
        const mutationPath = state === 'hidden' ? `/api/accounts/${account.id}/visibility` : '/api/accounts'
        const mutationMethod = state === 'hidden' ? 'PATCH' : 'POST'
        await page.route('**/', async (route) => {
            const response = await route.fetch()
            await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="tlc-data-mode" content="sample">') })
        })
        await page.route('**/api/**', async (route) => {
            const request = route.request()
            const path = new URL(request.url()).pathname
            if (path === mutationPath && request.method() === mutationMethod) {
                mutations.push(`${request.method()} ${path}`)
                expect(request.postDataJSON()).toEqual(state === 'hidden' ? { visibility: 'visible' } : { accountId: account.id })
                if (mutations.length === 1) await route.fulfill({ status: 503, json: { error: 'Customer preference could not be saved.' } })
                else {
                    saved = true
                    await route.fulfill({ json: account })
                }
            } else if (path === '/api/me') await route.fulfill({ json: { email: 'sample@example.test' } })
            else if (path === '/api/accounts') await route.fulfill({ json: saved ? [account] : [] })
            else if (path.endsWith('/opportunities')) await route.fulfill({ json: [] })
            else if (path.startsWith('/api/discover/')) await route.fulfill({ json: saved ? [opportunity] : [] })
            else if (path === '/api/account-candidates') {
                searches += 1
                if (searches === 1) await route.fulfill({ status: 503, json: { error: 'Customer search is temporarily unavailable.' } })
                else await route.fulfill({ json: [{ ...account, state, visibility: state === 'hidden' ? 'hidden' : 'visible' }] })
            } else {
                unexpected.push(`${request.method()} ${path}`)
                await route.fulfill({ status: 500, json: { error: 'Unexpected test request.' } })
            }
        })
        await page.goto('/')
        await page.getByRole('button', { name: 'Discover opportunities', exact: true }).click()
        const discovery = page.getByRole('region', { name: 'Discover opportunities' })
        await discovery.getByRole('button', { name: 'Data', exact: true }).click()
        await discovery.getByRole('button', { name: 'Add customer', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Add customer account' })
        await dialog.getByRole('textbox', { name: 'Account name', exact: true }).fill('Northwind')
        await dialog.getByRole('button', { name: 'Search', exact: true }).click()
        await expect(dialog.getByRole('alert')).toHaveText('Customer search is temporarily unavailable.')
        await expect(dialog.getByText('No matching customer accounts were found.')).toHaveCount(0)
        await dialog.getByRole('button', { name: 'Search', exact: true }).click()
        const add = dialog.getByRole('button', { name: state === 'hidden' ? 'Unhide' : 'Add account', exact: true })
        await add.click()
        await expect(dialog.getByRole('alert')).toHaveText('Customer preference could not be saved.')
        await expect(dialog).toBeVisible()
        await add.click()
        await expect(dialog).not.toBeVisible()
        await expect(discovery.getByRole('row').filter({ hasText: opportunity.name }).getByRole('button', { name: 'Add me', exact: true })).toBeVisible()
        expect(mutations).toEqual([`${mutationMethod} ${mutationPath}`, `${mutationMethod} ${mutationPath}`])
        expect(unexpected).toEqual([])
    })
}

test('adds a missing customer directly from Desktop Discovery through IPC', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-customer-discovery-'))
    const app = await electron.launch({
        args: [resolve('apps', 'desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })
    try {
        await addMissingCustomer(await app.firstWindow(), 'desktop')
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('adds a customer from an empty VS Code portfolio and discovers its opportunity', async ({ page }) => {
    await page.route('**/', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head></head><body><div id="root" data-mode="sample"></div></body></html>'
    }))
    await page.addInitScript(() => {
        const account = { id: 'account-northwind', name: 'Northwind Health', segment: 'Enterprise', tpid: '1000003', provenance: 'manual', visibility: 'visible' }
        const opportunity = {
            id: 'opp-discover-northwind-data', accountId: account.id, accountName: account.name,
            name: 'Clinical data platform modernization', domain: 'data', recordedStage: 1,
            value: 2100000, currency: 'USD', closeDate: '2027-05-20', onDealTeam: false
        }
        let added = false
        Object.defineProperty(window, 'acquireVsCodeApi', {
            value: () => ({
                getState: () => undefined,
                setState: () => undefined,
                postMessage: (message: {
                    kind: string; id: string; method: string
                    params?: { domain?: string; accountId?: string; opportunityId?: string; query?: string }
                }) => {
                    if (message.kind !== 'request') return
                    let result: unknown
                    if (message.method === 'getCurrentUserEmail') result = 'sample@example.test'
                    else if (message.method === 'listAccounts') result = added ? [account] : []
                    else if (message.method === 'listOpportunities') result = added && opportunity.onDealTeam ? [opportunity] : []
                    else if (message.method === 'listMilestones') result = []
                    else if (message.method === 'discoverOpportunities') result = added && message.params?.domain === 'data' ? [opportunity] : []
                    else if (message.method === 'searchAccounts') result = message.params?.query?.toLowerCase().includes('northwind')
                        ? [{ ...account, state: added ? 'visible' : 'not-added' }] : []
                    else if (message.method === 'addAccount') {
                        added = true
                        result = account
                    } else if (message.method === 'joinDealTeam') {
                        opportunity.onDealTeam = true
                        result = { opportunityId: opportunity.id, onDealTeam: true, alreadyMember: false }
                    } else throw new Error(`Unexpected test request: ${message.method}`)
                    window.postMessage({ kind: 'response', id: message.id, ok: true, result }, window.location.origin)
                }
            })
        })
    })
    await page.goto('/')
    await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
    await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
    await addMissingCustomer(page, 'vscode')
})
