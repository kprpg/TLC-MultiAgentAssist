import { expect, test, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createSampleSellerDashboard } from '../../../packages/common/fixtures/seller-dashboard.js'
import type { SellerDashboardResponse } from '../../../packages/common/contracts/seller-dashboard.js'

async function proof(page: Page, name: string): Promise<void> {
    const directory = process.env['TLC_SELLER_DASHBOARD_PROOF_DIR']
    if (!directory) return
    if (!isAbsolute(directory) || !(await stat(directory)).isDirectory()) throw new Error('Proof directory must be an existing absolute directory.')
    await page.screenshot({ path: join(directory, name), animations: 'disabled' })
}

async function expectDashboard(page: Page): Promise<void> {
    await expect(page.getByRole('region', { name: 'Seller Dashboard', exact: true })).toBeVisible()
    await expect(page.getByTestId('seller-official-attainment')).toHaveText('78%')
    await expect(page.getByRole('tab', { name: 'Pipeline & Hygiene', exact: true })).toBeVisible()
    await expect(page.getByLabel('Seller fiscal quarter')).toHaveValue('q2')
}

async function openSellerDashboard(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Dashboards', exact: true }).click()
    const sellerDashboard = page.getByRole('tab', { name: 'Seller Dashboard', exact: true })
    await expect(sellerDashboard).toBeVisible()
    await sellerDashboard.click()
}

