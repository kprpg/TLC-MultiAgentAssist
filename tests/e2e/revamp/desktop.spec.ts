import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('opens the default desktop blade workspace through the existing IPC bridge', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-revamp-test-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })
    let exitedFromUi = false

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1400, height: 768 })
        const pageErrors: Error[] = []
        window.on('pageerror', (error) => pageErrors.push(error))
        await app.evaluate(({ ipcMain }) => {
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
        })

        await expect(window).toHaveTitle('TLC Account Team Intelligence | Desktop')
        await expect(window.getByText('DESKTOP · CONNECTED DATA')).toBeVisible()
        await expect(window.getByRole('region', { name: 'Accounts blade' })).toBeVisible()
        await expect(window.getByRole('heading', { name: 'Select a customer account' })).toBeVisible()

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