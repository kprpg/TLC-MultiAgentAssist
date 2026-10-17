import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { createSampleAuthentication } from '../../../apps/web/src/authentication.js'
import { buildStaticHandler, setSecurityHeaders } from '../../../apps/web/src/hosting.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { RecordCreationService } from '../../../packages/orchestrator/record-creation/service.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'

let server: Server | undefined
let store: LocalStore | undefined

test.afterEach(async () => {
    if (server) await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()))
    server = undefined
    store?.close()
    store = undefined
})

async function hostedWeb(path?: string): Promise<string> {
    store = new LocalStore(path ? { path } : {})
    const msx = new LocalStoreMsxConnector(store)
    const writer = msx.createRecordCreationWriter()
    const runtime: WebRuntime = Object.assign(
        new ThinSliceOrchestrator(
            msx,
            new LocalPdfMcemGuidanceConnector(resolve('docs', 'knowledge', 'MCEM Overview.pdf')),
            {},
            undefined,
            new RecordCreationService(msx, writer, { writer })
        ),
        {
            listMeetingTranscripts: async () => [],
            getMeetingTranscript: async () => null,
            proposeMeetingChangeSet: async () => { throw new Error('Meeting capture is outside this creation test.') },
            applyMeetingChangeSet: async () => { throw new Error('Meeting capture is outside this creation test.') }
        }
    )
    const api = buildWebApiHandler({ createRuntime: () => runtime, authenticate: createSampleAuthentication() })
    const staticHandler = buildStaticHandler(resolve('apps', 'desktop', 'dist', 'revamp'), 'sample')
    server = createServer((request, response) => {
        setSecurityHeaders(response)
        void (async () => {
            if (!(await api(request, response))) await staticHandler(request, response)
        })().catch((error: unknown) => {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : 'Test host failed.')
        })
    })
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Hosted Web test server did not start.')
    return `http://127.0.0.1:${address.port}`
}

test('creates an Opportunity and Milestone in the hosted Web New pane', async ({ page }) => {
    const base = await hostedWeb()
    await page.goto(base)
    const tabs = page.getByRole('navigation', { name: 'Primary tabs' })
    await expect(tabs.getByRole('button')).toHaveText(['New', 'Discover', 'Portfolio', 'Plays', 'Dashboard'])
    await tabs.getByRole('button', { name: 'New' }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Opportunity', exact: true }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
    await expect(pane.locator('.new-record-target strong')).toHaveText('SQLite sample store')
    await expect(pane.getByRole('button', { name: 'Validate & review' })).toBeVisible()
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane.getByLabel('Opportunity name')).toBeFocused()
    await expect(pane.getByRole('alert').getByRole('link', { name: 'Opportunity name' })).toBeVisible()
    await pane.getByLabel('Opportunity name').fill('Hosted Web grid opportunity')
    await pane.getByRole('listbox', { name: 'Opportunity Intent' }).selectOption('606820001')
    await pane.getByLabel('Estimated value').fill('550000')
    await pane.getByLabel('Estimated close date').fill('2027-06-30')
    await pane.getByRole('button', { name: 'Add Milestone' }).click()
    await pane.getByLabel('Milestone name').fill('Hosted Web pilot')
    await pane.getByLabel('Milestone category').selectOption('861980000')
    await pane.getByLabel('Milestone estimated date').fill('2027-02-15')
    await pane.getByLabel('Workload').selectOption('workload-cloud-scale-analytics')
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane.getByRole('heading', { name: 'Review record creation' })).toBeVisible()
    await expect(pane.locator('.new-record-review')).toHaveAttribute('aria-live', 'polite')
    await expect(pane.getByText('USD Standard Price List')).toBeVisible()
    await expect(pane.getByText('US Dollar (USD)')).toHaveCount(2)
    await expect(pane.getByText('2027-02-15')).toBeVisible()
    await expect(pane.getByText('Cloud Scale Analytics')).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Submit to SQLite' })).toBeVisible()
    await pane.getByRole('button', { name: 'Edit' }).click()
    await expect(pane.getByRole('button', { name: 'Validate & review', exact: true })).toBeFocused()
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
    await expect(pane.getByRole('status')).toContainText('created in the SQLite sample store')
    await pane.getByRole('button', { name: 'View in Portfolio' }).click()
    await expect(page.getByRole('table', { name: 'Contoso Energy opportunities' })).toContainText('Hosted Web grid opportunity')
    await expect(page.getByRole('region', { name: 'Hosted Web grid opportunity milestones' })).toContainText('Hosted Web pilot')
})

