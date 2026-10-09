import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import type { AccountView, OpportunityView } from '../../../apps/vscode-extension/src/webview/view-types.js'

interface BridgeRequest {
    kind: string
    id: string
    method: string
    params?: { accountId?: string; opportunityId?: string; url?: string }
}

declare global {
    interface Window {
        portfolioTest: {
            accounts: AccountView[]
            requests: BridgeRequest[]
            delayed: { id: string; result: unknown }[]
            delayCoach: boolean
            delayAccount?: string
            failAccounts: boolean
            rejectEvidence: boolean
            release(): void
        }
    }
}

const accounts: AccountView[] = [
    { id: 'alpha', name: 'Alpha Corp', segment: 'Enterprise' },
    { id: 'beta', name: 'Beta Health', segment: 'Enterprise' },
    { id: 'hidden', name: 'Hidden customer', visibility: 'hidden' }
]
const opportunities: OpportunityView[] = [
    { id: 'alpha-one', accountId: 'alpha', name: 'Alpha analysis', recordedStage: 2, value: 100, currency: 'USD', closeDate: '2026-12-01' },
    { id: 'alpha-two', accountId: 'alpha', name: 'Alpha renewal', recordedStage: 3, value: 200, currency: 'USD', closeDate: '2026-12-02' },
    { id: 'beta-one', accountId: 'beta', name: 'Beta platform', recordedStage: 1, value: 300, currency: 'USD', closeDate: '2026-12-03' },
    { id: 'hidden-one', accountId: 'hidden', name: 'Hidden project', recordedStage: 1, value: 400, currency: 'USD', closeDate: '2026-12-04' }
]

async function mountWebview(page: Page): Promise<void> {
    await page.route('**/', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><style>:root{--vscode-editor-background:#fff;--vscode-foreground:#333;--vscode-font-family:"Segoe UI",sans-serif;--vscode-textLink-foreground:#006ab1;--vscode-panel-border:#d1d1d1}</style></head><body><div id="root" data-mode="sample"></div></body></html>'
    }))
    await page.addInitScript(({ accounts, opportunities }) => {
        const reply = (id: string, result: unknown) => window.postMessage({ kind: 'response', id, ok: true, result }, window.location.origin)
        window.portfolioTest = {
            accounts, requests: [], delayed: [], delayCoach: false, failAccounts: false, rejectEvidence: false,
            release() {
                for (const response of this.delayed.splice(0)) reply(response.id, response.result)
            }
        }
        Object.defineProperty(window, 'acquireVsCodeApi', {
            value: () => ({
                getState: () => undefined,
                setState: () => undefined,
                postMessage: (message: BridgeRequest) => {
                    if (message.kind !== 'request') return
                    const state = window.portfolioTest
                    state.requests.push(message)
                    if ((message.method === 'listAccounts' && state.failAccounts) || (message.method === 'openEvidence' && state.rejectEvidence)) {
                        window.postMessage({
                            kind: 'response', id: message.id, ok: false,
                            error: { message: message.method === 'listAccounts' ? 'Portfolio search failed.' : 'Evidence opening denied.' }
                        }, window.location.origin)
                        return
                    }
                    let result: unknown
                    if (message.method === 'getCurrentUserEmail') result = 'sample@example.test'
                    else if (message.method === 'listAccounts') result = state.accounts
                    else if (message.method === 'listOpportunities') result = opportunities.filter((item) => item.accountId === message.params?.accountId)
                    else if (['listMilestones', 'discoverOpportunities', 'listWorkflowDefinitions', 'listWorkflowRuns'].includes(message.method)) result = []
                    else if (message.method === 'openEvidence') result = null
                    else if (message.method === 'runMcemCoach') {
                        const opportunity = opportunities.find((item) => item.id === message.params?.opportunityId)
                        if (!opportunity) throw new Error('Unknown test opportunity')
                        result = {
                            summary: `Review of ${opportunity.name}`, state: 'needs-attention',
                            recordedStage: opportunity.recordedStage, evidenceBasedStage: 1,
                            criteria: [], missingData: [],
                            recommendations: [{
                                id: 'action', action: `Confirm ${opportunity.name}`, ownerRole: 'AE', confidence: 'high',
                                rationale: 'The decision maker needs confirmation.', evidenceIds: ['snapshot', 'guidance', 'missing'], assumption: false
                            }, {
                                id: 'assumption', action: 'Validate scope.', ownerRole: 'SE', confidence: 'low',
                                rationale: 'Scope has not been recorded.', evidenceIds: [], assumption: true
                            }],
                            evidence: [
                                { id: 'snapshot', title: `${opportunity.name} snapshot`, source: 'msx', url: `https://example.test/${opportunity.id}` },
                                { id: 'guidance', title: 'Stage guidance', source: 'mcem' }
                            ]
                        }
                    } else throw new Error(`Unexpected test request: ${message.method}`)
                    if ((message.method === 'runMcemCoach' && state.delayCoach) ||
                        (message.method === 'listOpportunities' && message.params?.accountId === state.delayAccount)) {
                        state.delayed.push({ id: message.id, result })
                    } else reply(message.id, result)
                }
            })
        })
    }, { accounts, opportunities })
    await page.goto('/')
    await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
    await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
    await expect(page.locator('#portfolio-details-panel').getByRole('heading', { name: 'Alpha analysis', exact: true })).toBeVisible()
}

