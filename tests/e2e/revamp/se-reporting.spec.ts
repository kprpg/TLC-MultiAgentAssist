import { expect, test, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSampleSeReportingHost } from '../../../packages/orchestrator/se-reporting/sample.js'
import { createSampleSellerDashboard } from '../../../packages/common/fixtures/seller-dashboard.js'
import type { SeReportingRequest, SeReportingResponse } from '../../../packages/common/contracts/se-reporting.js'

declare global {
    interface Window { seReportingTestInvoke(request: SeReportingRequest): Promise<SeReportingResponse> }
}
async function openReporting(page: Page) {
    await page.getByRole('button', { name: 'Dashboards', exact: true }).click()
    await page.getByRole('tab', { name: 'SE Reporting Dashboard', exact: true }).click()
    await expect(page.getByRole('region', { name: 'SE Reporting Dashboard', exact: true })).toBeVisible()
    await expect(page.frameLocator('iframe[title="SE monthly report"]').locator('.kpi')).toHaveCount(5)
}

test('SE Reporting Web supports review, report scopes, disclosure, downloads and isolated publication without resetting Seller Dashboard', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await page.goto('/')
    await page.getByRole('button', { name: 'Dashboards', exact: true }).click()
    await page.getByLabel('Seller account').selectOption('1000001')
    await page.getByRole('tab', { name: 'SE Reporting Dashboard', exact: true }).click()
    const frame = page.frameLocator('iframe[title="SE monthly report"]')
    await expect(frame.locator('.kpi')).toHaveCount(5)
    await expect(frame.getByRole('heading', { name: 'SE Reporting Dashboard', exact: true })).toBeVisible()
    await expect(frame.locator('.secondary-view')).not.toHaveAttribute('open')
    await frame.getByText('See more', { exact: true }).click()
    await expect(frame.getByRole('heading', { name: 'Customer Updates', exact: true })).toBeVisible()
    const totals = await frame.locator('.kpi strong').allTextContents()
    await page.getByLabel('Customer update status').selectOption('with_blocker')
    await frame.getByText('See more', { exact: true }).click()
    await expect(frame.locator('.customer:visible')).toHaveCount(0)
    expect(await frame.locator('.kpi strong').allTextContents()).toEqual(totals)
    await page.getByLabel('Customer update status').selectOption('')
    await page.getByText('Reporter review and manager asks', { exact: true }).click()
    const asks = page.getByLabel('Asks for Morgan Sample', { exact: false }).first()
    await asks.fill('Please help with my exact synthetic request.')
    await page.getByLabel('I reviewed every report', { exact: false }).check()
    await page.getByRole('button', { name: 'Save reporter review', exact: true }).click()
    await expect(frame.getByText('Please help with my exact synthetic request.', { exact: true })).toBeVisible()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download report JSON', exact: true }).click()
    expect((await download).suggestedFilename()).toContain('person-summary')
    await page.getByText('Simulate report publication', { exact: true }).click()
    await page.getByRole('button', { name: 'Preview destination files', exact: true }).click()
    await expect(page.getByText('Synthetic destination', { exact: false }).first()).toBeVisible()
    await page.getByLabel('I confirm this exact file set', { exact: false }).check()
    await page.getByRole('button', { name: 'Simulate publication', exact: false }).click()
    await expect(page.getByRole('status')).toContainText('No files')
    await expect(page.locator('.se-report-settings')).toHaveCount(2)
    await page.getByRole('tab', { name: 'Seller Dashboard', exact: true }).click()
    await expect(page.getByLabel('Seller account')).toHaveValue('1000001')
    await expect(page.getByTestId('seller-official-attainment')).toHaveText('78%')
    await page.getByRole('tab', { name: 'Seller Dashboard', exact: true }).press('End')
    await expect(page.getByRole('tab', { name: 'SE Reporting Dashboard', exact: true })).toBeFocused()
    await page.setViewportSize({ width: 420, height: 900 })
    await expect(page.getByRole('heading', { name: 'SE Reporting Dashboard', exact: true })).toBeVisible()
    expect(await page.locator('.se-reporting-dashboard').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    expect(errors).toEqual([])
})