test('reviews and inherits a non-default existing Opportunity currency in hosted Web', async ({ page }) => {
    const base = await hostedWeb()
    store!.run('INSERT INTO transaction_currency (id, name, iso_code) VALUES (?, ?, ?)', 'currency-eur', 'Euro', 'EUR')
    store!.run('UPDATE opportunity SET currency = ?, transaction_currency_id = ? WHERE id = ?',
        'EUR', 'currency-eur', 'opp-grid-modernization')
    await page.goto(base)
    await page.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Milestone', exact: true }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
    await pane.getByRole('combobox', { name: 'Parent Opportunity' }).selectOption('opp-grid-modernization')
    await pane.getByLabel('Milestone name').fill('Euro production pilot')
    await pane.getByLabel('Milestone category').selectOption('861980000')
    await pane.getByLabel('Milestone estimated date').fill('2027-02-15')
    await pane.getByLabel('Workload').selectOption('workload-cloud-scale-analytics')
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane.getByRole('region', { name: 'Milestone Euro production pilot' }).getByText('Euro (EUR)')).toBeVisible()
    await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
    await expect(pane.getByRole('status')).toContainText('created in the SQLite sample store')
    expect(store!.get('SELECT transaction_currency_id FROM engagement_milestone WHERE name = ?', 'Euro production pilot')?.['transaction_currency_id'])
        .toBe('currency-eur')
})

test('exports a reviewed draft through hosted Web without a SQLite write', async ({ page }) => {
    const base = await hostedWeb()
    const before = store!.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']
    await page.goto(base)
    await page.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Opportunity', exact: true }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
    await pane.getByRole('combobox', { name: 'Save target' }).selectOption('draft')
    await expect(pane.locator('.new-record-target strong')).toHaveText('Draft only - MSX creation is disabled')
    await pane.getByLabel('Opportunity name').fill('Hosted Web draft only')
    await pane.getByRole('listbox', { name: 'Opportunity Intent' }).selectOption('606820001')
    await pane.getByLabel('Estimated value').fill('120000')
    await pane.getByLabel('Estimated close date').fill('2027-06-30')
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane.getByRole('button', { name: 'Submit to SQLite' })).toHaveCount(0)
    await pane.getByRole('button', { name: 'Export draft' }).click()
    await expect(pane.getByRole('status')).toContainText('No Opportunity or Milestone was written to MSX.')
    await expect(pane.getByRole('button', { name: 'Download creation-review.md' })).toBeVisible()
    expect(store!.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(before)
})