test('Seller Dashboard Web keeps panes isolated and supports report filters, queues, scenario, mobile and themes', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.goto('/')
    await openSellerDashboard(page)
    await expectDashboard(page)
    const lightBackground = await page.locator('.seller-dashboard').evaluate((element) => getComputedStyle(element).backgroundColor)
    await expect(page.getByRole('region', { name: 'Accounts blade' })).toHaveCount(0)
    await page.getByLabel('Seller account').selectOption('1000001')
    await page.getByRole('searchbox', { name: 'Search Seller Dashboard' }).fill('AVERY')
    await expect(page.locator('.sd-scope')).toContainText('1 of 5 accounts')
    await expect(page.getByTestId('seller-official-attainment')).toHaveText('78%')
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
    await page.getByLabel('Pipeline inventory view').selectOption('overdue')
    await expect(page.getByRole('table', { name: 'Past due', exact: true })).toContainText('Grid telemetry expansion')
    await page.getByLabel('Pipeline inventory view').selectOption('stale')
    await expect(page.getByRole('table', { name: 'Stale 45+ days', exact: true })).toContainText('SQL production cutover')
    await page.getByLabel('Pipeline inventory view').selectOption('macc')
    await expect(page.getByRole('table', { name: 'MACC opportunities', exact: true })).toContainText('Azure commitment renewal')
    await page.getByLabel('Pipeline inventory view').selectOption('sql')
    await expect(page.getByRole('table', { name: 'SQL billed opportunities', exact: true })).toContainText('$240,000')
    await page.getByLabel('Pipeline inventory view').selectOption('qualified')
    await page.getByRole('button', { name: 'Sort Qualified uncommitted by Est. monthly usage' }).click()
    await expect(page.getByRole('table', { name: 'Qualified uncommitted', exact: true }).locator('th[aria-sort="ascending"]')).toContainText('Est. monthly usage')

    await page.getByRole('tab', { name: 'ACR & Insights', exact: true }).click()
    await expect(page.getByRole('table', { name: 'Official metric reconciliation', exact: true })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Enable illustrative scenario' })).not.toBeChecked()
    await page.getByRole('checkbox', { name: 'Enable illustrative scenario' }).check()
    await expect(page.getByRole('table', { name: 'Illustrative scenario — not a forecast', exact: true })).toContainText('Assumed committed credit')
    await expect(page.getByTestId('seller-official-attainment')).toHaveText('78%')
    const coreScenario = page.getByRole('table', { name: 'Illustrative scenario — not a forecast', exact: true })
        .getByRole('row').filter({ has: page.getByRole('cell', { name: 'ACR - Core', exact: true }) })
    await page.getByLabel('Seller pipeline state').selectOption('committed')
    await expect(coreScenario.getByRole('cell').nth(2)).toHaveText('$92,774.19')
    await expect(coreScenario.getByRole('cell').nth(3)).toHaveText('$0')
    await page.getByLabel('Seller pipeline state').selectOption('uncommitted')
    await expect(coreScenario.getByRole('cell').nth(2)).toHaveText('$0')
    await expect(coreScenario.getByRole('cell').nth(3)).toHaveText('$51,096.77')
    await page.getByLabel('Seller pipeline state').selectOption('')
    await page.getByRole('searchbox', { name: 'Search Seller Dashboard' }).fill('Azure production rollout')
    await expect(coreScenario.getByRole('cell').nth(2)).toHaveText('$84,000')
    await expect(coreScenario.getByRole('cell').nth(3)).toHaveText('$0')
    await expect(page.getByTestId('seller-official-attainment')).toHaveText('78%')
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
    await page.getByLabel('Seller bucket').selectOption('Organic consumption')
    await expect(page.getByLabel('Seller metric').locator('option')).toHaveCount(2)
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
    await page.getByLabel('Seller pipeline state').selectOption('no-pipeline')
    await expect(page.getByRole('table', { name: 'Account gaps', exact: true })).toContainText('Adventure Works Cycles')
    await expect(page.getByRole('table', { name: 'Account gaps', exact: true })).toContainText('Unknown')
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click()

    await page.getByRole('tab', { name: 'Consumption & Growth', exact: true }).click()
    await expect(page.getByRole('table', { name: 'Account consumption', exact: true })).toContainText('Contoso Energy')
    await expect(page.getByRole('heading', { name: 'Top service movers', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'U2C Progress', exact: true }).click()
    await expect(page.getByRole('table', { name: 'U2C historical cohort', exact: true })).toContainText('Shifted out /mo')
    await expect(page.getByText('37.5%', { exact: true }).first()).toBeVisible()
    await page.getByRole('tab', { name: 'U2C Progress', exact: true }).press('Home')
    await expect(page.getByRole('tab', { name: 'Pipeline & Hygiene', exact: true })).toBeFocused()
    await page.getByRole('tab', { name: 'Pipeline & Hygiene', exact: true }).press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'ACR & Insights', exact: true })).toHaveAttribute('aria-selected', 'true')

    if (process.env['TLC_SELLER_DASHBOARD_PROOF_DIR']) {
        await page.setViewportSize({ width: 1440, height: 2160 })
        for (const [tab, name] of [
            ['Pipeline & Hygiene', 'Seller-Dashboard-Web-Pipeline.png'],
            ['ACR & Insights', 'Seller-Dashboard-Web-Earnings.png'],
            ['Consumption & Growth', 'Seller-Dashboard-Web-Consumption.png'],
            ['U2C Progress', 'Seller-Dashboard-Web-U2C.png']
        ] as const) {
            await page.getByRole('tab', { name: tab, exact: true }).click()
            await page.locator('.seller-dashboard').evaluate((element) => { element.scrollTop = 0 })
            await proof(page, name)
        }
    }
    await page.getByRole('button', { name: 'Accounts', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Accounts blade' })).toBeVisible()
    await page.setViewportSize({ width: 420, height: 1000 })
    await page.getByRole('button', { name: 'Open Dashboards', exact: true }).click()
    await page.getByRole('tab', { name: 'Seller Dashboard', exact: true }).click()
    await expectDashboard(page)
    await page.getByRole('tab', { name: 'U2C Progress', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Uncommitted to committed progress', exact: true })).toBeVisible()
    expect(await page.locator('.seller-dashboard').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    if (process.env['TLC_SELLER_DASHBOARD_PROOF_DIR']) {
        await page.setViewportSize({ width: 420, height: 2400 })
        await page.locator('.seller-dashboard').evaluate((element) => { element.scrollTop = 0 })
    }
    await proof(page, 'Seller-Dashboard-Web-Mobile.png')
    await page.setViewportSize({ width: 1440, height: 1400 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await openSellerDashboard(page)
    await expectDashboard(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await page.locator('.seller-dashboard').evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(lightBackground)
    await proof(page, 'Seller-Dashboard-Web-Dark.png')
    expect(errors).toEqual([])
})

interface DashboardBridgeMessage {
    kind: string
    id: string
    method: string
    params?: { operation?: string }
}
declare global {
    interface Window {
        sellerDashboardTest: {
            response: SellerDashboardResponse
            fail: boolean
            requests: DashboardBridgeMessage[]
        }
    }
}

async function mountSellerWebview(page: Page): Promise<void> {
    await page.route('**/', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><style>:root{--vscode-editor-background:#f5f5f5;--vscode-editorWidget-background:#fff;--vscode-foreground:#242424;--vscode-descriptionForeground:#616161;--vscode-font-family:"Segoe UI",sans-serif;--vscode-textLink-foreground:#0f6cbd;--vscode-focusBorder:#0f6cbd;--vscode-panel-border:#d1d1d1}</style></head><body><div id="root" data-mode="sample"></div></body></html>'
    }))
    await page.addInitScript((snapshot) => {
        window.sellerDashboardTest = { response: snapshot, fail: false, requests: [] }
        Object.defineProperty(window, 'acquireVsCodeApi', {
            value: () => ({
                getState: () => undefined, setState: () => undefined,
                postMessage: (message: DashboardBridgeMessage) => {
                    if (message.kind !== 'request') return
                    const state = window.sellerDashboardTest
                    state.requests.push(message)
                    if (message.method === 'sellerDashboard' && state.fail) {
                        window.postMessage({ kind: 'response', id: message.id, ok: false, error: { message: 'Synthetic source reload failed.' } }, window.location.origin)
                        return
                    }
                    const result = message.method === 'sellerDashboard' ? state.response
                        : message.method === 'getCurrentUserEmail' ? null : []
                    window.postMessage({ kind: 'response', id: message.id, ok: true, result }, window.location.origin)
                }
            })
        })
    }, createSampleSellerDashboard())
    await page.goto('/')
    await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
    await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
}

test('Seller Dashboard Web profile denial clears prior data and explains supported hosts', async ({ page }) => {
    await mountSellerWebview(page)
    const snapshot = createSampleSellerDashboard()
    snapshot.mode = 'live'
    await page.evaluate((response) => { window.sellerDashboardTest.response = response }, snapshot)
    await openSellerDashboard(page)
    await expectDashboard(page)
    await expect(page.getByRole('button', { name: 'Refresh live sources', exact: true })).toBeVisible()

    await page.evaluate(() => {
        window.sellerDashboardTest.response = {
            contractVersion: '1.0', kind: 'unavailable', mode: 'live', code: 'hosted-profile-denied',
            message: 'Web private-profile access requires HTTP caller authentication bound to the seller identity.'
        }
    })
    await page.getByRole('button', { name: 'Reload dashboard', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('HTTP caller authentication')
    await expect(page.getByRole('heading', { name: 'Private seller profiles are disabled on Web', exact: true })).toBeVisible()
    await expect(page.getByTestId('seller-official-attainment')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Refresh live sources', exact: true })).toHaveCount(0)
    await expect(page.locator('.sd-source-missing')).toContainText('Desktop or local Windows VS Code')
    await expect(page.locator('.sd-source-missing')).not.toContainText('TLC_SELLER_DASHBOARD_SKILL_ROOT')
})

test('Seller Dashboard stale queues use milestone history, not parent opportunity updates', async ({ page }) => {
    const snapshot = createSampleSellerDashboard()
    for (const [name, modifiedAt] of [
        ['Grid telemetry expansion', '2026-10-10T09:00:00.000Z'],
        ['Store analytics expansion', '2026-08-26T09:00:00.000Z'],
        ['Regional capacity approval', null],
        ['SQL production cutover', '2026-08-27T09:00:00.000Z']
    ] as const) {
        const milestone = snapshot.report.milestones.find((row) => row.name === name)
        if (!milestone) throw new Error(`Missing synthetic milestone: ${name}`)
        if (modifiedAt === null) delete milestone.modifiedAt
        else milestone.modifiedAt = modifiedAt
    }
    const committed = snapshot.report.milestones.find((row) => row.name === 'Azure production rollout')
    if (!committed) throw new Error('Missing synthetic committed milestone.')
    delete committed.commitmentChangedAt

    await mountSellerWebview(page)
    await page.evaluate((response) => { window.sellerDashboardTest.response = response }, snapshot)
    await openSellerDashboard(page)
    await expectDashboard(page)
    await page.getByLabel('Pipeline inventory view').selectOption('stale')
    const stale = page.getByRole('table', { name: 'Stale 45+ days', exact: true })
    await expect(stale).toContainText('Store analytics expansion')
    await expect(stale).toContainText('Database capacity growth')
    await expect(stale).not.toContainText('Grid telemetry expansion')
    await expect(stale).not.toContainText('Regional capacity approval')
    await expect(stale).not.toContainText('SQL production cutover')
    await expect(stale.locator('tbody tr')).toHaveCount(2)
    await expect(stale.locator('tbody tr').filter({ hasText: 'Store analytics expansion' }).getByRole('cell').last()).toHaveText('45')
    const queuePanel = page.locator('.sd-panel').filter({ has: page.getByLabel('Pipeline inventory view') })
    await expect(queuePanel.locator('.sd-notice')).toContainText('Missing milestone update timestamps: 1')

    await page.getByLabel('Pipeline inventory view').selectOption('recent')
    const recent = page.getByRole('table', { name: 'Recently committed', exact: true })
    await expect(recent).not.toContainText('Azure production rollout')
    await expect(recent).toContainText('Commitment onboarding')
    await expect(recent.locator('tbody tr')).toHaveCount(3)
    await expect(queuePanel.locator('.sd-notice')).toContainText('Missing milestone commitment-change timestamps: 1')
    await expect(page.getByTestId('seller-official-attainment')).toHaveText('78%')
})

test('Seller Dashboard VS Code webview shares the report and keeps failed reloads stale with explicit refresh approval', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await page.setViewportSize({ width: 1440, height: 1100 })
    await mountSellerWebview(page)
    await openSellerDashboard(page)
    await expectDashboard(page)
    await page.getByRole('tab', { name: 'Pipeline & Hygiene', exact: true }).press('End')
    await expect(page.getByRole('tab', { name: 'U2C Progress', exact: true })).toBeFocused()
    await expect(page.getByRole('table', { name: 'U2C historical cohort', exact: true })).toBeVisible()
    await page.evaluate(() => { window.sellerDashboardTest.fail = true })
    await page.getByRole('button', { name: 'Reload dashboard', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Synthetic source reload failed')
    await expect(page.getByRole('status')).toContainText('Stale / retained snapshot')
    await expect(page.getByTestId('seller-official-attainment')).toHaveText('78%')
    await page.evaluate(() => {
        window.sellerDashboardTest.fail = false
        const response = window.sellerDashboardTest.response
        if (response.kind === 'snapshot') { response.mode = 'live'; response.state = 'ready'; response.supplement = null }
    })
    await page.getByRole('button', { name: 'Reload dashboard', exact: true }).click()
    await page.getByRole('tab', { name: 'Consumption & Growth', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Consumption & growth need a Fabric source', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Refresh live sources', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Refresh live seller sources' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await page.evaluate(() => window.sellerDashboardTest.requests.filter((request) => request.params?.operation === 'refresh').length)).toBe(0)
    await page.getByRole('button', { name: 'Refresh live sources', exact: true }).click()
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Confirm source refresh', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.sellerDashboardTest.requests.filter((request) => request.params?.operation === 'refresh').length)).toBe(1)

    const expanded = createSampleSellerDashboard()
    const baseMilestone = expanded.report.milestones[0]!
    for (let index = 1; index <= 31; index++) {
        expanded.report.milestones.push({
            ...baseMilestone, id: `sample-pagination-${index}`, number: `SAMPLE-PAGE-${index}`,
            name: `Synthetic pagination milestone ${index}`
        })
    }
    expanded.report.accounts[0]!.pipeline.productionCount += 31
    expanded.report.accounts[0]!.pipeline.inQuarterProductionCount += 31
    expanded.report.accounts[0]!.pipeline.committedMonthly += 31 * 42_000
    expanded.report.coverage[0]!.candidateCount += 31
    expanded.report.coverage[0]!.committedMonthly += 31 * 42_000
    await page.evaluate((snapshot) => { window.sellerDashboardTest.response = snapshot }, expanded)
    await page.getByRole('button', { name: 'Reload dashboard', exact: true }).click()
    await page.getByRole('tab', { name: 'Pipeline & Hygiene', exact: true }).click()
    await page.getByLabel('Seller fiscal quarter').selectOption('all')
    await page.getByLabel('Pipeline inventory view').selectOption('all')
    const totals = await page.locator('.sd-card-value').allTextContents()
    await expect(page.locator('.sd-table-footer')).toContainText('1–15 of 45 records')
    await page.getByRole('button', { name: 'Next page of All milestones' }).click()
    await expect(page.locator('.sd-table-footer')).toContainText('16–30 of 45 records')
    expect(await page.locator('.sd-card-value').allTextContents()).toEqual(totals)
    await page.getByRole('button', { name: 'Next page of All milestones' }).click()
    await expect(page.locator('.sd-table-footer')).toContainText('31–45 of 45 records')
    await page.getByRole('button', { name: 'Previous page of All milestones' }).click()
    await expect(page.locator('.sd-table-footer')).toContainText('16–30 of 45 records')

    await page.evaluate((snapshot) => { window.sellerDashboardTest.response = snapshot }, createSampleSellerDashboard())
    await page.getByRole('button', { name: 'Reload dashboard', exact: true }).click()
    await expect(page.getByText('SYNTHETIC SAMPLE', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
    await page.getByLabel('Pipeline inventory view').selectOption('qualified')
    await page.getByRole('tab', { name: 'Pipeline & Hygiene', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1800 })
    await page.locator('.seller-dashboard').evaluate((element) => { element.scrollTop = 0 })
    await proof(page, 'Seller-Dashboard-VSCode.png')
    await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Seller Dashboard', exact: true })).toHaveCount(0)
    await openSellerDashboard(page)
    await expectDashboard(page)
    expect(errors).toEqual([])
})

test('Seller Dashboard Desktop loads the same synthetic report through trusted Electron IPC', async () => {
    test.slow()
    const directory = await mkdtemp(join(tmpdir(), 'tlc-seller-dashboard-electron-'))
    const app = await electron.launch({
        args: [resolve('apps', 'desktop'), `--user-data-dir=${directory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })
    try {
        const window = await app.firstWindow()
        const errors: Error[] = []
        window.on('pageerror', (error) => errors.push(error))
        await window.setViewportSize({ width: 1400, height: 1100 })
        await openSellerDashboard(window)
        await expectDashboard(window)
        await window.getByRole('tab', { name: 'ACR & Insights', exact: true }).click()
        await expect(window.getByRole('table', { name: 'Official metric reconciliation', exact: true })).toContainText('ACR - Core')
        await window.getByRole('tab', { name: 'Consumption & Growth', exact: true }).click()
        await expect(window.getByRole('table', { name: 'Account consumption', exact: true })).toContainText('Contoso Energy')
        await window.getByRole('tab', { name: 'U2C Progress', exact: true }).click()
        await expect(window.getByRole('table', { name: 'U2C historical cohort', exact: true })).toContainText('Sample territory')
        await window.getByRole('tab', { name: 'Pipeline & Hygiene', exact: true }).click()
        await window.setViewportSize({ width: 1400, height: 1600 })
        await window.locator('.seller-dashboard').evaluate((element) => { element.scrollTop = 0 })
        await proof(window, 'Seller-Dashboard-Desktop.png')
        await window.getByRole('button', { name: 'Accounts', exact: true }).click()
        await expect(window.getByRole('region', { name: 'Accounts blade' })).toBeVisible()
        expect(errors).toEqual([])
    } finally {
        await app.close()
        await rm(directory, { recursive: true, force: true })
    }
})
