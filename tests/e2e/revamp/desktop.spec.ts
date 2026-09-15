import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { workflowDefinitions, workflowOutput, workflowRun } from './workflow-fixtures.js'

test('opens the default desktop blade workspace through the existing IPC bridge', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-revamp-test-'))
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
        await launcher.getByRole('button', { name: /Stale opportunity sweep/ }).first().click()
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
        const opportunity = window.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Grid operations modernization / })
        await expect(opportunity).toContainText('Avery Johnson · Stage 3 · $4.2M · 2026-10-30')
        await opportunity.hover()
        await expect(window.getByRole('tooltip')).toContainText('Opportunity owner: Avery Johnson')
        await expect(window.getByRole('tooltip')).toContainText('Stage owner: Solution Engineer')
        await expect(window.getByRole('tooltip')).toContainText('Value: $4.2M')

        await opportunity.click()
        await expect(window.getByRole('region', { name: 'Milestones blade' })).toHaveCount(0)
        const selectedOpportunity = window.getByRole('treeitem', { name: /Grid operations modernization/ })
        await expect(selectedOpportunity).toHaveAttribute('aria-expanded', 'true')
        await expect(selectedOpportunity.getByRole('group')).toContainText('Customer outcome validation')
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
        await horizontalScrollbar.focus()
        await horizontalScrollbar.press('End')
        await expect.poll(() => stageBoardViewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
        await expect(window.getByLabel('Stage 5: Manage & Optimize')).toBeVisible()
        await stageBoardViewport.locator('.mcem-board').evaluate((element, viewportHeight) => {
            ; (element as HTMLElement).style.minHeight = `${viewportHeight + 400}px`
        }, viewportBox!.height)
        await expect.poll(() => verticalScrollbar.evaluate((element) => Number((element as HTMLInputElement).max))).toBeGreaterThan(0)
        await verticalScrollbar.focus()
        await verticalScrollbar.press('End')
        await expect.poll(() => stageBoardViewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
        await window.getByRole('tab', { name: 'MSX' }).click()

        await window.getByRole('button', { name: 'Collapse Accounts blade header' }).click()
        await expect(window.getByRole('button', { name: 'Expand Accounts', exact: true })).toBeVisible()
        await window.getByRole('button', { name: 'Refresh Milestones' }).click()
        await expect(selectedOpportunity.getByRole('group')).toContainText('Customer outcome validation')
        await window.getByRole('tab', { name: 'Multi-Agent Guidance' }).click()
        await expect(window.getByRole('tab', { name: 'Account Pulse' })).toHaveAttribute('aria-selected', 'true')
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