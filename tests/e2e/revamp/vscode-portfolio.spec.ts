import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import type { AccountView, OpportunityView } from '../../../apps/vscode-extension/src/webview/view-types.js'

interface BridgeRequest {
    kind: string
    id: string
    method: string
    params?: { accountId?: string; opportunityId?: string; url?: string; draft?: unknown; preview?: unknown; update?: { comments: string } }
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
            rejectComments: boolean
            delayComments: boolean
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
    { id: 'alpha-one', accountId: 'alpha', name: 'Alpha analysis', opportunityIntent: ['Consumption'], recordedStage: 2, value: 100, currency: 'USD', closeDate: '2026-12-01' },
    { id: 'alpha-two', accountId: 'alpha', name: 'Alpha renewal', opportunityIntent: ['Billed'], recordedStage: 3, value: 200, currency: 'USD', closeDate: '2026-12-02' },
    { id: 'beta-one', accountId: 'beta', name: 'Beta platform', opportunityIntent: ['Billed', 'Consumption'], recordedStage: 1, value: 300, currency: 'USD', closeDate: '2026-12-03' },
    { id: 'hidden-one', accountId: 'hidden', name: 'Hidden project', opportunityIntent: ['Billed'], recordedStage: 1, value: 400, currency: 'USD', closeDate: '2026-12-04' }
]

const creationCatalog = {
    contractVersion: '1.2',
    target: 'draft',
    revision: 'catalog-1',
    account: { id: 'alpha', label: 'Alpha Corp' },
    opportunities: [{ id: 'alpha-one', label: 'Alpha analysis', currency: { id: 'eur', label: 'Euro', isoCode: 'EUR' } }],
    priceLists: [{ id: 'price-1', label: 'Standard price' }],
    currencies: [{ id: 'usd', label: 'US Dollar', isoCode: 'USD' }, { id: 'eur', label: 'Euro', isoCode: 'EUR' }],
    workloads: [{ id: 'workload-1', label: 'Cloud Scale Analytics' }],
    owners: [{ id: 'user-1', label: 'Sample seller' }],
    defaults: {
        owner: { id: 'user-1', label: 'Sample seller' },
        priceList: { id: 'price-1', label: 'Standard price' },
        currency: { id: 'usd', label: 'US Dollar', isoCode: 'USD' }
    },
    choices: {
        intent: [{ value: 606820000, label: 'Billed' }, { value: 606820001, label: 'Consumption' }],
        category: [{ value: 861980000, label: 'POC/Pilot' }],
        status: [{ value: 861980000, label: 'On Track' }],
        commitment: [{ value: 861980000, label: 'Uncommitted' }],
        customerBudgetApproved: [{ value: 606820000, label: 'Yes' }],
        solutionArea: [{ value: 394380000, label: 'Cloud and AI Platforms' }],
        technicalCapability: [{ value: 861980077, label: 'Cloud Scale Analytics' }]
    },
    maxMutations: 50
}