test('submits a validated form to a file-backed SQLite store that survives reopening', async ({ page }) => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-web-create-file-'))
    const path = join(directory, 'sample.sqlite')
    let reopened: LocalStore | undefined
    try {
        const base = await hostedWeb(path)
        await page.goto(base)
        await page.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
        const pane = page.getByRole('region', { name: 'New record creation' })
        await pane.getByRole('button', { name: 'Opportunity', exact: true }).click()
        await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
        await pane.getByLabel('Opportunity name').fill('File-backed Web opportunity')
        await pane.getByRole('listbox', { name: 'Opportunity Intent' }).selectOption('606820001')
        await pane.getByLabel('Estimated value').fill('120000')
        await pane.getByLabel('Estimated close date').fill('2027-06-30')
        await pane.getByRole('button', { name: 'Add Milestone' }).click()
        await pane.getByLabel('Milestone name').fill('File-backed Web milestone')
        await pane.getByLabel('Milestone category').selectOption('861980000')
        await pane.getByLabel('Milestone estimated date').fill('2027-02-15')
        await pane.getByLabel('Workload').selectOption('workload-cloud-scale-analytics')
        await pane.getByRole('button', { name: 'Validate & review' }).click()
        expect(store!.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(0)
        await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
        await expect(pane.getByRole('status')).toContainText('created in the SQLite sample store')
        store!.close()
        store = undefined
        reopened = new LocalStore({ path })
        expect(reopened.get('SELECT account_id FROM opportunity WHERE name = ?', 'File-backed Web opportunity')?.['account_id'])
            .toBe('account-contoso')
        expect(reopened.get(
            'SELECT o.name AS parent FROM engagement_milestone m JOIN opportunity o ON o.id = m.opportunity_id WHERE m.name = ?',
            'File-backed Web milestone'
        )?.['parent']).toBe('File-backed Web opportunity')
        expect(reopened.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(1)
    } finally {
        reopened?.close()
        store?.close()
        store = undefined
        await rm(directory, { recursive: true, force: true })
    }
})

test('creates an existing-parent Milestone batch from the hosted Web grid', async ({ page }) => {
    const base = await hostedWeb()
    await page.goto(base)
    await page.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Milestone', exact: true }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
    await pane.getByRole('combobox', { name: 'Parent Opportunity' }).selectOption('opp-grid-modernization')
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Grid' }).click()
    const grid = pane.getByRole('table', { name: 'Milestone entry grid' })
    await grid.getByRole('row').nth(1).getByLabel('Milestone name').fill('Web grid pilot')
    await grid.getByRole('row').nth(1).getByLabel('Milestone category').selectOption('861980000')
    await grid.getByRole('row').nth(1).getByLabel('Milestone estimated date').fill('2027-02-15')
    await grid.getByRole('row').nth(1).getByLabel('Workload').selectOption('workload-cloud-scale-analytics')
    await pane.getByRole('button', { name: 'Add Milestone' }).click()
    await grid.getByRole('row').nth(2).getByLabel('Milestone name').fill('Web grid rollout')
    await grid.getByRole('row').nth(2).getByLabel('Milestone category').selectOption('861980002')
    await grid.getByRole('row').nth(2).getByLabel('Milestone estimated date').fill('2027-04-15')
    await grid.getByRole('row').nth(2).getByLabel('Workload').selectOption('workload-cloud-scale-analytics')
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane).toContainText('2 planned mutations')
    await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
    await expect(pane).toContainText('0 Opportunities, 2 Milestones')
    expect(Number(store!.get('SELECT COUNT(*) AS total FROM engagement_milestone WHERE name IN (?, ?)',
        'Web grid pilot', 'Web grid rollout')?.['total'])).toBe(2)
})

test('imports a Milestone CSV without writing until submission in hosted Web', async ({ page }) => {
    const base = await hostedWeb()
    await page.goto(base)
    await page.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Milestone', exact: true }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
    await pane.getByRole('combobox', { name: 'Parent Opportunity' }).selectOption('opp-grid-modernization')
    const before = Number(store!.get('SELECT COUNT(*) AS total FROM engagement_milestone WHERE opportunity_id = ?', 'opp-grid-modernization')?.['total'])
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Import CSV' }).click()
    await expect(pane.getByText('All rows use the selected parent.', { exact: false })).toBeVisible()
    const csv = await readFile(resolve('tests', 'fixtures', 'record-creation', 'single-opportunity-multiple-milestones', 'milestones.csv'), 'utf8')
    const withoutParent = csv.split(/\r?\n/).map((line) => line.replace(/^([^,]*),[^,]*,/, '$1,')).join('\n')
    await pane.locator('.new-record-import input[type="file"]').setInputFiles({
        name: 'existing-parent-milestones.csv', mimeType: 'text/csv', buffer: Buffer.from(withoutParent)
    })
    await pane.getByRole('button', { name: 'Validate & load CSV' }).click()
    await expect(pane.getByLabel('Milestone name')).toHaveCount(3)
    expect(Number(store!.get('SELECT COUNT(*) AS total FROM engagement_milestone WHERE opportunity_id = ?', 'opp-grid-modernization')?.['total'])).toBe(before)
    await pane.getByRole('button', { name: 'Validate & review' }).click()
    await expect(pane).toContainText('3 planned mutations')
    expect(Number(store!.get('SELECT COUNT(*) AS total FROM engagement_milestone WHERE opportunity_id = ?', 'opp-grid-modernization')?.['total'])).toBe(before)
    await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
    await expect(pane).toContainText('0 Opportunities, 3 Milestones')
    expect(Number(store!.get('SELECT COUNT(*) AS total FROM engagement_milestone WHERE opportunity_id = ?', 'opp-grid-modernization')?.['total'])).toBe(before + 3)
})

