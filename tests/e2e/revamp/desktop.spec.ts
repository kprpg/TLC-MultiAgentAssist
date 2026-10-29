import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LocalStore } from '../../../packages/connectors/local-store/index.js'
import { workflowDefinitions, workflowOutput, workflowRun } from './workflow-fixtures.js'
import { expectCompleteSamplePortfolio } from './sample-portfolio.js'
import { expectOpportunityAndMilestoneRemoval } from './membership-removal.js'
import { expectOpportunitiesToFillCollapsedWorkspace } from './opportunities-layout.js'
import { conversionOffer, followUpAgentResponse, initialAgentResponse } from './agent-response-fixtures.js'
import { agentTaskRequestSchema, contractVersion, emailComposeRequestSchema } from '../../../packages/common/contracts/index.js'
import { expectCopiedCustomerEmail, installCustomerEmailClipboard } from '../customer-email.js'
import { captureTypography, expectFontReduction } from '../typography.js'

test('Desktop font scale preserves icon and shell dimensions while reducing dialog text', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-font-scale-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })
    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1600, height: 1000 })
        const shell = await captureTypography(test.info(), {
            body: window.locator('body'),
            title: window.locator('.blade-header h2').first(),
            caption: window.locator('.brand span'),
            search: window.locator('.global-search input'),
            icon: window.locator('.profile-button svg'),
            commandBar: window.locator('.command-bar')
        }, 'shell')
        expectFontReduction(shell, { body: 11.4, title: 13.3, caption: 10.45, search: 11.4 })
        expect(shell['icon']).toMatchObject({ width: 20, height: 20 })
        expect(shell['commandBar']).toMatchObject({ height: 44, padding: '0px 10px', gap: '10px' })
        await window.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
        await window.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Grid operations modernization / }).click()
        await window.getByRole('region', { name: 'Grid operations modernization milestones' }).getByRole('row')
            .filter({ hasText: 'Customer outcome validation' }).first().getByRole('button', { name: /^Edit / }).click()
        await window.getByRole('menuitem', { name: 'Activities', exact: true }).click()
        const dialog = window.getByRole('dialog')
        const dialogFonts = await captureTypography(test.info(), {
            title: dialog.getByRole('heading', { name: /^Activities/ }),
            subject: dialog.getByLabel('Subject'),
            category: dialog.locator('.milestone-activity-form select').first(),
            description: dialog.getByLabel('Description'),
            cancel: dialog.getByRole('button', { name: 'Cancel', exact: true })
        }, 'dialog')
        expectFontReduction(dialogFonts, { title: 19, subject: 13.3, category: 13.3333, description: 13.3, cancel: 13.3 })
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

