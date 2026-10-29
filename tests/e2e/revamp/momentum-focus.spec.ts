import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createMomentumFocusHost, SharedMomentumFocusHost } from '../../../packages/orchestrator/momentum-focus/host.js'
import { createMomentumFixture, momentumSampleNow } from '../../../packages/common/fixtures/momentum-focus.js'
import { createSampleSellerDashboard } from '../../../packages/common/fixtures/seller-dashboard.js'
import { momentumFocusContractVersion, type MomentumFocusRequest } from '../../../packages/common/contracts/momentum-focus.js'
import { momentumJourney, openMomentum } from '../momentum-journey.js'

test('Momentum Web is lazy, linked, accessible, paginated and responsive', async ({ page }) => {
    let reads = 0
    page.on('request', (request) => { if (request.url().endsWith('/api/momentum-focus')) reads++ })
    await page.goto(process.env['TLC_MOMENTUM_WEB_ORIGIN'] ?? '/')
    await page.getByRole('button', { name: 'Dashboards', exact: true }).click()
    expect(reads).toBe(0)
    await page.getByRole('button', { name: 'Accounts', exact: true }).first().click()
    await momentumJourney(page)
    expect(reads).toBe(2)
})

test('Momentum VS Code webview uses the same shared view and rejects old-identity content', async ({ page }) => {
    const host = createMomentumFocusHost({ mode: 'sample' })
    let changedIdentity = false
    let reads = 0
    await page.exposeFunction('momentumTestInvoke', (request: MomentumFocusRequest) => {
        reads++
        return changedIdentity
            ? { contractVersion: momentumFocusContractVersion, kind: 'unavailable', code: 'forbidden', message: 'Synthetic source identity changed.' }
            : host.invoke(request)
    })
    await page.route('**/', (route) => route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><html><body><div id="root" data-mode="sample"></div></body></html>' }))
    await page.addInitScript((seller) => {
        Object.defineProperty(window, 'acquireVsCodeApi', { value: () => ({
            getState: () => undefined, setState: () => undefined,
            postMessage: (message: { kind: string; id: string; method: string; params: MomentumFocusRequest }) => {
                if (message.kind !== 'request') return
                const reply = (result: unknown) => window.postMessage({ kind: 'response', id: message.id, ok: true, result }, window.location.origin)
                if (message.method === 'momentumFocus') void Reflect.get(window, 'momentumTestInvoke')(message.params).then(reply)
                else reply(message.method === 'sellerDashboard' ? seller : message.method === 'getCurrentUserEmail' ? null : [])
            }
        }) })
    }, createSampleSellerDashboard())
    await page.goto('/')
    await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
    await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
    await momentumJourney(page)
    expect(reads).toBe(2)
    changedIdentity = true
    await page.evaluate(() => window.postMessage({
        kind: 'event', type: 'modeChanged', payload: { mode: 'live', userEmail: 'different-user@example.test' }
    }, window.location.origin))
    await expect(page.getByRole('table', { name: 'Momentum priority queue', exact: true })).toHaveCount(0)
})

test('Momentum Desktop uses trusted IPC for the complete shared journey', async () => {
    test.slow()
    const directory = await mkdtemp(join(tmpdir(), 'tlc-momentum-'))
    const app = await electron.launch({
        args: [resolve('apps', 'desktop'), `--user-data-dir=${directory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_AI_MODE: 'sample', TLC_UI_MODE: '', TLC_DATA_STORE: 'fixture' }
    })
    try { await momentumJourney(await app.firstWindow()) } finally {
        await app.close()
        await rm(directory, { recursive: true, force: true })
    }
})

test('Momentum single-flights filters during a delayed first load and clears denied refreshes', async ({ page }) => {
    const host = createMomentumFocusHost({ mode: 'sample' })
    let release: (() => void) | undefined
    let deny = false
    let reads = 0
    const delayed = new Promise<void>((done) => { release = done })
    await page.route('**/api/momentum-focus', async (route) => {
        const request = route.request().postDataJSON() as MomentumFocusRequest
        if (++reads === 1) await delayed
        const response = deny ? { contractVersion: momentumFocusContractVersion, kind: 'unavailable', code: 'forbidden', message: 'Synthetic access revoked.' } : await host.invoke(request)
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Dashboards', exact: true }).click()
    await page.getByRole('tab', { name: 'Momentum & Focus', exact: true }).click()
    await expect.poll(() => reads).toBe(1)
    await page.getByLabel('Role preset', { exact: true }).selectOption('SE')
    expect(reads).toBe(1)
    release?.()
    await expect(page.getByRole('table', { name: 'Momentum priority queue', exact: true })).toBeVisible()
    await expect(page.getByLabel('Role preset', { exact: true })).toHaveValue('SE')
    deny = true
    await page.getByRole('button', { name: 'Refresh and capture history', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Synthetic access revoked')
    await expect(page.getByRole('table', { name: 'Momentum priority queue', exact: true })).toHaveCount(0)
})

test('Momentum Web detail opens an explicitly suggested review, never a fabricated deadline', async ({ page }) => {
    await page.goto('/')
    await openMomentum(page)
    await page.getByRole('button', { name: 'Why Synthetic incomplete coverage?', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Why this item?', exact: true })
    await expect(dialog).toContainText('Suggested review')
    await expect(dialog).toContainText('Recorded deadlineUnknown')
    await expect(dialog.getByRole('link', { name: 'Open MSX', exact: true })).toHaveCount(0)
})

test('Momentum preview rejects malformed origins without crashing the synthetic host', async ({ request }) => {
    const data = { contractVersion: momentumFocusContractVersion, operation: 'get' }
    const denied = await request.post('/api/momentum-focus', {
        headers: { origin: 'null', 'sec-fetch-site': 'same-origin' }, data
    })
    expect(denied.status()).toBe(403)
    const allowed = await request.post('/api/momentum-focus', { headers: { 'sec-fetch-site': 'same-origin' }, data })
    expect(allowed.status()).toBe(200)
    expect(await allowed.json()).toMatchObject({ kind: 'snapshot', mode: 'sample' })
})

test('Momentum rejects a dataset for a different authorized industry scope', async ({ page }) => {
    const host = createMomentumFocusHost({ mode: 'sample' })
    await page.route('**/api/momentum-focus', async (route) => {
        const request = route.request().postDataJSON() as MomentumFocusRequest
        const response = await host.invoke({ ...request, query: { ...request.query, customerIndustry: 'all' } })
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Dashboards', exact: true }).click()
    await page.getByRole('tab', { name: 'Momentum & Focus', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('industry scope')
    await expect(page.getByRole('table', { name: 'Momentum priority queue', exact: true })).toHaveCount(0)
})

test('Momentum defaults to HLS and only exposes other authorized customers after explicit selection', async ({ page }) => {
    let reads = 0
    const host = new SharedMomentumFocusHost({
        now: () => new Date(momentumSampleNow),
        collect: async (scope, industry) => {
            const data = createMomentumFixture(industry)
            data.scope = scope
            if (industry === 'all') data.records.push({
                ...structuredClone(data.records[0]!), key: 'opportunity:retail', id: 'retail', opportunityId: 'retail',
                name: 'Synthetic retail workload', accountId: 'retail-account', accountName: 'Synthetic Retail Co', events: []
            })
            return data
        }
    })
    await page.route('**/api/momentum-focus', async (route) => {
        reads++
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(await host.invoke(route.request().postDataJSON())) })
    })
    await page.goto('/')
    await openMomentum(page)
    const pane = page.getByRole('region', { name: 'Momentum & Focus', exact: true })
    await expect(pane.getByLabel('Customer industry', { exact: true })).toHaveValue('hls')
    await expect(pane).not.toContainText('Synthetic Retail Co')
    expect(reads).toBe(1)
    await pane.getByLabel('Customer industry', { exact: true }).selectOption('all')
    await expect(pane.getByRole('table', { name: 'Momentum priority queue', exact: true })).toContainText('Synthetic Retail Co')
    expect(reads).toBe(2)
    await pane.getByLabel('Customer industry', { exact: true }).selectOption('hls')
    await expect(pane.getByRole('table', { name: 'Momentum priority queue', exact: true })).toBeVisible()
    await expect(pane).not.toContainText('Synthetic Retail Co')
    await pane.getByRole('button', { name: 'Clear selection', exact: true }).click()
    await expect(pane.getByLabel('Customer industry', { exact: true })).toHaveValue('hls')
    await expect(pane).not.toContainText('Synthetic Retail Co')
    expect(reads).toBe(2)
})

test('Momentum filters, paging and details work with further source requests blocked and no loading flicker', async ({ page }) => {
    const host = createMomentumFocusHost({ mode: 'sample' })
    let reads = 0
    await page.route('**/api/momentum-focus', async (route) => {
        if (++reads > 1) return route.abort('failed')
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(await host.invoke(route.request().postDataJSON())) })
    })
    await page.goto('/')
    await openMomentum(page)
    const pane = page.getByRole('region', { name: 'Momentum & Focus', exact: true })
    const queue = pane.getByRole('table', { name: 'Momentum priority queue', exact: true })
    await pane.evaluate((node) => {
        node.setAttribute('data-busy-transitions', '0')
        new MutationObserver((mutations) => {
            if (mutations.some((mutation) => mutation.attributeName === 'aria-busy') && node.getAttribute('aria-busy') === 'true') {
                node.setAttribute('data-busy-transitions', String(Number(node.getAttribute('data-busy-transitions')) + 1))
            }
        }).observe(node, { attributes: true, attributeFilter: ['aria-busy'] })
    })
    await pane.getByLabel('Role preset', { exact: true }).selectOption('SE')
    await queue.getByRole('button', { name: 'Why Synthetic quiet material blocker?', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Solution Engineer')
    await page.getByRole('dialog').press('Escape')
    await pane.getByLabel('Evidence lookback', { exact: true }).selectOption('90')
    await pane.getByLabel('Focus horizon', { exact: true }).selectOption('month')
    await pane.getByLabel('Rows per page', { exact: true }).selectOption('2')
    await expect(queue.getByRole('row')).toHaveCount(3)
    const before = await queue.locator('tbody tr').first().textContent()
    await pane.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect(queue.locator('tbody tr').first()).not.toHaveText(before!)
    await pane.getByLabel('Portfolio scope', { exact: true }).selectOption('mine')
    await expect(queue.getByRole('row')).toHaveCount(3)
    await expect(pane).toHaveAttribute('data-busy-transitions', '0')
    await expect(pane.getByRole('alert')).toHaveCount(0)
    expect(reads).toBe(1)
})