async function mountWebview(page: Page): Promise<void> {
    await page.route('**/', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><style>:root{--vscode-editor-background:#fff;--vscode-foreground:#333;--vscode-font-family:"Segoe UI",sans-serif;--vscode-textLink-foreground:#006ab1;--vscode-panel-border:#d1d1d1}</style></head><body><div id="root" data-mode="sample"></div></body></html>'
    }))
    await page.addInitScript(({ accounts, opportunities, creationCatalog }) => {
        const reply = (id: string, result: unknown) => window.postMessage({ kind: 'response', id, ok: true, result }, window.location.origin)
        window.portfolioTest = {
            accounts, requests: [], delayed: [], delayCoach: false, failAccounts: false, rejectEvidence: false,
            rejectComments: false, delayComments: false,
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
                    if ((['listAccounts', 'getPortfolioIndex', 'getDiscoverySnapshot'].includes(message.method) && state.failAccounts) ||
                        (message.method === 'openEvidence' && state.rejectEvidence) ||
                        (message.method === 'updateOpportunity' && state.rejectComments)) {
                        window.postMessage({
                            kind: 'response', id: message.id, ok: false,
                            error: { message: message.method === 'openEvidence' ? 'Evidence opening denied.'
                                : message.method === 'updateOpportunity' ? 'MSX did not confirm the saved opportunity comments.' : 'Portfolio search failed.' }
                        }, window.location.origin)
                        return
                    }
                    let result: unknown
                    if (message.method === 'getCurrentUserEmail') result = 'sample@example.test'
                    else if (message.method === 'getPortfolioIndex') result = {
                        contractVersion: '1.0', accounts: state.accounts.map((account) => ({ ...account, segment: account.segment ?? 'Enterprise' })),
                        opportunities: opportunities.filter((item) => state.accounts.some((account) => account.id === item.accountId && account.visibility !== 'hidden'))
                    }
                    else if (message.method === 'getDiscoverySnapshot') result = {
                        contractVersion: '1.0', generatedAt: '2026-10-21T12:00:00.000Z',
                        accounts: state.accounts.map((account) => ({ ...account, segment: account.segment ?? 'Enterprise' })),
                        portfolioOpportunities: opportunities.filter((item) => state.accounts.some((account) => account.id === item.accountId && account.visibility !== 'hidden')),
                        opportunities: [], milestoneTeamOpportunityIds: []
                    }
                    else if (message.method === 'listAccounts') result = state.accounts
                    else if (message.method === 'listOpportunities') result = opportunities.filter((item) => item.accountId === message.params?.accountId)
                    else if (message.method === 'updateOpportunity') {
                        const opportunity = opportunities.find((item) => item.id === message.params?.opportunityId)
                        const comments = message.params?.update?.comments
                        if (!opportunity || typeof comments !== 'string') throw new Error('Invalid opportunity comment update.')
                        opportunity.comments = comments
                        result = { ...opportunity }
                    }
                    else if (message.method === 'getRecordCreationCatalog') result = creationCatalog
                    else if (message.method === 'previewRecordCreation') {
                        const draft = message.params?.draft as {
                            kind: string
                            opportunities?: Array<{ milestones: unknown[] }>
                            milestones?: unknown[]
                        }
                        result = {
                            contractVersion: '1.2',
                            batchId: 'batch-vscode',
                            digest: 'a'.repeat(64),
                            target: 'draft',
                            catalogRevision: creationCatalog.revision,
                            normalizedDraft: draft,
                            mutationCount: draft.kind === 'opportunity-batch'
                                ? (draft.opportunities ?? []).reduce((total, item) => total + 2 + item.milestones.length, 0)
                                : (draft.milestones ?? []).length,
                            warnings: ['Draft only.'],
                            expiresAt: '2027-12-31T00:00:00.000Z'
                        }
                    }
                    else if (message.method === 'exportRecordCreationDraft') {
                        const preview = message.params?.preview as {
                            normalizedDraft: { kind: string; opportunities?: Array<{ milestones: unknown[] }>; milestones?: unknown[] }
                        }
                        const input = preview.normalizedDraft
                        result = {
                            contractVersion: '1.2',
                            result: {
                                contractVersion: '1.2',
                                batchId: 'batch-vscode',
                                target: 'draft',
                                state: 'drafted',
                                created: [],
                                audit: {
                                    correlationId: 'batch-vscode',
                                    opportunityCount: input.kind === 'opportunity-batch' ? input.opportunities?.length ?? 0 : 0,
                                    milestoneCount: input.kind === 'opportunity-batch'
                                        ? input.opportunities?.reduce((total, item) => total + item.milestones.length, 0) ?? 0
                                        : input.milestones?.length ?? 0
                                },
                                message: 'Draft created. No Opportunity or Milestone was written to MSX.'
                            },
                            files: [{ name: 'creation-manifest.json', content: '{}', mimeType: 'application/json' }]
                        }
                    }
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
                    if ((message.method === 'updateOpportunity' && state.delayComments) ||
                        (message.method === 'runMcemCoach' && state.delayCoach) ||
                        (message.method === 'listOpportunities' && message.params?.accountId === state.delayAccount)) {
                        state.delayed.push({ id: message.id, result })
                    } else reply(message.id, result)
                }
            })
        })
    }, { accounts, opportunities, creationCatalog })
    await page.goto('/')
    await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
    await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
    await expect(page.locator('#portfolio-details-panel').getByRole('heading', { name: 'Alpha analysis', exact: true })).toBeVisible()
}