test('imports and atomically creates three Opportunities with six Milestones in hosted Web', async ({ page }) => {
    const base = await hostedWeb()
    await page.goto(base)
    await page.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'New' }).click()
    const pane = page.getByRole('region', { name: 'New record creation' })
    await pane.getByRole('button', { name: 'Multiple Opportunities' }).click()
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-fabrikam')
    await expect(pane.locator('.new-record-target strong')).toHaveText('SQLite sample store')
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Import CSV' }).click()
    await expect(pane.getByRole('button', { name: 'Validate & review', exact: true })).toBeDisabled()
    await expect(pane.getByText('Import validates and loads rows for review; it does not save to SQLite.', { exact: false })).toBeVisible()
    const beforeImport = store!.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']
    const folder = resolve('tests', 'fixtures', 'record-creation', 'multiple-opportunities-multiple-milestones')
    await pane.locator('input[type="file"]').nth(0).setInputFiles(resolve(folder, 'opportunities.csv'))
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-contoso')
    await expect(pane.locator('input[type="file"]').nth(0)).toHaveValue('')
    await pane.getByRole('combobox', { name: 'Account' }).selectOption('account-fabrikam')
    await pane.locator('input[type="file"]').nth(0).setInputFiles(resolve(folder, 'opportunities.csv'))
    await pane.locator('input[type="file"]').nth(1).setInputFiles(resolve(folder, 'milestones.csv'))
    await pane.locator('.new-record-import button').click()
    await expect(pane.locator('.new-record-grid tbody tr')).toHaveCount(3)
    expect(store!.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(beforeImport)
    await expect(pane.getByRole('button', { name: 'Validate & review', exact: true })).toBeEnabled()
    const grid = pane.locator('.new-record-grid')
    await grid.getByRole('row').nth(1).getByRole('button', { name: 'Duplicate Opportunity' }).click()
    await expect(grid.locator('tbody tr')).toHaveCount(4)
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Form' }).click()
    await expect(pane.locator('.new-record-content > fieldset.new-record-row').nth(1).getByLabel('Milestone name')).toHaveCount(2)
    await pane.getByRole('group', { name: 'Entry mode' }).getByRole('button', { name: 'Grid' }).click()
    await grid.getByRole('row').nth(2).getByRole('button', { name: 'Remove Opportunity' }).click()
    await expect(grid.locator('tbody tr')).toHaveCount(3)
    await pane.getByRole('button', { name: 'Validate & review', exact: true }).click()
    await expect(pane.getByRole('heading', { name: 'Review record creation' })).toBeVisible()
    await expect(pane).toContainText('12 planned mutations')
    expect(store!.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total']).toBe(beforeImport)
    await pane.getByRole('button', { name: 'Submit to SQLite' }).click()
    await expect(pane.getByRole('status')).toContainText('created in the SQLite sample store')
    expect(Number(store!.get('SELECT COUNT(*) AS total FROM creation_batch')?.['total'])).toBe(Number(beforeImport) + 1)
    await expect(pane).toContainText('3 Opportunities, 6 Milestones')

    const opportunitiesResponse = await fetch(`${base}/api/accounts/account-fabrikam/opportunities`)
    expect(opportunitiesResponse.ok).toBe(true)
    const opportunities = await opportunitiesResponse.json() as Array<{ id: string; name: string }>
    for (const name of ['AI-assisted retail service', 'Unified commerce modernization', 'Retail cloud security modernization']) {
        const created = opportunities.find((item) => item.name === name)
        expect(created).toBeDefined()
        const milestonesResponse = await fetch(`${base}/api/opportunities/${encodeURIComponent(created!.id)}/milestones`)
        expect(milestonesResponse.ok).toBe(true)
        expect(await milestonesResponse.json()).toHaveLength(2)
    }
})
