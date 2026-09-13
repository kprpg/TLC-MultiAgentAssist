import { expect, test } from '@playwright/test'
import { workflowDefinitions, workflowGuidanceDefinition, workflowGuidanceOutput, workflowOutput, workflowRun } from './workflow-fixtures.js'

test('sends an opportunity-scoped workflow exception to existing guidance', async ({ page }) => {
    const completedRun = workflowRun('WF-003', 'completed', 'complete')
    const prompt = 'Review WF-003 result using Evidence IDs: tool-call-1. Cite only these IDs.'
    await page.route('**/api/workflows/*', async (route) => {
        const operation = new URL(route.request().url()).pathname.split('/').at(-1)
        if (operation === 'list') await route.fulfill({ json: [workflowGuidanceDefinition] })
        else if (operation === 'history') await route.fulfill({ json: [completedRun] })
        else if (operation === 'guidance') await route.fulfill({ json: {
            contractVersion: '1.0', workflowId: 'WF-003', resultRef: 'result:WF-003', capability: 'mcem-coach',
            scope: { kind: 'opportunity', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization' },
            prompt,
            context: { cardTitle: 'Stage mismatches', queueItemId: 'queue-stage-1', queueItemTitle: 'Resolve Grid operations modernization stage mismatch', facts: [{ label: 'Priority', value: 'P0' }], evidenceIds: ['tool-call-1'] }
        } })
        else await route.fulfill({ json: { run: completedRun, output: workflowGuidanceOutput() } })
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Workflows' }).click()
    const launcher = page.getByRole('region', { name: 'Workflow Launcher' })
    await launcher.getByRole('button', { name: /Stage mismatch review/ }).click()
    await launcher.getByRole('button', { name: 'Send to Guidance' }).click()

    await expect(page.getByRole('tab', { name: 'Multi-Agent Guidance' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.agent-response')).toContainText('MCEM Coach')
    await expect(page.locator('.agent-response')).toContainText('Grid operations modernization')
    await expect(page.locator('.agent-response')).toContainText(prompt)
})

test('reviews recent workflow runs with typed results and activity detail', async ({ page }) => {
    const completedRun = {
        ...workflowRun('WF-001', 'completed', 'complete'),
        connectorCalls: [{ connector: 'dataverse-mcp' as const, operation: 'read_query', status: 'success' as const, durationMs: 840, recordCount: 1, truncated: true }],
        telemetry: { correlationId: '22222222-2222-4222-8222-222222222222', firstResultMs: 620, cacheHit: false }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.route('**/api/workflows/*', async (route) => {
        const operation = new URL(route.request().url()).pathname.split('/').at(-1)
        if (operation === 'list') await route.fulfill({ json: workflowDefinitions })
        else if (operation === 'history') await route.fulfill({ json: [completedRun] })
        else await route.fulfill({ json: { run: completedRun, output: workflowOutput() } })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Workflows' }).click()
    const launcher = page.getByRole('region', { name: 'Workflow Launcher' })
    await expect(launcher.getByRole('heading', { name: 'Recent runs' })).toBeVisible()
    const recentRun = launcher.getByRole('button', { name: /Stale opportunity sweep/ })
    await recentRun.focus()
    await recentRun.press('Enter')
    await expect(launcher.getByRole('table', { name: 'Stale opportunities' })).toContainText('Northwind renewal')
    await expect(launcher.getByRole('region', { name: 'Operational queue' })).toContainText('Review Northwind renewal')
    await recentRun.evaluate((element) => (element as HTMLElement).blur())
    const workflowWorkspace = launcher.locator('.workflow-workspace')
    const localeDependentText = [workflowWorkspace.locator('.workflow-run-list button > span'), workflowWorkspace.locator('.workflow-results > header > span')]
    await expect(workflowWorkspace).toHaveScreenshot('workflow-runs-desktop.png', { animations: 'disabled', mask: localeDependentText })
    await launcher.getByRole('button', { name: 'Activity details' }).click()
    await expect(page.getByRole('dialog', { name: 'Workflow activity' })).toContainText('840 ms')
    await expect(page.getByRole('dialog', { name: 'Workflow activity' })).toContainText('1 record')
    await expect(page.getByRole('dialog', { name: 'Workflow activity' })).toContainText('truncated')
    await page.getByRole('button', { name: 'Close' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await launcher.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expect(workflowWorkspace).toHaveScreenshot('workflow-runs-mobile.png', { animations: 'disabled', mask: localeDependentText })
})

for (const resultCase of [
    { kind: 'metric-strip' as const, expected: 'Coverage82%' },
    { kind: 'timeline' as const, expected: 'Commitment became overdue' },
    { kind: 'action-list' as const, expected: 'Contact the account owner' },
    { kind: 'exception-list' as const, expected: 'No accountable owner is assigned.' }
]) {
    test(`renders the ${resultCase.kind} workflow result`, async ({ page }) => {
        const completedRun = workflowRun('WF-001', 'completed', 'complete')
        await page.route('**/api/workflows/*', async (route) => {
            const operation = new URL(route.request().url()).pathname.split('/').at(-1)
            if (operation === 'list') await route.fulfill({ json: workflowDefinitions })
            else if (operation === 'history') await route.fulfill({ json: [completedRun] })
            else await route.fulfill({ json: { run: completedRun, output: workflowOutput('WF-001', resultCase.kind) } })
        })

        await page.goto('/')
        await page.getByRole('button', { name: 'Workflows' }).click()
        const launcher = page.getByRole('region', { name: 'Workflow Launcher' })
        await launcher.getByRole('button', { name: /Stale opportunity sweep/ }).click()
        await expect(launcher.getByRole('region', { name: 'Workflow results' })).toContainText(resultCase.expected)
    })
}

test('reports recent workflow loading and failure states', async ({ page }) => {
    await page.route('**/api/workflows/*', async (route) => {
        const operation = new URL(route.request().url()).pathname.split('/').at(-1)
        if (operation === 'list') await route.fulfill({ json: workflowDefinitions })
        else if (operation === 'history') {
            await new Promise((resolve) => setTimeout(resolve, 250))
            await route.fulfill({ status: 503, json: { error: 'Workflow history is temporarily unavailable.' } })
        }
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Workflows' }).click()
    const launcher = page.getByRole('region', { name: 'Workflow Launcher' })
    await expect(launcher.getByText('Loading recent workflow runs')).toBeVisible()
    await expect(launcher.getByText('Workflow history is temporarily unavailable.')).toBeVisible()
})

test('launches scoped workflows and renders cancellation and outcome states', async ({ page }) => {
    let latestWorkflowId = 'WF-001'
    let completeFirstWorkflow = false
    const startRequests: Array<Record<string, unknown>> = []
    await page.route('**/api/workflows/*', async (route) => {
        const operation = new URL(route.request().url()).pathname.split('/').at(-1)
        const request = route.request().postDataJSON() as { workflowId?: string; scope?: string }
        if (operation === 'list') {
            await route.fulfill({ json: request.scope === 'portfolio' ? workflowDefinitions : [] })
            return
        }
        if (operation === 'history') {
            await route.fulfill({ json: [] })
            return
        }
        if (operation === 'start') {
            latestWorkflowId = request.workflowId ?? 'WF-001'
            startRequests.push(request as Record<string, unknown>)
            await route.fulfill({ json: workflowRun(latestWorkflowId, 'running') })
            return
        }
        if (operation === 'cancel') {
            await route.fulfill({ json: workflowRun(latestWorkflowId, 'cancelled') })
            return
        }
        const state = latestWorkflowId === 'WF-002' ? 'partial' : latestWorkflowId === 'WF-005' ? 'unauthorized' : 'complete'
        if (latestWorkflowId === 'WF-001' && !completeFirstWorkflow) {
            await route.fulfill({ json: { run: workflowRun(latestWorkflowId, 'running') } })
            return
        }
        await route.fulfill({ json: { run: workflowRun(latestWorkflowId, 'completed', state) } })
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: /Fabrikam Retail/ }).first().click()
    await page.getByRole('button', { name: 'Workflows' }).click()
    const launcher = page.getByRole('region', { name: 'Workflow Launcher' })
    await expect(launcher.getByRole('heading', { name: 'Workflow Launcher' })).toBeVisible()
    await expect(launcher.getByText('No runs in this scope.')).toBeVisible()
    await expect(launcher.locator('.workflow-card')).toHaveCount(4)
    await expect(launcher.getByLabel('Current workflow scope')).toContainText('Portfolio')

    await launcher.getByLabel('Filter workflows by persona').selectOption('Manager')
    await expect(launcher.locator('.workflow-card')).toHaveCount(3)
    await launcher.getByLabel('Filter workflows by source').selectOption('msx-mcp')
    await expect(launcher.locator('.workflow-card')).toHaveCount(2)
    await launcher.getByLabel('Filter workflows by persona').selectOption('all')
    await launcher.getByLabel('Filter workflows by source').selectOption('all')

    await launcher.getByRole('button', { name: 'Account', exact: true }).click()
    await expect(launcher.getByText('No workflows match this scope and filter set.')).toBeVisible()
    await expect(launcher.getByLabel('Current workflow scope')).toContainText('Fabrikam Retail')
    await launcher.getByRole('button', { name: 'Portfolio', exact: true }).click()

    const staleSweep = launcher.locator('.workflow-card').filter({ hasText: 'Stale opportunity sweep' })
    await staleSweep.getByRole('button', { name: 'Parameters' }).click()
    await expect(staleSweep.getByRole('spinbutton', { name: 'Stale after days' })).toHaveValue('30')
    await staleSweep.getByRole('button', { name: 'Run workflow' }).click()
    await expect(launcher.getByRole('status')).toContainText('running')
    expect(startRequests[0]?.input).toMatchObject({ staleAfterDays: 30 })
    await launcher.getByRole('button', { name: 'Cancel run' }).click()
    await expect(launcher.getByRole('status')).toContainText('Workflow run cancelled.')

    completeFirstWorkflow = true
    await staleSweep.getByRole('button', { name: 'Run workflow' }).click()
    await expect(launcher.getByRole('status')).toContainText('Workflow completed with all required sources.')

    await launcher.locator('.workflow-card').filter({ hasText: 'Overdue milestone triage' }).getByRole('button', { name: 'Run workflow' }).click()
    await expect(launcher.getByRole('status')).toContainText('Workflow completed with partial source coverage.')

    await launcher.locator('.workflow-card').filter({ hasText: 'Weekly governance exceptions' }).getByRole('button', { name: 'Run workflow' }).click()
    await expect(launcher.getByRole('status')).toContainText('Your delegated access does not include a required source or scope.')

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('navigation', { name: 'Mobile workspace navigation' }).getByText('Workflows')).toBeVisible()
    await expect(launcher.locator('.workflow-card').first()).toBeVisible()
    expect(await launcher.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})

test('runs the static web rendering with hierarchical blades', async ({ page }) => {
    const pageErrors: Error[] = []
    let emailMarkdown = ''
    let exportMarkdown = ''
    page.on('pageerror', (error) => pageErrors.push(error))
    await page.route('**/api/open-email-compose', async (route) => {
        emailMarkdown = (route.request().postDataJSON() as { responseMarkdown: string }).responseMarkdown
        await route.fulfill({
            status: 200,
            contentType: 'message/rfc822',
            headers: { 'x-tlc-file-name': 'guidance.eml' },
            body: 'MIME-Version: 1.0'
        })
    })
    await page.route('**/api/export-agent-response', async (route) => {
        exportMarkdown = (route.request().postDataJSON() as { responseMarkdown: string }).responseMarkdown
        await route.fulfill({
            status: 200,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            headers: { 'x-tlc-file-name': 'guidance.docx' },
            body: 'test document'
        })
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    await expect(page).toHaveTitle('TLC Account Team Intelligence | Web')
    await expect(page.getByText('STATIC WEB · SAMPLE DATA')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Select a customer account' })).toBeVisible()
    await page.getByRole('button', { name: /Fabrikam Retail/ }).first().click()
    await expect(page.getByRole('region', { name: 'Opportunity workbench' }).getByRole('heading', { name: 'Fabrikam Retail' })).toBeVisible()
    await page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Customer data platform - ready to advance / }).click()

    await expect(page.getByRole('region', { name: 'Milestones blade' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Customer data platform - ready to advance / })).toContainText('Morgan Lee · Stage 2 · $3.2M · 2027-01-15')
    const selectedOpportunity = page.getByRole('treeitem', { name: /Customer data platform - ready to advance/ })
    await expect(selectedOpportunity).toHaveAttribute('aria-expanded', 'true')
    await expect(selectedOpportunity.getByRole('group')).toContainText('Technical validation workshop')
    await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toContainText('Morgan Lee · Stage 2 · $3.2M · closes 2027-01-15')
    await selectedOpportunity.getByRole('button', { name: /^Customer data platform - ready to advance / }).click()
    await expect(selectedOpportunity).toHaveAttribute('aria-expanded', 'false')
    await expect(selectedOpportunity.getByRole('group')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toContainText('Morgan Lee · Stage 2 · $3.2M · closes 2027-01-15')
    await selectedOpportunity.getByRole('button', { name: /^Customer data platform - ready to advance / }).click()
    await expect(selectedOpportunity).toHaveAttribute('aria-expanded', 'true')
    await expect(selectedOpportunity.getByRole('group')).toContainText('Technical validation workshop')
    await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toContainText('Stage 3')
    await expect(page.getByRole('complementary', { name: 'Next best actions blade' })).toContainText('Confirm progression to Stage 3')
    await page.getByRole('button', { name: 'Refresh Milestones' }).click()
    await expect(selectedOpportunity.getByRole('group')).toContainText('Technical validation workshop')
    await page.getByRole('tab', { name: 'Multi-Agent Guidance' }).click()
    await expect(page.locator('.agent-response')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'What should the account team focus on this week?' })).toBeVisible()
    const guidanceGeometry = await page.evaluate(() => {
        const cards = [...document.querySelectorAll<HTMLElement>('.agent-prompt-suggestions button')]
        const first = cards[0]?.getBoundingClientRect()
        const third = cards[2]?.getBoundingClientRect()
        const composer = document.querySelector<HTMLElement>('.agent-composer textarea')?.getBoundingClientRect()
        if (!first || !third || !composer) throw new Error('Expected guidance controls are missing.')
        return {
            cardHeight: first.height,
            rowGap: third.top - first.bottom,
            composerHeight: composer.height
        }
    })
    expect(guidanceGeometry.cardHeight).toBeLessThanOrEqual(39)
    expect(guidanceGeometry.rowGap).toBeLessThanOrEqual(5)
    expect(guidanceGeometry.composerHeight).toBeLessThanOrEqual(48)
    await page.getByRole('button', { name: 'What should the account team focus on this week?' }).click()
    await expect(page.getByText('sanitized web-preview evidence')).toBeVisible()
    await expect(page.locator('.agent-response-markdown h2')).toHaveText(['account pulse', 'Owner-based plan to close gaps', 'Recommended sequence', 'Assumptions / cautions'])
    await expect(page.locator('.agent-response-markdown h3')).toHaveText('ATS — Customer outcomes')
    await expect(page.locator('.agent-response-markdown li strong')).toHaveText(['Gap:', 'Evidence:'])
    await expect(page.locator('.agent-response')).toHaveCSS('margin-top', '8px')
    await expect(page.getByRole('button', { name: 'Send Email' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible()
    await page.getByRole('button', { name: 'Send Email' }).click()
    await page.getByRole('textbox', { name: 'Email recipients' }).fill('reviewer@example.com')
    await page.getByRole('button', { name: 'Download Draft' }).click()
    await expect.poll(() => emailMarkdown).toContain('## Recommended sequence')
    expect(emailMarkdown).toContain('### ATS — Customer outcomes')
    expect(emailMarkdown).toContain('**MSX Opportunity:** [Open opportunity in MSX]')
    await page.getByRole('button', { name: 'Export' }).click()
    await expect.poll(() => exportMarkdown).toContain('## Recommended sequence')
    expect(exportMarkdown).toContain('### ATS — Customer outcomes')
    await page.getByRole('button', { name: 'Close Next best actions' }).click()
    await expect(page.getByRole('complementary', { name: 'Next best actions blade' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Opportunities blade' })).toBeVisible()
    expect(pageErrors).toEqual([])
})

test('searches accounts and opportunities and reports no matches', async ({ page }) => {
    await page.goto('/')
    const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })

    await search.fill('Fabrikam')
    await search.press('Enter')
    await expect(page.getByRole('region', { name: 'Opportunity workbench' }).getByRole('heading', { name: 'Fabrikam Retail' })).toBeVisible()

    await search.fill('Customer data platform')
    await page.getByRole('option', { name: /Customer data platform.*Fabrikam Retail/ }).click()
    await expect(page.getByRole('region', { name: 'Opportunity workbench' }).getByRole('heading', { name: 'Customer data platform - ready to advance' })).toBeVisible()

    await search.fill('not a real account')
    await expect(page.getByRole('status')).toHaveText('No accounts or opportunities found.')
})

test('sorts opportunities by close date, stage, and value across refreshes', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Contoso Energy/ }).first().click()
    const blade = page.getByRole('region', { name: 'Opportunities blade' })
    const firstOpportunity = blade.locator('.opportunity-node').first()

    await expect(firstOpportunity).toContainText('Grid operations modernization')

    await blade.getByRole('button', { name: 'Sort opportunities' }).click()
    await page.getByRole('menuitemradio', { name: 'Close Date' }).click()
    await expect(firstOpportunity).toContainText('Resilient cloud foundation')

    await blade.getByRole('button', { name: 'Sort opportunities' }).click()
    await page.getByRole('menuitemradio', { name: 'Stage' }).click()
    await expect(firstOpportunity).toContainText('Grid operations modernization')

    await blade.getByRole('button', { name: 'Sort opportunities' }).click()
    await page.getByRole('menuitemradio', { name: '$ Value', exact: true }).click()
    await expect(firstOpportunity).toContainText('Grid operations modernization')

    await blade.getByRole('button', { name: 'Refresh Opportunities' }).click()
    await expect(firstOpportunity).toContainText('Grid operations modernization')
    await expect(blade.getByRole('button', { name: 'Sort opportunities' })).toHaveAttribute('title', 'Sort opportunities by Value (descending)')

    await blade.getByRole('button', { name: 'Sort opportunities' }).click()
    await page.getByRole('menuitemradio', { name: '$ Value', exact: true }).click()
    await expect(firstOpportunity).toContainText('Cloud security readiness')

    await blade.getByRole('button', { name: 'Sort opportunities' }).click()
    await page.getByRole('menuitemradio', { name: 'Close Date' }).click()
    await expect(firstOpportunity).toContainText('Grid operations modernization')
})

test('offers milestone sorting beside the milestone refresh control', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Contoso Energy/ }).first().click()
    await page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Grid operations modernization / }).click()

    const milestoneGroup = page.getByRole('group', { name: 'Grid operations modernization milestones' })
    const sortButton = milestoneGroup.getByRole('button', { name: 'Sort milestones' })
    const refreshButton = milestoneGroup.getByRole('button', { name: 'Refresh Milestones' })
    const [sortBox, refreshBox] = await Promise.all([sortButton.boundingBox(), refreshButton.boundingBox()])

    expect(sortBox).not.toBeNull()
    expect(refreshBox).not.toBeNull()
    expect(sortBox!.x).toBeLessThan(refreshBox!.x)

    await sortButton.click()
    await expect(page.getByRole('menuitemradio', { name: 'Milestone Est. Date' })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Est. Change in Monthly Usage ($ Value)', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Customer Commitment' })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Milestone Status' })).toBeVisible()
    await page.getByRole('menuitemradio', { name: 'Milestone Est. Date' }).click()
    await expect(sortButton).toHaveAttribute('title', 'Sort milestones by Milestone Est. Date (descending)')

    await sortButton.click()
    await page.getByRole('menuitemradio', { name: 'Est. Change in Monthly Usage ($ Value)', exact: true }).click()
    await expect(sortButton).toHaveAttribute('title', 'Sort milestones by Est. Change in Monthly Usage (descending)')

    await sortButton.click()
    await page.getByRole('menuitemradio', { name: 'Est. Change in Monthly Usage ($ Value)', exact: true }).click()
    await expect(sortButton).toHaveAttribute('title', 'Sort milestones by Est. Change in Monthly Usage (ascending)')
})

test('edits milestone fields and opportunity comments with save and cancel', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: /Contoso Energy/ }).first().click()
    const opportunityButton = page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Grid operations modernization / })
    await opportunityButton.click()

    const editMilestone = page.getByRole('button', { name: 'Edit Customer outcome validation' })
    const openMilestoneEditor = async (name: string) => {
        await editMilestone.click()
        await page.getByRole('menuitem', { name, exact: true }).click()
    }

    await openMilestoneEditor('Milestone Status')
    const status = page.getByRole('combobox')
    await expect(status.locator('option')).toHaveText([
        'On Track',
        'At Risk',
        'Blocked',
        'Completed',
        'Cancelled',
        'Lost to Competitor',
        'Hygiene/Duplicate'
    ])
    await status.selectOption({ label: 'At Risk' })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('treeitem', { name: /Customer outcome validation/ })).toContainText('At Risk')

    await openMilestoneEditor('Risk/Blocker Details')
    await expect(page.getByRole('textbox', { name: 'Risk/Blocker Details' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await openMilestoneEditor('Milestone Est Date')
    await expect(page.locator('input[type="date"]')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await openMilestoneEditor('Customer Commitment')
    await expect(page.getByRole('combobox').locator('option')).toHaveText(['Uncommitted', 'Committed'])
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await openMilestoneEditor('Milestone Comments')
    await expect(page.getByRole('textbox', { name: 'Milestone Comments' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    const opportunityTreeItem = page.getByRole('treeitem', { name: /Grid operations modernization/ })
    await page.getByRole('button', { name: 'Edit Grid operations modernization' }).click()
    await page.getByRole('menuitem', { name: 'Opportunity Comments' }).click()
    const comments = opportunityTreeItem.getByRole('textbox', { name: 'Opportunity Comments' })
    await expect(page.getByRole('region', { name: 'Opportunity workbench' }).getByRole('textbox', { name: 'Opportunity Comments' })).toHaveCount(0)
    const originalComments = await comments.inputValue()
    await comments.fill('Discard this draft')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await opportunityButton.click({ button: 'right' })
    await expect(comments).toHaveValue(originalComments)
    await comments.fill('Executive sponsor aligned')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await opportunityButton.click({ button: 'right' })
    await expect(comments).toHaveValue('Executive sponsor aligned')
})

test('governs adjacent MCEM board advances, exceptions, and recycle moves', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: /Fabrikam Retail/ }).first().click()
    await page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Customer data platform - ready to advance / }).click()
    await page.getByRole('tab', { name: 'MCEM Stage Management' }).click()

    const board = page.getByLabel('MCEM stages for Fabrikam Retail')
    await expect(board.getByLabel('Stage 1: Listen & Consult')).toBeVisible()
    await expect(board.getByLabel('Stage 5: Manage & Optimize')).toBeVisible()
    await expect(board.locator('.mcem-card.selected')).toContainText('Customer data platform - ready to advance')

    const boardScroller = page.locator('.mcem-board-view')
    const centerPane = page.locator('.center-pane')
    const horizontalScrollbar = page.getByRole('slider', { name: 'Scroll MCEM stages horizontally' })
    const verticalScrollbar = page.getByRole('slider', { name: 'Scroll MCEM stages vertically' })
    await expect.poll(() => boardScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await expect(horizontalScrollbar).toBeVisible()
    await expect(verticalScrollbar).toBeVisible()
    const [centerPaneBox, horizontalBox, verticalBox] = await Promise.all([
        centerPane.boundingBox(),
        horizontalScrollbar.boundingBox(),
        verticalScrollbar.boundingBox()
    ])
    expect(centerPaneBox).not.toBeNull()
    expect(horizontalBox).not.toBeNull()
    expect(verticalBox).not.toBeNull()
    expect(horizontalBox!.y + horizontalBox!.height).toBeLessThanOrEqual(centerPaneBox!.y + centerPaneBox!.height)
    expect(verticalBox!.x + verticalBox!.width).toBeLessThanOrEqual(centerPaneBox!.x + centerPaneBox!.width)
    await boardScroller.evaluate((element) => element.scrollTo({ left: element.scrollWidth }))
    await expect(board.getByLabel('Stage 5: Manage & Optimize')).toBeInViewport()
    await boardScroller.evaluate((element) => element.scrollTo({ left: 0 }))

    const selectedCard = board.locator('.mcem-card.selected')
    const previousStage = board.getByLabel('Stage 1: Listen & Consult')
    const [cardBox, previousStageBox] = await Promise.all([selectedCard.boundingBox(), previousStage.boundingBox()])
    expect(cardBox).not.toBeNull()
    expect(previousStageBox).not.toBeNull()
    await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + 18)
    await page.mouse.down()
    await page.mouse.move(previousStageBox!.x + previousStageBox!.width / 2, previousStageBox!.y + 120, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByRole('dialog')).toContainText('Stage 2 → Stage 1')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(board.getByLabel('Stage 2: Inspire & Design')).toContainText('Customer data platform - ready to advance')

    await board.locator('.mcem-card').filter({ hasText: 'AI-assisted customer service' }).click()
    await expect(page.getByRole('tab', { name: 'MCEM Stage Management' })).toHaveAttribute('aria-selected', 'true')
    await expect(board.locator('.mcem-card.selected')).toContainText('AI-assisted customer service')

    await board.getByRole('button', { name: 'Move Customer data platform - ready to advance to next stage' }).click()
    await expect(page.getByRole('dialog')).toContainText('Stage 2 → Stage 3')
    await page.getByRole('button', { name: 'Confirm move' }).click()
    await expect(board.getByLabel('Stage 3: Empower & Achieve')).toContainText('Customer data platform - ready to advance')

    await board.getByRole('button', { name: 'Move Customer data platform - ready to advance to previous stage' }).click()
    await expect(page.getByText('This move recycles the opportunity to a previous stage.')).toBeVisible()
    const recycleReason = page.getByRole('textbox', { name: 'Reason' })
    await expect(page.getByRole('button', { name: 'Confirm move' })).toBeDisabled()
    await recycleReason.fill('Customer scope requires renewed discovery.')
    await page.getByRole('button', { name: 'Confirm move' }).click()
    await expect(board.getByLabel('Stage 2: Inspire & Design')).toContainText('Customer data platform - ready to advance')

    await board.getByRole('button', { name: 'Move AI-assisted customer service to next stage' }).click()
    await expect(page.getByText('Some exit criteria are incomplete. This move will be recorded as an exception.')).toBeVisible()
    await page.getByRole('textbox', { name: 'Reason' }).fill('Executive approved proceeding with tracked gaps.')
    await page.getByRole('button', { name: 'Confirm move' }).click()
    await expect(board.getByLabel('Stage 3: Empower & Achieve')).toContainText('AI-assisted customer service')
})

test('uses Fluent theme tokens and readable compact typography', async ({ page }) => {
    await page.goto('/?scoutTheme=dark')

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('.fluent-root')).toBeVisible()

    const styles = await page.evaluate(() => {
        const provider = document.querySelector<HTMLElement>('.fluent-root')
        const intro = document.querySelector<HTMLElement>('.blade-intro')
        const workspace = document.querySelector<HTMLElement>('.workspace')
        const shell = document.querySelector<HTMLElement>('.app-shell')
        const bladeHeader = document.querySelector<HTMLElement>('.blade-header')
        const accountButton = document.querySelector<HTMLElement>('.account-button')
        const exitLabel = document.querySelector<HTMLElement>('.exit-label')
        if (!provider || !intro || !workspace || !shell || !bladeHeader || !accountButton || !exitLabel) {
            throw new Error('Expected revamp layout elements are missing.')
        }
        return {
            backgroundToken: getComputedStyle(provider).getPropertyValue('--colorNeutralBackground1').trim(),
            bodyFontSize: getComputedStyle(document.body).fontSize,
            introFontSize: getComputedStyle(intro).fontSize,
            overflowX: getComputedStyle(workspace).overflowX,
            shellRows: getComputedStyle(shell).gridTemplateRows,
            bladeHeaderMinHeight: getComputedStyle(bladeHeader).minHeight,
            bladeTitleFontSize: getComputedStyle(bladeHeader.querySelector('h2')!).fontSize,
            accountPadding: getComputedStyle(accountButton).padding,
            accountTitleFontSize: getComputedStyle(accountButton.querySelector('strong')!).fontSize,
            fluentButtonFontSize: getComputedStyle(exitLabel).fontSize
        }
    })

    expect(styles.backgroundToken).not.toBe('')
    expect(styles.bodyFontSize).toBe('12px')
    expect(styles.introFontSize).toBe('11px')
    expect(styles.overflowX).toBe('auto')
    expect(styles.shellRows.split(' ')[0]).toBe('44px')
    expect(styles.bladeHeaderMinHeight).toBe('52px')
    expect(styles.bladeTitleFontSize).toBe('14px')
    expect(styles.accountPadding).toBe('7px 8px')
    expect(styles.accountTitleFontSize).toBe('12px')
    expect(styles.fluentButtonFontSize).toBe('12px')
})

test('resizes blades by dragging and restores persisted widths after collapse and reload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    const accountsBlade = page.getByRole('region', { name: 'Accounts blade' })
    const resizeHandle = page.getByRole('separator', { name: 'Resize Accounts blade' })
    const initialWidth = (await accountsBlade.boundingBox())!.width
    const handleBox = (await resizeHandle.boundingBox())!

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 100)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 80, handleBox.y + 100)
    await page.mouse.up()

    const resizedWidth = (await accountsBlade.boundingBox())!.width
    expect(resizedWidth).toBeGreaterThan(initialWidth + 70)

    const resizedHandleBox = (await resizeHandle.boundingBox())!
    await page.mouse.move(resizedHandleBox.x + resizedHandleBox.width / 2, resizedHandleBox.y + 100)
    await page.mouse.down()
    await page.mouse.move(resizedHandleBox.x + resizedHandleBox.width / 2 - 30, resizedHandleBox.y + 100)
    await page.mouse.up()
    const finalWidth = (await accountsBlade.boundingBox())!.width
    expect(finalWidth).toBeLessThan(resizedWidth - 20)

    await page.getByRole('button', { name: 'Collapse Accounts blade header' }).click()
    await expect.poll(async () => (await accountsBlade.boundingBox())!.width).toBe(44)
    await page.getByRole('button', { name: 'Expand Accounts blade header' }).click()
    await expect.poll(async () => (await accountsBlade.boundingBox())!.width).toBeCloseTo(finalWidth, 0)

    await page.reload()
    await expect.poll(async () => (await accountsBlade.boundingBox())!.width).toBeCloseTo(finalWidth, 0)
})

test('uses mobile drill-down navigation without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: /Contoso Energy/ }).first().click()
    await expect(page.getByRole('region', { name: 'Opportunities blade' })).toBeVisible()
    await page.getByRole('button', { name: /^Cloud security readiness / }).click()
    await expect(page.getByRole('region', { name: 'Opportunities blade' }).getByRole('treeitem', { name: /Cloud security readiness/ }).getByRole('group')).toBeVisible()
    await page.getByRole('button', { name: /Analysis/ }).click()
    await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toBeVisible()
    await page.getByRole('button', { name: /Actions/ }).click()
    await expect(page.getByRole('complementary', { name: 'Next best actions blade' })).toBeVisible()
    await expect(page.getByRole('separator')).toHaveCount(0)

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(hasOverflow).toBe(false)
})