test('opens the focused opportunity in MSX through the VS Code host and tracks selection changes', async ({ page }) => {
    await mountWebview(page)
    const details = page.locator('#portfolio-details-panel')
    const opportunities = page.locator('#portfolio-accounts-panel .opportunity-table')
    const openedLinks = () => page.evaluate(() => window.portfolioTest.requests
        .filter((request) => request.method === 'openEvidence').map((request) => request.params?.url))
    await opportunities.getByRole('row').filter({ hasText: 'Alpha renewal' }).locator('.record-link').click()
    expect(await openedLinks()).toEqual([])
    await expect(opportunities.getByRole('link')).toHaveCount(0)
    const renewalLink = details.getByRole('heading', { name: 'Alpha renewal', exact: true }).getByRole('link')
    const renewalUrl = 'https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=alpha-two'
    await expect(renewalLink).toHaveAttribute('href', renewalUrl)
    await renewalLink.click()
    await expect.poll(openedLinks).toEqual([renewalUrl])

    await opportunities.getByRole('row').filter({ hasText: 'Alpha analysis' }).locator('.record-link').click()
    const analysisLink = details.getByRole('heading', { name: 'Alpha analysis', exact: true }).getByRole('link')
    const analysisUrl = 'https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=alpha-one'
    await expect(analysisLink).toHaveAttribute('href', analysisUrl)
    await analysisLink.focus()
    await analysisLink.press('Enter')
    await expect.poll(openedLinks).toEqual([renewalUrl, analysisUrl])

    await page.evaluate(() => { window.portfolioTest.rejectEvidence = true })
    await analysisLink.click()
    await expect(details.getByText('Evidence opening denied.', { exact: true })).toBeVisible()
})

test('opens a dedicated New pane before Discover in the VS Code webview', async ({ page }) => {
    await mountWebview(page)
    await expect(page.locator('.app-header .tabs button')).toHaveText(['New', 'Discover', 'Portfolio', 'Plays', 'Dashboards'])

    await page.getByRole('button', { name: 'New', exact: true }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await expect(pane).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Opportunity', exact: true })).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Multiple Opportunities' })).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Milestone', exact: true })).toBeVisible()
    const tabs = await page.locator('.app-header .tabs').boundingBox()
    const content = await pane.boundingBox()
    expect(content!.y).toBeGreaterThan(tabs!.y + tabs!.height)
    await expect(page.locator('#portfolio-details-panel')).toHaveCount(0)
})

test('saves opportunity comments only after acknowledgement and retains an unconfirmed draft in VS Code', async ({ page }) => {
    await mountWebview(page)
    const row = page.getByRole('row').filter({ hasText: 'Alpha analysis' }).first()
    await row.getByRole('button', { name: 'Comments', exact: true }).click()
    const editor = page.locator('.record-editor-row')
    const comments = editor.getByRole('textbox')
    await comments.fill('Reviewed webview opportunity comment.')
    await page.evaluate(() => { window.portfolioTest.delayComments = true })
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    await expect(page.getByText('Opportunity comments saved.', { exact: true })).toHaveCount(0)
    await page.evaluate(() => { window.portfolioTest.delayComments = false; window.portfolioTest.release() })
    await expect(editor).toHaveCount(0)
    await expect(page.getByText('Opportunity comments saved.', { exact: true })).toBeVisible()
    const writes = await page.evaluate(() => window.portfolioTest.requests.filter((request) => request.method === 'updateOpportunity'))
    expect(writes).toHaveLength(1)
    expect(writes[0]?.params).toEqual({ opportunityId: 'alpha-one', update: { comments: 'Reviewed webview opportunity comment.' } })

    await row.getByRole('button', { name: 'Comments', exact: true }).click()
    await expect(comments).toHaveValue('Reviewed webview opportunity comment.')
    await comments.fill('Retain this unconfirmed draft.')
    await page.evaluate(() => { window.portfolioTest.rejectComments = true })
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('MSX did not confirm the saved opportunity comments.', { exact: true })).toBeVisible()
    await expect(comments).toHaveValue('Retain this unconfirmed draft.')
    await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await row.getByRole('button', { name: 'Comments', exact: true }).click()
    await expect(comments).toHaveValue('Reviewed webview opportunity comment.')
})