test('SE Reporting VS Code webview consumes the shared reporting operation', async ({ page }) => {
    const host = createSampleSeReportingHost()
    let changedIdentity = false
    await page.exposeFunction('seReportingTestInvoke', async (request: SeReportingRequest) => {
        const response = await host.invoke(request)
        return changedIdentity && response.kind === 'state' ? { ...response, run: null, profiles: [] } : response
    })
    await page.route('**/', (route) => route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><html><body><div id="root" data-mode="sample"></div></body></html>' }))
    await page.addInitScript((seller) => {
        Object.defineProperty(window, 'acquireVsCodeApi', { value: () => ({
            getState: () => undefined, setState: () => undefined,
            postMessage: (message: { kind: string; id: string; method: string; params: SeReportingRequest }) => {
                if (message.kind !== 'request') return
                const reply = (result: unknown) => window.postMessage({ kind: 'response', id: message.id, ok: true, result }, window.location.origin)
                if (message.method === 'seReporting') void window.seReportingTestInvoke(message.params).then(reply)
                else reply(message.method === 'sellerDashboard' ? seller : message.method === 'getCurrentUserEmail' ? null : [])
            }
        }) })
    }, createSampleSellerDashboard())
    await page.goto('/')
    await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
    await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
    await openReporting(page)
    await expect(page.frameLocator('iframe[title="SE monthly report"]').getByText('SYNTHETIC SAMPLE', { exact: false })).toBeVisible()
    changedIdentity = true
    await page.evaluate(() => window.postMessage({
        kind: 'event', type: 'modeChanged', payload: { mode: 'sample', userEmail: 'different-user@example.test' }
    }, window.location.origin))
    await expect(page.locator('iframe[title="SE monthly report"]')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'SE Reporting Dashboard', exact: true })).not.toContainText('Alex Sample')
})

test('SE Reporting setup selects the confirmed manager profile and generates its own fresh draft package', async ({ page }) => {
    await page.goto('/')
    await openReporting(page)
    const additional = page.getByText('Add another manager profile', { exact: true }).locator('..')
    await additional.locator('summary').first().click()
    await additional.getByLabel('Profile ID', { exact: true }).fill('another-manager')
    await additional.getByLabel('Profile label', { exact: true }).fill('Another synthetic reporting group')
    await additional.getByLabel('Live contract URL', { exact: true }).fill('https://example.sharepoint.com/teams/another/reporting-contract.md')
    await additional.getByLabel('Shared report output root', { exact: true }).fill('https://example.sharepoint.com/teams/another/PodReports')
    await additional.getByLabel('Power BI semantic-model ID', { exact: true }).fill('11111111-1111-4111-8111-111111111111')
    await additional.getByRole('button', { name: 'Inspect live contract and access', exact: true }).click()
    await additional.getByRole('button', { name: 'Confirm scope and save profile', exact: true }).click()
    await expect(page.getByLabel('Manager reporting profile')).toHaveValue('another-manager')
    await expect(page.locator('iframe[title="SE monthly report"]')).toHaveCount(0)
    await page.getByLabel('Reporting month', { exact: true }).fill('2026-10')
    await page.getByRole('button', { name: 'Generate draft package', exact: true }).click()
    await expect(page.frameLocator('iframe[title="SE monthly report"]').locator('.kpi')).toHaveCount(5)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download report JSON', exact: true }).click()
    const stream = await (await download).createReadStream()
    if (!stream) throw new Error('The generated report download was unavailable.')
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const report: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    expect(report).toMatchObject({ manager_profile: 'another-manager', period: '2026-10', status: 'draft', asks_for_manager: [] })
})

test('SE Reporting Desktop uses trusted IPC and the same canonical sample', async () => {
    test.slow()
    const directory = await mkdtemp(join(tmpdir(), 'tlc-se-reporting-'))
    const app = await electron.launch({
        args: [resolve('apps', 'desktop'), `--user-data-dir=${directory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })
    try {
        const page = await app.firstWindow()
        await openReporting(page)
        await expect(page.frameLocator('iframe[title="SE monthly report"]').getByRole('heading', { name: 'FY27 Milestone Inventory', exact: true })).toBeVisible()
        await page.getByRole('tab', { name: 'Seller Dashboard', exact: true }).click()
        await expect(page.getByTestId('seller-official-attainment')).toHaveText('78%')
    } finally {
        await app.close()
        await rm(directory, { recursive: true, force: true })
    }
})