for (const scenario of [
    {
        label: 'standard email draft', suggestion: conversionOffer, initialResponse: initialAgentResponse,
        emailResponse: followUpAgentResponse, heading: 'Customer-ready draft'
    },
    {
        label: 'suggested email prompt with a generic reply heading',
        suggestion: 'Draft a follow-up e-mail to the sponsor.',
        initialResponse: initialAgentResponse.replace(conversionOffer, 'Choose a next step:\n\n- Draft a follow-up e-mail to the sponsor.'),
        emailResponse: followUpAgentResponse.replace('1. Customer-ready draft', '## Follow-up for the sponsor'),
        heading: 'Follow-up for the sponsor'
    }
]) test(`Desktop agent follow-ups send the previous response through IPC and keep both replies readable (${scenario.label})`, async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-agent-follow-up-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })
    try {
        await app.evaluate(({ ipcMain }, { initial, followUp, version }) => {
            process.env.TLC_TEST_AGENT_REQUESTS = '[]'
            delete process.env.TLC_TEST_CUSTOMER_EMAIL
            ipcMain.removeHandler('tlc:open-email-compose')
            ipcMain.handle('tlc:open-email-compose', (_event, request: unknown) => {
                process.env.TLC_TEST_CUSTOMER_EMAIL = JSON.stringify(request)
                return { state: 'opened' }
            })
            ipcMain.removeHandler('tlc:run-agent-task-stream')
            ipcMain.handle('tlc:run-agent-task-stream', (event, request: { capability: string }, streamId: string) => {
                const requests: unknown[] = JSON.parse(process.env.TLC_TEST_AGENT_REQUESTS ?? '[]')
                requests.push(request)
                process.env.TLC_TEST_AGENT_REQUESTS = JSON.stringify(requests)
                const terminal = {
                        type: 'complete',
                        response: {
                            contractVersion: version, correlationId: '11111111-1111-4111-8111-111111111111',
                            capability: request.capability, agentVersion: 'presentation-test', generatedAt: '2026-10-22T12:00:00.000Z',
                            mode: 'sample', state: 'complete', content: requests.length === 1 ? initial : followUp,
                            sourceHealth: [{ source: 'msx', state: 'sample', detail: 'Sanitized test evidence.', checkedAt: '2026-10-22T12:00:00.000Z' }]
                        }
                }
                event.sender.send('tlc:agent-task-event', { streamId, event: terminal })
                return terminal
            })
        }, { initial: scenario.initialResponse, followUp: scenario.emailResponse, version: contractVersion })
        const window = await app.firstWindow()
        await installCustomerEmailClipboard(window)
        await window.setViewportSize({ width: 1600, height: 1000 })
        await window.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'Portfolio', exact: true }).click()
        await window.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
        await window.getByRole('table', { name: 'Contoso Energy opportunities' }).getByRole('button', { name: /^Grid operations modernization / }).click()
        await window.getByRole('tab', { name: 'Multi-Agent Guidance' }).click()
        await window.getByRole('button', { name: 'What should the account team focus on this week?' }).click()
        await expect(window.locator('.agent-response-markdown h2')).toHaveText(['Summary', 'Observed signals', 'Recommended actions', 'Sources', 'Feedback prompt'])
        const requests = async () => agentTaskRequestSchema.array().parse(JSON.parse(await app.evaluate(() => process.env.TLC_TEST_AGENT_REQUESTS ?? '[]')))
        expect(await requests()).toHaveLength(1)
        await window.getByRole('button', { name: `Send follow-up: ${scenario.suggestion}` }).click()
        const response = window.getByRole('article', { name: 'Agent follow-up response' })
        await expect(response.getByRole('heading', { name: scenario.heading })).toBeVisible()
        await expect(response.getByRole('columnheader')).toHaveText(['Owner', 'Action', 'Evidence'])
        await expect(window.locator('.agent-response-markdown').first().getByRole('heading', { name: 'Summary', exact: true })).toBeVisible()
        const sent = await requests()
        expect(sent).toHaveLength(2)
        expect(sent[1]).toMatchObject({ capability: 'account-pulse', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization' })
        expect(sent[1]!.prompt).toContain(scenario.initialResponse)
        expect(sent[1]!.prompt).toContain(scenario.suggestion)
        const actions = response.getByRole('region', { name: 'Customer email draft actions' })
        await expectCopiedCustomerEmail(window, actions)
        expect(await app.evaluate(() => process.env.TLC_TEST_CUSTOMER_EMAIL)).toBeUndefined()
        await actions.getByRole('button', { name: 'E-mail', exact: true }).click()
        await actions.getByLabel('Draft recipients', { exact: true }).fill('reviewer@example.com')
        await actions.getByRole('button', { name: 'Prepare unsent draft', exact: true }).click()
        await expect(actions.getByRole('status')).toContainText('Unsent email draft opened')
        const email = emailComposeRequestSchema.parse(JSON.parse(await app.evaluate(() => process.env.TLC_TEST_CUSTOMER_EMAIL ?? 'null')))
        expect(email.recipients).toEqual(['reviewer@example.com'])
        expect(email.subject).toBe('Confirming the approval path')
        expect(email.responseMarkdown).toContain('Please confirm the sponsor and approval sequence.')
        expect(email.responseMarkdown).not.toContain('Assumptions and missing information')
        expect(email.responseMarkdown).not.toContain('Feedback prompt')
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('opens the focused opportunity in MSX through the Desktop browser bridge', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-opportunity-link-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })

    try {
        await app.evaluate(({ shell }) => {
            delete process.env.TLC_TEST_OPENED_MSX_URL
            shell.openExternal = async (url) => { process.env.TLC_TEST_OPENED_MSX_URL = url }
        })
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1600, height: 900 })
        await window.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'Portfolio', exact: true }).click()
        await window.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
        const opportunities = window.getByRole('table', { name: 'Contoso Energy opportunities' })
        await opportunities.getByRole('button', { name: /^Grid operations modernization / }).click()
        expect(await app.evaluate(() => process.env.TLC_TEST_OPENED_MSX_URL)).toBeUndefined()
        await expect(opportunities.getByRole('link')).toHaveCount(0)

        const heading = window.getByRole('region', { name: 'Opportunity workbench' }).getByRole('heading', { name: 'Grid operations modernization', exact: true })
        const link = heading.getByRole('link')
        const expectedUrl = 'https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=opp-grid-modernization'
        await expect(link).toHaveAttribute('href', expectedUrl)
        await link.focus()
        await link.press('Enter')
        await expect.poll(() => app.evaluate(() => process.env.TLC_TEST_OPENED_MSX_URL)).toBe(expectedUrl)
        await expect(heading).toBeVisible()
        await expect(opportunities.locator('tr.selected')).toContainText('Grid operations modernization')
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('opens a dedicated New pane before Discover in Desktop', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-new-tab-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1600, height: 900 })
        const tabs = window.getByRole('navigation', { name: 'Primary tabs' })
        await expect(tabs.getByRole('button')).toHaveText(['New', 'Discover', 'Portfolio', 'Plays', 'Dashboard'])
        await tabs.getByRole('button', { name: 'New' }).click()
        const pane = window.getByRole('region', { name: 'New record creation' })
        await expect(pane).toBeVisible()
        await expect(pane.getByRole('button', { name: 'Opportunity', exact: true })).toBeVisible()
        await expect(pane.getByRole('button', { name: 'Multiple Opportunities' })).toBeVisible()
        await expect(pane.getByRole('button', { name: 'Milestone', exact: true })).toBeVisible()
        const tabBox = await tabs.boundingBox()
        const paneBox = await pane.boundingBox()
        expect(paneBox!.y).toBeGreaterThanOrEqual(tabBox!.y + tabBox!.height)
        await pane.getByRole('button', { name: 'Multiple Opportunities' }).click()
        await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
        await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Grid' }).click()
        const grid = pane.locator('.new-record-grid')
        await grid.getByRole('row').nth(1).getByRole('button', { name: 'Duplicate Opportunity' }).click()
        await expect(grid.locator('tbody tr')).toHaveCount(2)
        await grid.getByRole('row').nth(2).getByRole('button', { name: 'Remove Opportunity' }).click()
        await expect(grid.locator('tbody tr')).toHaveCount(1)
        await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Import CSV' }).click()
        await expect(pane.getByRole('button', { name: 'Validate & review', exact: true })).toBeDisabled()
        await window.setViewportSize({ width: 420, height: 844 })
        expect((await window.locator('main.workspace').boundingBox())!.height).toBeGreaterThan(500)
        await expect(pane).toBeVisible()
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('persists opportunity comments after Save and reopening SQLite Desktop', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-opportunity-comments-'))
    const environment = {
        ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_DATA_STORE_PATH: '',
        TLC_BACKGROUND_SYNC: '0', TLC_UI_MODE: ''
    }
    try {
        for (const save of [true, false]) {
            const app = await electron.launch({
                args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`], env: environment
            })
            try {
                const window = await app.firstWindow()
                await window.setViewportSize({ width: 1600, height: 900 })
                await window.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'Portfolio', exact: true }).click()
                await window.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
                await window.getByRole('button', { name: 'Edit Grid operations modernization' }).click()
                await window.getByRole('menuitem', { name: 'Opportunity Comments' }).click()
                const editor = window.getByLabel('Edit opportunity comments')
                const comments = editor.getByRole('textbox', { name: 'Opportunity Comments' })
                if (save) {
                    await comments.fill('Desktop comment persisted beyond the UI session.')
                    await editor.getByRole('button', { name: 'Save', exact: true }).click()
                    await expect(editor).toBeHidden()
                } else {
                    await expect(comments).toHaveValue('Desktop comment persisted beyond the UI session.')
                }
            } finally {
                await app.close()
            }
        }
    } finally {
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('creates an Opportunity and child Milestone from New in SQLite Desktop', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-create-records-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1600, height: 900 })
        await window.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
        const pane = window.getByRole('region', { name: 'New record creation' })
        await pane.getByRole('button', { name: 'Opportunity', exact: true }).click()
        await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
        await expect(pane.locator('.new-record-target strong')).toHaveText('SQLite sample store')
        await expect(pane.getByRole('button', { name: 'Validate & review' })).toBeVisible()
        await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
        await expect(pane.getByLabel('Opportunity name')).toBeFocused()
        await expect(pane.getByRole('alert').getByRole('link', { name: 'Opportunity name' })).toBeVisible()
        await pane.getByLabel('Opportunity name').fill('New grid observability opportunity')
        await pane.getByRole('listbox', { name: 'Opportunity Intent' }).selectOption('606820001')
        await pane.getByLabel('Estimated value').fill('1450000')
        await pane.getByLabel('Estimated close date').fill('2027-06-30')
        await pane.getByRole('button', { name: 'Add Milestone' }).click()
        await pane.getByLabel('Milestone name').fill('Telemetry production pilot')
        await pane.getByLabel('Milestone category').selectOption('861980000')
        await pane.getByLabel('Milestone estimated date').fill('2027-02-15')
        await pane.getByLabel('Workload').selectOption('workload-cloud-scale-analytics')

        await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
        await expect(pane.getByRole('heading', { name: 'Review record creation' })).toBeVisible()
        await expect(pane).toContainText('New grid observability opportunity')
        await expect(pane).toContainText('Telemetry production pilot')
        await expect(pane.locator('.new-record-review')).toHaveAttribute('aria-live', 'polite')
        await expect(pane.getByText('USD Standard Price List')).toBeVisible()
        await expect(pane.getByText('US Dollar (USD)')).toHaveCount(2)
        await expect(pane.getByText('2027-06-30')).toBeVisible()
        await expect(pane.getByText('Cloud Scale Analytics')).toBeVisible()
        await expect(pane.getByRole('button', { name: 'Submit to SQLite' })).toBeVisible()
        await pane.getByRole('button', { name: 'Edit' }).click()
        await expect(pane.getByRole('button', { name: 'Validate & review', exact: true })).toBeFocused()
        await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
        await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
        await expect(pane.getByRole('status')).toContainText('created in the SQLite sample store')
        await pane.getByRole('button', { name: 'View in Portfolio' }).click()
        const opportunities = window.getByRole('table', { name: 'Contoso Energy opportunities' })
        await expect(opportunities).toContainText('New grid observability opportunity')
        await expect(opportunities.getByRole('button', { name: /^New grid observability opportunity/ })).toHaveAttribute('aria-expanded', 'true')
        await expect(window.getByRole('region', { name: 'New grid observability opportunity milestones' })).toContainText('Telemetry production pilot')
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('reopens a submitted Opportunity and Milestone from the default Desktop SQLite file', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-default-sqlite-'))
    const environment = {
        ...process.env,
        TLC_DATA_MODE: 'sample',
        TLC_DATA_STORE: 'sqlite',
        TLC_DATA_STORE_PATH: '',
        TLC_UI_MODE: ''
    }
    try {
        const firstApp = await electron.launch({
            args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
            env: environment
        })
        try {
            const window = await firstApp.firstWindow()
            await window.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
            const pane = window.getByRole('region', { name: 'New record creation' })
            await pane.getByRole('button', { name: 'Opportunity', exact: true }).click()
            await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
            await expect(pane.locator('.new-record-target strong')).toHaveText('SQLite sample store')
            await pane.getByLabel('Opportunity name').fill('Reopened Desktop opportunity')
            await pane.getByRole('listbox', { name: 'Opportunity Intent' }).selectOption('606820001')
            await pane.getByLabel('Estimated value').fill('125000')
            await pane.getByLabel('Estimated close date').fill('2027-06-30')
            await pane.getByRole('button', { name: 'Add Milestone' }).click()
            await pane.getByLabel('Milestone name').fill('Reopened Desktop milestone')
            await pane.getByLabel('Milestone category').selectOption('861980000')
            await pane.getByLabel('Milestone estimated date').fill('2027-02-15')
            await pane.getByLabel('Workload').selectOption('workload-cloud-scale-analytics')
            await pane.getByRole('button', { name: 'Validate & review' }).click()
            await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
            await expect(pane.getByRole('status')).toContainText('created in the SQLite sample store')
        } finally {
            await firstApp.close()
        }
        const storePath = join(userDataDirectory, 'sample.sqlite')
        const persisted = new LocalStore({ path: storePath })
        try {
            const opportunity = persisted.get('SELECT id FROM opportunity WHERE name = ?', 'Reopened Desktop opportunity')
            expect(opportunity?.['id']).toBeTruthy()
            expect(persisted.get('SELECT opportunity_id FROM engagement_milestone WHERE name = ?', 'Reopened Desktop milestone')?.['opportunity_id'])
                .toBe(opportunity?.['id'])
            expect(Number(persisted.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total'])).toBe(1)
        } finally {
            persisted.close()
        }
        const reopenedApp = await electron.launch({
            args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
            env: environment
        })
        try {
            const window = await reopenedApp.firstWindow()
            await window.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
            const table = window.getByRole('table', { name: 'Contoso Energy opportunities' })
            await expect(table).toContainText('Reopened Desktop opportunity')
            await table.getByRole('button', { name: /^Reopened Desktop opportunity / }).click()
            await expect(window.getByRole('region', { name: 'Reopened Desktop opportunity milestones' }))
                .toContainText('Reopened Desktop milestone')
        } finally {
            await reopenedApp.close()
        }
    } finally {
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('exports a reviewed no-write draft from Desktop New', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-new-draft-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_UI_MODE: '' }
    })
    try {
        const window = await app.firstWindow()
        await window.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
        const pane = window.getByRole('region', { name: 'New record creation' })
        await pane.getByRole('button', { name: 'Opportunity', exact: true }).click()
        await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
        await pane.getByRole('combobox', { name: 'Save target' }).selectOption('draft')
        await expect(pane.locator('.new-record-target strong')).toHaveText('Draft only - MSX creation is disabled')
        await pane.getByLabel('Opportunity name').fill('Desktop draft only')
        await pane.getByRole('listbox', { name: 'Opportunity Intent' }).selectOption('606820001')
        await pane.getByLabel('Estimated value').fill('120000')
        await pane.getByLabel('Estimated close date').fill('2027-06-30')
        await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
        await expect(pane).toContainText('Draft only. No records will be written to MSX or SQLite.')
        await expect(pane.getByRole('button', { name: 'Submit to SQLite' })).toHaveCount(0)
        await pane.getByRole('button', { name: 'Export draft' }).click()
        await expect(pane.getByRole('status')).toContainText('No Opportunity or Milestone was written to MSX.')
        await expect(pane.getByRole('button', { name: 'Download creation-manifest.json' })).toBeVisible()
        await expect(pane.getByRole('button', { name: 'Download opportunities.csv' })).toBeVisible()
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('creates a Milestone under an existing Opportunity in SQLite Desktop', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-create-existing-milestone-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1600, height: 900 })
        await window.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
        const pane = window.getByRole('region', { name: 'New record creation' })
        await pane.getByRole('button', { name: 'Milestone', exact: true }).click()
        await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
        await pane.getByRole('combobox', { name: 'Parent Opportunity' }).selectOption('opp-grid-modernization')
        await pane.getByLabel('Milestone name').fill('New customer adoption milestone')
        await pane.getByLabel('Milestone category').selectOption('861980002')
        await pane.getByLabel('Milestone estimated date').fill('2027-02-15')
        await pane.getByLabel('Workload').selectOption('workload-cloud-scale-analytics')
        await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
        await expect(pane).toContainText('1 planned mutation')
        await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
        await expect(pane.getByRole('status')).toContainText('created in the SQLite sample store')
        await expect(pane).toContainText('0 Opportunities, 1 Milestones')
        await pane.getByRole('button', { name: 'View in Portfolio' }).click()
        await expect(window.getByRole('region', { name: 'Grid operations modernization milestones' })).toContainText('New customer adoption milestone')
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('imports a Milestone CSV and submits under the selected parent in Desktop', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-milestone-csv-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_UI_MODE: '' }
    })
    try {
        const window = await app.firstWindow()
        await window.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
        const pane = window.getByRole('region', { name: 'New record creation' })
        await pane.getByRole('button', { name: 'Milestone', exact: true }).click()
        await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
        await pane.getByRole('combobox', { name: 'Parent Opportunity' }).selectOption('opp-grid-modernization')
        await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Import CSV' }).click()
        await expect(pane.getByText('All rows use the selected parent.', { exact: false })).toBeVisible()
        const csv = await readFile(resolve('tests', 'fixtures', 'record-creation', 'single-opportunity-multiple-milestones', 'milestones.csv'), 'utf8')
        const withoutParent = csv.split(/\r?\n/).map((line) => line.replace(/^([^,]*),[^,]*,/, '$1,')).join('\n')
        await pane.locator('.new-record-import input[type="file"]').setInputFiles({
            name: 'existing-parent-milestones.csv', mimeType: 'text/csv', buffer: Buffer.from(withoutParent)
        })
        await pane.getByRole('button', { name: 'Validate & load CSV' }).click()
        await expect(pane.getByLabel('Milestone name')).toHaveCount(3)
        await pane.getByRole('button', { name: 'Validate & review' }).click()
        await expect(pane).toContainText('3 planned mutations')
        await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
        await expect(pane).toContainText('0 Opportunities, 3 Milestones')
        await pane.getByRole('button', { name: 'View in Portfolio' }).click()
        const milestones = window.getByRole('region', { name: 'Grid operations modernization milestones' })
        await expect(milestones).toContainText('Grid telemetry pilot')
        await expect(milestones).toContainText('Production telemetry rollout')
        await expect(milestones).toContainText('Telemetry cost optimization')
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('creates two existing-parent Milestones after editing Form and Grid in Desktop', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-milestone-grid-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_UI_MODE: '' }
    })
    try {
        const window = await app.firstWindow()
        await window.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
        const pane = window.getByRole('region', { name: 'New record creation' })
        await pane.getByRole('button', { name: 'Milestone', exact: true }).click()
        await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
        await pane.getByRole('combobox', { name: 'Parent Opportunity' }).selectOption('opp-grid-modernization')
        await pane.getByLabel('Milestone name').fill('Desktop Grid pilot')
        await pane.getByLabel('Milestone category').selectOption('861980000')
        await pane.getByLabel('Milestone estimated date').fill('2027-02-15')
        await pane.getByLabel('Workload').selectOption('workload-cloud-scale-analytics')
        await pane.getByLabel('Milestone comments').fill('Retain optional details across Grid.')
        await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Grid' }).click()
        const grid = pane.getByRole('table', { name: 'Milestone entry grid' })
        await expect(grid.locator('tbody tr')).toHaveCount(1)
        await pane.getByRole('button', { name: 'Add Milestone' }).click()
        const second = grid.getByRole('row').nth(2)
        await second.getByLabel('Milestone name').fill('Desktop production milestone')
        await second.getByLabel('Milestone category').selectOption('861980002')
        await second.getByLabel('Milestone estimated date').fill('2027-04-15')
        await second.getByLabel('Workload').selectOption('workload-cloud-scale-analytics')
        await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Form' }).click()
        await expect(pane.getByLabel('Milestone comments').first()).toHaveValue('Retain optional details across Grid.')
        await expect(pane.getByLabel('Milestone name').nth(1)).toHaveValue('Desktop production milestone')
        await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
        await expect(pane).toContainText('2 planned mutations')
        await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
        await expect(pane).toContainText('0 Opportunities, 2 Milestones')
        await pane.getByRole('button', { name: 'View in Portfolio' }).click()
        const milestones = window.getByRole('region', { name: 'Grid operations modernization milestones' })
        await expect(milestones).toContainText('Desktop Grid pilot')
        await expect(milestones).toContainText('Desktop production milestone')
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('reviews the parent Opportunity currency for an existing Milestone in Desktop', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-parent-currency-'))
    const storePath = join(userDataDirectory, 'portfolio.sqlite')
    const seeded = new LocalStore({ path: storePath })
    try {
        seeded.run('INSERT INTO transaction_currency (id, name, iso_code) VALUES (?, ?, ?)', 'currency-eur', 'Euro', 'EUR')
        seeded.run('UPDATE opportunity SET currency = ?, transaction_currency_id = ? WHERE id = ?',
            'EUR', 'currency-eur', 'opp-grid-modernization')
    } finally {
        seeded.close()
    }
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: {
            ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_DATA_STORE_PATH: storePath, TLC_UI_MODE: ''
        }
    })
    try {
        const window = await app.firstWindow()
        await window.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
        const pane = window.getByRole('region', { name: 'New record creation' })
        await pane.getByRole('button', { name: 'Milestone', exact: true }).click()
        await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
        await pane.getByRole('combobox', { name: 'Parent Opportunity' }).selectOption('opp-grid-modernization')
        await pane.getByLabel('Milestone name').fill('Euro desktop pilot')
        await pane.getByLabel('Milestone category').selectOption('861980000')
        await pane.getByLabel('Milestone estimated date').fill('2027-02-15')
        await pane.getByLabel('Workload').selectOption('workload-cloud-scale-analytics')
        await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
        await expect(pane.getByRole('region', { name: 'Milestone Euro desktop pilot' }).getByText('Euro (EUR)')).toBeVisible()
        await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
        await expect(pane.getByRole('status')).toContainText('created in the SQLite sample store')
        const during = new LocalStore({ path: storePath })
        try {
            expect(during.get('SELECT transaction_currency_id FROM engagement_milestone WHERE name = ?', 'Euro desktop pilot')?.['transaction_currency_id'])
                .toBe('currency-eur')
        } finally {
            during.close()
        }
    } finally {
        await app.close()
        const verified = new LocalStore({ path: storePath })
        try {
            expect(verified.get('SELECT transaction_currency_id FROM engagement_milestone WHERE name = ?', 'Euro desktop pilot')?.['transaction_currency_id'])
                .toBe('currency-eur')
        } finally {
            verified.close()
            await rm(userDataDirectory, { recursive: true, force: true })
        }
    }
})

test('shows all eight sample customers with opportunity, milestone, and evidence data in Desktop', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-sample-portfolio-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1600, height: 900 })
        await expectCompleteSamplePortfolio(window)
    } finally {
        await app.close().catch(() => undefined)
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('removes the current user from opportunity and milestone teams in Desktop', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-membership-removal-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1600, height: 900 })
        await expectOpportunityAndMilestoneRemoval(window)
    } finally {
        await app.close().catch(() => undefined)
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('expands Opportunities while preserving collapsed pane controls in Desktop', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-opportunities-layout-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await expectOpportunitiesToFillCollapsedWorkspace(window)
    } finally {
        await app.close().catch(() => undefined)
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('curates customer accounts through the Desktop IPC bridge', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-curation-test-'))
    test.slow()
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.getByRole('button', { name: 'Add customer' }).click()
        const dialog = window.getByRole('dialog', { name: 'Add customer account' })
        await dialog.getByRole('button', { name: 'TPID' }).click()
        await dialog.getByRole('textbox', { name: 'TPID' }).fill('1000003')
        await dialog.getByRole('button', { name: 'Search' }).click()
        await dialog.getByRole('button', { name: 'Add account' }).click()

        await window.locator('.discover-launcher .scope-switcher button').filter({ hasText: /^Data$/ }).click()
        const discoveryRow = window.locator('.discover-table tbody tr').filter({ hasText: 'Clinical data platform modernization' })
        await discoveryRow.locator('button').filter({ hasText: 'Add me' }).click()
        await expect(discoveryRow).toContainText('On deal team')

        await window.locator('.rail-button[title="Accounts"]').click()
        await window.locator('.account-button').filter({ hasText: 'Northwind Health' }).click()
        await expect(window.locator('.opportunity-table-wrap .record-table')).toContainText('Clinical data platform modernization')

        await window.locator('.account-row').filter({ hasText: 'Northwind Health' }).getByRole('button', { name: 'Remove this customer', exact: true }).click()
        await window.getByRole('dialog', { name: 'Remove customer account' }).getByRole('button', { name: 'Remove customer', exact: true }).click()
        await expect(window.locator('.account-row').filter({ hasText: 'Northwind Health' })).toHaveCount(0)
        await window.getByRole('button', { name: 'Add customer', exact: true }).click()
        await dialog.getByRole('textbox', { name: 'Account name', exact: true }).fill('Northwind')
        await dialog.getByRole('button', { name: 'Search', exact: true }).click()
        await dialog.getByRole('button', { name: 'Add again', exact: true }).click()
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('opens the default desktop blade workspace through the existing IPC bridge', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-revamp-test-'))
    test.slow()
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })
    let exitedFromUi = false
    const completedRun = {
        ...workflowRun('WF-001', 'completed', 'complete'),
        connectorCalls: [{ connector: 'dataverse-mcp' as const, operation: 'read_query', status: 'success' as const, durationMs: 840, recordCount: 1, truncated: false }],
        telemetry: { correlationId: '22222222-2222-4222-8222-222222222222', firstResultMs: 620, cacheHit: false }
    }

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1400, height: 768 })
        const pageErrors: Error[] = []
        window.on('pageerror', (error) => pageErrors.push(error))
        await app.evaluate(({ ipcMain }, fixtures) => {
            const { definitions, historicalRun, output } = fixtures
            ipcMain.removeHandler('tlc:get-data-status')
            ipcMain.removeHandler('tlc:get-inference-mode')
            ipcMain.handle('tlc:get-inference-mode', () => null)
            ipcMain.handle('tlc:get-data-status', () => ({
                mode: 'live',
                auth: {
                    state: 'ready',
                    displayName: 'signed-in-user@microsoft.com',
                    userEmail: 'signed-in-user@microsoft.com',
                    detail: 'Authenticated test identity.'
                }
            }))
            let workflowId = 'WF-001'
            const run = (status: 'running' | 'completed' | 'cancelled') => ({
                contractVersion: '1.0',
                runId: '11111111-1111-4111-8111-111111111111',
                workflowId,
                status,
                ...(status === 'completed' ? { state: 'complete', resultRef: `result:${workflowId}` } : {}),
                scope: { kind: 'portfolio' },
                startedAt: '2026-09-12T10:00:00.000Z',
                ...(status !== 'running' ? { completedAt: '2026-09-12T10:00:01.000Z' } : {}),
                connectorCalls: [],
                telemetry: { correlationId: '22222222-2222-4222-8222-222222222222', cacheHit: false }
            })
            for (const channel of ['tlc:workflow-list', 'tlc:workflow-start', 'tlc:workflow-get', 'tlc:workflow-cancel', 'tlc:workflow-history']) ipcMain.removeHandler(channel)
            ipcMain.handle('tlc:workflow-list', (_event, request: { scope?: string }) => request.scope === 'portfolio' ? definitions : [])
            ipcMain.handle('tlc:workflow-history', () => [historicalRun])
            ipcMain.handle('tlc:workflow-start', (_event, request: { workflowId: string }) => { workflowId = request.workflowId; return run('running') })
            ipcMain.handle('tlc:workflow-get', (_event, request: { runId: string }) => request.runId === historicalRun.runId ? { run: historicalRun, output } : { run: run('completed') })
            ipcMain.handle('tlc:workflow-cancel', () => run('cancelled'))
        }, { definitions: workflowDefinitions, historicalRun: completedRun, output: workflowOutput() })

        await expect(window).toHaveTitle('TLC Account Team Intelligence | Desktop')
        await expect(window.getByText('DESKTOP · CONNECTED DATA')).toBeVisible()
        await expect(window.getByRole('region', { name: 'Accounts blade' })).toBeVisible()
        await expect(window.getByRole('heading', { name: 'Select a customer account' })).toBeVisible()

        await window.getByRole('button', { name: 'Workflows' }).click()
        const launcher = window.getByRole('region', { name: 'Workflow Launcher' })
        await expect(launcher.locator('.workflow-card')).toHaveCount(4)
        const stalePlayInfo = launcher.getByRole('button', { name: 'What does "Stale opportunity sweep" do?' })
        await stalePlayInfo.hover()
        await expect(window.getByRole('tooltip')).toContainText('Finds opportunities whose close date has already slipped past')
        await expect(window.getByRole('tooltip')).toContainText('Use it to:')
        await launcher.locator('.workflow-card').filter({ hasText: 'Stale opportunity sweep' }).getByRole('button', { name: 'Run workflow' }).click()
        await expect(launcher.getByRole('table', { name: 'Stale opportunities' })).toContainText('Northwind renewal')
        await expect(launcher.getByRole('region', { name: 'Operational queue' })).toContainText('Review Northwind renewal')
        await launcher.getByRole('button', { name: 'Activity details' }).click()
        await expect(window.getByRole('dialog', { name: 'Workflow activity' })).toContainText('840 ms')
        await window.getByRole('button', { name: 'Close' }).click()
        await launcher.getByLabel('Filter workflows by persona').selectOption('Manager')
        await expect(launcher.locator('.workflow-card')).toHaveCount(3)
        await launcher.locator('.workflow-card').filter({ hasText: 'Stale opportunity sweep' }).getByRole('button', { name: 'Run workflow' }).click()
        await expect(launcher.getByRole('status')).toContainText('Workflow completed with all required sources.')
        await window.getByRole('button', { name: 'Home' }).click()
        await expect(window.getByRole('region', { name: 'Accounts blade' })).toBeVisible()

        await window.getByRole('button', { name: /Contoso Energy/ }).first().click()
        await expect(window.getByRole('region', { name: 'Opportunities blade' })).toBeVisible()
        await expect(window.getByRole('region', { name: 'Opportunity workbench' }).getByRole('heading', { name: 'Contoso Energy' })).toBeVisible()
        const opportunitiesBlade = window.getByRole('region', { name: 'Opportunities blade' })
        const opportunity = opportunitiesBlade.getByRole('button', { name: /^Grid operations modernization / })
        const opportunityRow = opportunitiesBlade.getByRole('row').filter({ hasText: 'Grid operations modernization' })
        await expect(opportunityRow.getByRole('cell').nth(0)).toContainText('Avery Johnson')
        await expect(opportunityRow.getByRole('cell').nth(1)).toHaveText('Consumption')
        await expect(opportunityRow.getByRole('cell').nth(2)).toHaveText('Stage 3')
        await expect(opportunityRow.getByRole('cell').nth(3)).toHaveText('$4.2M')
        await expect(opportunityRow.getByRole('cell').nth(4)).toHaveText('2026-10-30')
        await opportunity.hover()
        await expect(window.getByRole('tooltip')).toContainText('Opportunity owner: Avery Johnson')
        await expect(window.getByRole('tooltip')).toContainText('Opportunity intent: Consumption')
        await expect(window.getByRole('tooltip')).toContainText('Stage owner: Solution Engineer')
        await expect(window.getByRole('tooltip')).toContainText('Value: $4.2M')

        await opportunity.click()
        await expect(window.getByRole('region', { name: 'Milestones blade' })).toHaveCount(0)
        await expect(opportunity).toHaveAttribute('aria-expanded', 'true')
        const opportunityMilestones = window.getByRole('region', { name: 'Grid operations modernization milestones' })
        await expect(opportunityMilestones).toContainText('Customer outcome validation')
        await expect(opportunityMilestones).toBeInViewport()
        const workbench = window.getByRole('region', { name: 'Opportunity workbench' })
        await expect(workbench).toContainText('Avery Johnson · Stage 3 · $4.2M · closes 2026-10-30')
        await expect(workbench).toContainText('Evidence supports')
        await expect(window.getByRole('complementary', { name: 'Next best actions blade' })).toBeVisible()
        await expect(window.getByRole('tab', { name: 'MSX' })).toHaveAttribute('aria-selected', 'true')

        await window.getByRole('tab', { name: 'MCEM Stage Management' }).click()
        const stageBoardViewport = window.locator('.mcem-board-view')
        const horizontalScrollbar = window.getByRole('slider', { name: 'Scroll MCEM stages horizontally' })
        const verticalScrollbar = window.getByRole('slider', { name: 'Scroll MCEM stages vertically' })
        await expect(stageBoardViewport).toBeVisible()
        await expect.poll(() => stageBoardViewport.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
        await expect(horizontalScrollbar).toBeVisible()
        await expect(verticalScrollbar).toBeVisible()
        const [workbenchBox, viewportBox, horizontalBox, verticalBox] = await Promise.all([
            workbench.boundingBox(),
            stageBoardViewport.boundingBox(),
            horizontalScrollbar.boundingBox(),
            verticalScrollbar.boundingBox()
        ])
        expect(workbenchBox).not.toBeNull()
        expect(viewportBox).not.toBeNull()
        expect(horizontalBox).not.toBeNull()
        expect(verticalBox).not.toBeNull()
        expect(horizontalBox!.y + horizontalBox!.height).toBeLessThanOrEqual(workbenchBox!.y + workbenchBox!.height)
        expect(verticalBox!.x + verticalBox!.width).toBeLessThanOrEqual(workbenchBox!.x + workbenchBox!.width)
        await expect.poll(() => horizontalScrollbar.evaluate((element) => Number((element as HTMLInputElement).max))).toBeGreaterThan(0)
        await expect(horizontalScrollbar).toBeEnabled()
        await horizontalScrollbar.focus()
        await horizontalScrollbar.press('End')
        await expect.poll(() => stageBoardViewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
        await expect(window.getByLabel('Stage 5: Manage & Optimize')).toBeVisible()
        await stageBoardViewport.locator('.mcem-board').evaluate((element, viewportHeight) => {
            ; (element as HTMLElement).style.minHeight = `${viewportHeight + 400}px`
        }, viewportBox!.height)
        await expect.poll(() => stageBoardViewport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
        await expect.poll(() => verticalScrollbar.evaluate((element) => Number((element as HTMLInputElement).max))).toBeGreaterThan(0)
        await expect(verticalScrollbar).toBeEnabled()
        await verticalScrollbar.focus()
        await verticalScrollbar.press('End')
        await expect.poll(() => stageBoardViewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
        await window.getByRole('tab', { name: 'MSX' }).click()

        await window.getByRole('button', { name: 'Collapse Accounts blade header' }).click()
        await expect(window.getByRole('button', { name: 'Expand Accounts', exact: true })).toBeVisible()
        await window.getByRole('button', { name: 'Refresh Milestones' }).click()
        await expect(opportunityMilestones).toContainText('Customer outcome validation')
        await window.getByRole('tab', { name: 'Multi-Agent Guidance' }).click()
        await expect(window.getByRole('tab', { name: 'Account Pulse' })).toHaveAttribute('aria-selected', 'true')
        const agentDescriptions = {
            'Account Pulse': 'Summarizes account health, priorities, activity, and the actions that need attention.',
            'MCEM Coach': 'Evaluates MCEM stage evidence, exit criteria, ownership gaps, and the next best action.',
            'Pursuit': 'Builds an opportunity pursuit view covering stakeholders, value, competition, and deal progression.',
            'Risk & Play': 'Surfaces delivery and deal risks, then recommends the most relevant solution play and mitigations.'
        }
        for (const [agent, description] of Object.entries(agentDescriptions)) {
            const info = window.getByRole('button', { name: `About ${agent}` })
            await info.hover()
            await expect(window.getByRole('tooltip')).toHaveText(description)
        }
        await expect(window.locator('.agent-response')).toHaveCount(0)
        await window.getByRole('button', { name: 'What should the account team focus on this week?' }).click()
        await expect(window.locator('.agent-response')).toContainText('Grid operations modernization')
        await expect(window.getByRole('button', { name: 'Send Email' })).toBeVisible()
        await window.getByRole('button', { name: 'Send Email' }).click()
        const recipients = window.getByRole('textbox', { name: 'Email recipients' })
        await expect(recipients).toHaveValue('signed-in-user@microsoft.com')
        await recipients.fill('reviewer@example.com')
        await expect(recipients).toHaveValue('reviewer@example.com')
        await window.getByRole('button', { name: 'Cancel' }).click()
        await expect(window.getByRole('button', { name: 'Export' })).toBeVisible()
        await window.getByRole('button', { name: 'Close Next best actions' }).click()
        await expect(window.getByRole('complementary', { name: 'Next best actions blade' })).toHaveCount(0)
        await expect(window.getByRole('region', { name: 'Opportunities blade' })).toBeVisible()
        expect(pageErrors).toEqual([])
        const exitCompleted = app.waitForEvent('close')
        await Promise.all([
            exitCompleted,
            window.getByRole('button', { name: 'Exit application' }).click().catch(() => undefined)
        ])
        exitedFromUi = true
    } finally {
        if (!exitedFromUi) await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})