test('previews and exports a reviewed Opportunity draft in the VS Code New pane', async ({ page }) => {
    await mountWebview(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Opportunity', exact: true }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('alpha')
    await expect(pane.getByText('Draft only', { exact: false })).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Validate & review' })).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Submit to SQLite' })).toHaveCount(0)
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane.getByLabel('Opportunity name')).toBeFocused()
    await expect(pane.getByRole('alert').getByRole('link', { name: 'Opportunity name' })).toBeVisible()
    await pane.getByLabel('Opportunity name').fill('Synthetic webview opportunity')
    await pane.getByRole('listbox', { name: 'Opportunity Intent' }).selectOption('606820001')
    await pane.getByLabel('Estimated value').fill('125000')
    await pane.getByLabel('Estimated close date').fill('2027-05-31')
    await pane.getByLabel('Need', { exact: true }).fill('Synthetic customer need')
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane.getByRole('heading', { name: 'Review record creation' })).toBeVisible()
    await expect(pane.locator('.new-record-review')).toHaveAttribute('aria-live', 'polite')
    await expect(pane.getByText('Standard price')).toBeVisible()
    await expect(pane.getByText('US Dollar (USD)')).toBeVisible()
    await expect(pane.getByText('Synthetic customer need')).toBeVisible()
    await expect(pane.getByText('2027-05-31')).toBeVisible()
    await pane.getByRole('button', { name: 'Edit' }).click()
    await expect(pane.getByRole('button', { name: 'Validate & review', exact: true })).toBeFocused()
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await pane.getByRole('button', { name: 'Export draft' }).click()
    await expect(pane.getByRole('status')).toContainText('No Opportunity or Milestone was written to MSX.')
    expect(await page.evaluate(() => window.portfolioTest.requests.some((request) => request.method === 'commitRecordCreation'))).toBe(false)
})

test('keeps an existing Opportunity fixed while drafting a child Milestone in VS Code', async ({ page }) => {
    await mountWebview(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Milestone', exact: true }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('alpha')
    await pane.getByRole('combobox', { name: 'Parent Opportunity' }).selectOption('alpha-one')
    await pane.getByLabel('Milestone name').fill('Synthetic adoption milestone')
    await pane.getByLabel('Milestone category').selectOption('861980000')
    await pane.getByLabel('Milestone estimated date').fill('2027-02-15')
    await pane.getByLabel('Workload').selectOption('workload-1')
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane).toContainText('1 planned mutation')
    await expect(pane).toContainText('Alpha analysis')
    await expect(pane.getByRole('region', { name: 'Milestone Synthetic adoption milestone' }).getByText('Euro (EUR)')).toBeVisible()
    await pane.getByRole('button', { name: 'Export draft' }).click()
    await expect(pane.getByRole('status')).toContainText('No Opportunity or Milestone was written to MSX.')
    const previewRequest = await page.evaluate(() => window.portfolioTest.requests.find((request) => request.method === 'previewRecordCreation'))
    expect(previewRequest?.params?.draft).toMatchObject({
        kind: 'existing-opportunity-milestone-batch',
        opportunity: { id: 'alpha-one' },
        milestones: [{ name: 'Synthetic adoption milestone' }]
    })
})