test('searches across the portfolio from other tabs, restores panels, and supports keyboard selection', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await mountWebview(page)
    await page.getByRole('button', { name: 'Hide Accounts panel', exact: true }).click()
    await page.getByRole('button', { name: 'Hide opportunity details panel', exact: true }).click()
    await page.getByRole('button', { name: 'Discover', exact: true }).click()
    const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })
    await search.fill('bEtA')
    await expect(page.getByRole('listbox', { name: 'Search results' }).getByRole('option')).toHaveCount(2)
    await page.getByRole('option', { name: 'Beta platform Opportunity' }).click()
    const details = page.locator('#portfolio-details-panel')
    await expect(details.getByRole('heading', { name: 'Beta platform', exact: true })).toBeVisible()
    await expect(page.locator('#portfolio-accounts-panel select').first()).toHaveValue('beta')

    await page.locator('#portfolio-accounts-panel select').first().selectOption('alpha')
    await expect(details.getByRole('heading', { name: 'Alpha analysis', exact: true })).toBeVisible()
    await search.fill('platform')
    await expect(page.getByRole('listbox', { name: 'Search results' }).getByRole('option')).toHaveCount(1)
    await search.press('Enter')
    await expect(details.getByRole('heading', { name: 'Beta platform', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Plays', exact: true }).click()
    await search.fill('Alpha Corp')
    await expect(page.getByRole('listbox', { name: 'Search results' }).getByRole('option')).toHaveCount(1)
    await search.press('Enter')
    await expect(details.getByRole('heading', { name: 'Alpha analysis', exact: true })).toBeVisible()
    await search.fill('hidden')
    await expect(page.getByText('No accounts or opportunities found.', { exact: true })).toBeVisible()
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await page.setViewportSize({ width: 420, height: 850 })
    await expect(search).toBeVisible()
    expect(await page.locator('header.app-header').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(errors).toEqual([])
})

test('reports search errors, retries on refocus, and refreshes the visible account set', async ({ page }) => {
    await mountWebview(page)
    const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })
    await page.evaluate(() => { window.portfolioTest.failAccounts = true })
    await search.fill('Alpha')
    await expect(page.getByRole('alert')).toHaveText('Portfolio search failed.')
    await search.press('Escape')
    await page.getByRole('button', { name: 'Portfolio', exact: true }).focus()
    await page.evaluate(() => {
        window.portfolioTest.failAccounts = false
        window.portfolioTest.accounts.push({ id: 'gamma', name: 'Gamma Services' })
        window.portfolioTest.delayAccount = 'beta'
    })
    await search.fill('Gamma')
    await expect(page.getByText('Searching portfolio...', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.portfolioTest.delayed.length)).toBe(1)
    await page.evaluate(() => { window.portfolioTest.release() })
    await expect(page.getByRole('option', { name: 'Gamma Services Account' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(() => window.portfolioTest.requests.some((request) =>
        request.method === 'listOpportunities' && request.params?.accountId === 'hidden'))).toBe(false)
})

test('shows recommendation rationale, per-action citations and assumptions, and opens evidence through the host', async ({ page }) => {
    await mountWebview(page)
    await page.locator('#portfolio-details-panel').getByRole('button', { name: 'Run MCEM Coach', exact: true }).click()
    const actions = page.locator('#next-best-actions-panel')
    await expect(actions.getByText('The decision maker needs confirmation.', { exact: true })).toBeVisible()
    await expect(actions.getByText('high confidence', { exact: false })).toHaveText('high confidence · 3 citations')
    await expect(actions.getByText('Stage guidance', { exact: true })).toBeVisible()
    await expect(actions.getByRole('button', { name: 'Stage guidance' })).toHaveCount(0)
    await expect(actions.getByText('Evidence unavailable: missing', { exact: true })).toBeVisible()
    await expect(actions.getByText('Assumption - confirm before acting.', { exact: true })).toBeVisible()
    await expect(actions.getByText('low confidence', { exact: false })).toHaveText('low confidence · 0 citations')
    await actions.getByRole('button', { name: 'Alpha analysis snapshot', exact: true }).click()
    await expect(page.getByText('Opened evidence in your browser.', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.portfolioTest.requests.filter((request) => request.method === 'openEvidence').map((request) => request.params?.url)))
        .toEqual(['https://example.test/alpha-one'])
    await page.evaluate(() => { window.portfolioTest.rejectEvidence = true })
    await actions.getByRole('button', { name: 'Alpha analysis snapshot', exact: true }).click()
    await expect(page.getByText('Evidence opening denied.', { exact: true })).toBeVisible()
})

test('ignores stale account loads and MCEM responses after changing the selection', async ({ page }) => {
    await mountWebview(page)
    await page.evaluate(() => { window.portfolioTest.delayCoach = true })
    await page.locator('#portfolio-details-panel').getByRole('button', { name: 'Run MCEM Coach', exact: true }).click()
    await expect(page.locator('#next-best-actions-panel')).toContainText('Evaluating')
    await page.evaluate(() => { window.portfolioTest.delayAccount = 'beta' })
    const accountSelect = page.locator('#portfolio-accounts-panel select').first()
    await accountSelect.selectOption('beta')
    await expect(page.locator('#next-best-actions-panel')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.portfolioTest.delayed.length)).toBe(2)
    await accountSelect.selectOption('alpha')
    await expect(page.locator('#portfolio-details-panel').getByRole('heading', { name: 'Alpha analysis', exact: true })).toBeVisible()
    await page.evaluate(() => {
        window.portfolioTest.delayCoach = false
        delete window.portfolioTest.delayAccount
        window.portfolioTest.release()
    })
    await expect(accountSelect).toHaveValue('alpha')
    await expect(page.locator('#portfolio-details-panel').getByRole('heading', { name: 'Alpha analysis', exact: true })).toBeVisible()
    await expect(page.locator('#next-best-actions-panel')).not.toContainText('Confirm Alpha analysis')
    await page.locator('#portfolio-details-panel').getByRole('button', { name: 'Run MCEM Coach', exact: true }).click()
    await expect(page.locator('#next-best-actions-panel')).toContainText('Confirm Alpha analysis')
    await page.locator('#portfolio-accounts-panel').getByRole('button', { name: 'Alpha renewal', exact: false }).click()
    await expect(page.locator('#next-best-actions-panel')).not.toContainText('Confirm Alpha analysis')
})