test('imports existing-parent Milestones as a no-write draft in VS Code', async ({ page }) => {
    await mountWebview(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Milestone', exact: true }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('alpha')
    await pane.getByRole('combobox', { name: 'Parent Opportunity' }).selectOption('alpha-one')
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Import CSV' }).click()
    await expect(pane.getByText('All rows use the selected parent.', { exact: false })).toBeVisible()
    await pane.locator('.new-record-import input[type="file"]').setInputFiles({
        name: 'milestones.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('clientMilestoneKey,name,milestoneCategory,milestoneDate,workloadId\nms-webview-csv,Webview CSV pilot,POC/Pilot,2027-02-15,workload-1\n')
    })
    await pane.getByRole('button', { name: 'Validate & load CSV' }).click()
    await expect(pane.getByLabel('Milestone name')).toHaveValue('Webview CSV pilot')
    await pane.getByRole('button', { name: 'Validate & review' }).click()
    await pane.getByRole('button', { name: 'Export draft' }).click()
    await expect(pane.getByRole('status')).toContainText('No Opportunity or Milestone was written to MSX.')
    const requests = await page.evaluate(() => window.portfolioTest.requests)
    expect(requests.find((item) => item.method === 'previewRecordCreation')?.params?.draft).toMatchObject({
        kind: 'existing-opportunity-milestone-batch',
        opportunity: { id: 'alpha-one' },
        milestones: [{ name: 'Webview CSV pilot' }]
    })
    expect(requests.some((item) => item.method === 'commitRecordCreation')).toBe(false)
})

test('previews an existing-parent Milestone grid without losing Form details in VS Code', async ({ page }) => {
    await mountWebview(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Milestone', exact: true }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('alpha')
    await pane.getByRole('combobox', { name: 'Parent Opportunity' }).selectOption('alpha-one')
    await pane.getByLabel('Milestone name').fill('Webview grid pilot')
    await pane.getByLabel('Milestone category').selectOption('861980000')
    await pane.getByLabel('Milestone estimated date').fill('2027-02-15')
    await pane.getByLabel('Workload').selectOption('workload-1')
    await pane.getByLabel('Milestone comments').fill('Webview optional detail')
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Grid' }).click()
    const grid = pane.getByRole('table', { name: 'Milestone entry grid' })
    await pane.getByRole('button', { name: 'Add Milestone' }).click()
    await grid.getByRole('row').nth(2).getByLabel('Milestone name').fill('Webview grid rollout')
    await grid.getByRole('row').nth(2).getByLabel('Milestone category').selectOption('861980000')
    await grid.getByRole('row').nth(2).getByLabel('Milestone estimated date').fill('2027-04-15')
    await grid.getByRole('row').nth(2).getByLabel('Workload').selectOption('workload-1')
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Form' }).click()
    await expect(pane.getByLabel('Milestone comments').first()).toHaveValue('Webview optional detail')
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane).toContainText('2 planned mutations')
    await pane.getByRole('button', { name: 'Export draft' }).click()
    await expect(pane).toContainText('0 Opportunities, 2 Milestones')
})

test('keeps multiple Opportunity edits and child Milestones when switching Form and Grid in VS Code', async ({ page }) => {
    await mountWebview(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Multiple Opportunities' }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('alpha')
    await expect(pane.getByText('Draft only - MSX creation is disabled')).toBeVisible()
    await pane.getByLabel('Opportunity name').first().fill('Sample analytics expansion')
    await pane.getByRole('listbox', { name: 'Opportunity Intent' }).first().selectOption('606820001')
    await pane.getByLabel('Estimated value').first().fill('100000')
    await pane.getByLabel('Estimated close date').first().fill('2027-03-31')
    await pane.getByRole('button', { name: 'Add another Opportunity' }).click()
    await pane.getByLabel('Opportunity name').nth(1).fill('Sample billed project')
    await pane.getByRole('listbox', { name: 'Opportunity Intent' }).nth(1).selectOption('606820000')
    await pane.getByLabel('Estimated value').nth(1).fill('250000')
    await pane.getByLabel('Estimated close date').nth(1).fill('2027-05-31')
    const secondOpportunity = pane.locator('.new-record-content > fieldset.new-record-row').nth(1)
    await secondOpportunity.getByRole('button', { name: 'Add Milestone' }).click()
    await secondOpportunity.getByLabel('Milestone name').fill('Sample pilot')
    await secondOpportunity.getByLabel('Milestone category').selectOption('861980000')
    await secondOpportunity.getByLabel('Milestone estimated date').fill('2027-04-15')
    await secondOpportunity.getByLabel('Workload').selectOption('workload-1')
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Grid' }).click()
    await expect(pane.locator('.new-record-grid tbody tr')).toHaveCount(2)
    const grid = pane.locator('.new-record-grid')
    await grid.getByRole('row').nth(2).getByRole('button', { name: 'Duplicate Opportunity' }).click()
    await expect(grid.locator('tbody tr')).toHaveCount(3)
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Form' }).click()
    await expect(pane.locator('.new-record-content > fieldset.new-record-row').nth(2).getByLabel('Milestone name')).toHaveValue('Sample pilot')
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Grid' }).click()
    await grid.getByRole('row').nth(3).getByRole('button', { name: 'Remove Opportunity' }).click()
    await expect(grid.locator('tbody tr')).toHaveCount(2)
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Form' }).click()
    await expect(pane.getByLabel('Opportunity name').nth(1)).toHaveValue('Sample billed project')
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Import CSV' }).click()
    await expect(pane.getByRole('button', { name: 'Validate & review', exact: true })).toBeDisabled()
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Form' }).click()
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane).toContainText('5 planned mutations')
    await pane.getByRole('button', { name: 'Export draft' }).click()
    await expect(pane).toContainText('2 Opportunities, 1 Milestones')
})

test('searches across the portfolio from other tabs, restores panels, and supports keyboard selection', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await mountWebview(page)
    const opportunityTable = page.locator('#portfolio-accounts-panel .opportunity-table')
    await expect(opportunityTable.getByRole('columnheader', { name: 'Opportunity intent' })).toBeVisible()
    await expect(opportunityTable.getByRole('row').filter({ hasText: 'Alpha analysis' }).getByRole('cell').nth(1)).toHaveText('Consumption')
    await page.getByRole('button', { name: 'Hide Accounts panel', exact: true }).click()
    await page.getByRole('button', { name: 'Hide opportunity details panel', exact: true }).click()
    await page.getByRole('button', { name: 'Discover', exact: true }).click()
    const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })
    await search.fill('bEtA')
    await expect(page.getByRole('listbox', { name: 'Search results' }).getByRole('option')).toHaveCount(2)
    await page.getByRole('option', { name: 'Beta platform Opportunity' }).click()
    const details = page.locator('#portfolio-details-panel')
    await expect(details.getByRole('heading', { name: 'Beta platform', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Customer account', exact: true })).toHaveValue('beta')

    await page.getByRole('combobox', { name: 'Customer account', exact: true }).selectOption('alpha')
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

test('uses cached search until explicit Refresh, reports source failures and retries without exposing hidden accounts', async ({ page }) => {
    await mountWebview(page)
    const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })
    await search.fill('Alpha')
    await expect(page.getByRole('option', { name: /^Alpha Corp Account/ })).toBeVisible()
    await page.evaluate(() => { window.portfolioTest.failAccounts = true })
    await search.press('Escape')
    await page.getByRole('button', { name: 'Refresh Portfolio', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Portfolio search failed.')
    await page.evaluate(() => {
        window.portfolioTest.failAccounts = false
        window.portfolioTest.accounts.push({ id: 'gamma', name: 'Gamma Services', segment: 'Enterprise' })
    })
    await page.getByRole('button', { name: 'Refresh Portfolio', exact: true }).click()
    await search.fill('Gamma')
    await expect(page.getByRole('option', { name: /^Gamma Services Account/ })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(() => window.portfolioTest.requests.some((request) =>
        request.method === 'listOpportunities' && request.params?.accountId === 'hidden'))).toBe(false)
    expect(await page.evaluate(() => window.portfolioTest.requests.filter((request) => request.method === 'getPortfolioIndex').length)).toBe(1)
    expect(await page.evaluate(() => window.portfolioTest.requests.filter((request) => request.method === 'getDiscoverySnapshot').length)).toBe(2)
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
    const accountSelect = page.getByRole('combobox', { name: 'Customer account', exact: true })
    await accountSelect.selectOption('beta')
    await expect(page.locator('#portfolio-details-panel').getByRole('heading', { name: 'Beta platform', exact: true })).toBeVisible()
    await expect(page.locator('#next-best-actions-panel')).not.toContainText('Confirm Alpha analysis')
    await expect.poll(() => page.evaluate(() => window.portfolioTest.delayed.length)).toBe(1)
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
