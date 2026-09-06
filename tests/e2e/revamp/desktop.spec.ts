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
        const pageErrors: Error[] = []
        window.on('pageerror', (error) => pageErrors.push(error))

        await expect(window).toHaveTitle('TLC Account Team Intelligence | Desktop')
        await expect(window.getByText('DESKTOP · CONNECTED DATA')).toBeVisible()
        await expect(window.getByRole('region', { name: 'Accounts blade' })).toBeVisible()
        await expect(window.getByRole('heading', { name: 'Select a customer account' })).toBeVisible()

        await window.getByRole('button', { name: /Contoso Energy/ }).first().click()
        await expect(window.getByRole('region', { name: 'Opportunities blade' })).toBeVisible()
        await expect(window.getByRole('region', { name: 'Opportunity workbench' }).getByRole('heading', { name: 'Contoso Energy' })).toBeVisible()
        const opportunity = window.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /Grid operations modernization/ })
        await opportunity.hover()
        await expect(window.getByRole('tooltip')).toContainText('Stage owner: Solution Engineer')
        await expect(window.getByRole('tooltip')).toContainText('Value: $4.2M')

        await opportunity.click()
        await expect(window.getByRole('region', { name: 'Milestones blade' })).toBeVisible()
        await expect(window.getByRole('region', { name: 'Opportunity workbench' })).toContainText('Evidence supports')
        await expect(window.getByRole('complementary', { name: 'Next best actions blade' })).toBeVisible()
        await expect(window.getByRole('tab', { name: 'MSX' })).toHaveAttribute('aria-selected', 'true')

        await window.getByRole('button', { name: 'Collapse Accounts blade header' }).click()
        await expect(window.getByRole('button', { name: 'Expand Accounts', exact: true })).toBeVisible()
        await window.getByRole('button', { name: 'Refresh Milestones' }).click()
        await expect(window.getByRole('region', { name: 'Milestones blade' })).toContainText('Agree the planned outcome')
        await window.getByRole('tab', { name: 'Multi-Agent Guidance' }).click()
        await expect(window.getByRole('tab', { name: 'Account Pulse' })).toHaveAttribute('aria-selected', 'true')
        await expect(window.locator('.agent-response')).toHaveCount(0)
        await window.getByRole('button', { name: 'What should the account team focus on this week?' }).click()
        await expect(window.locator('.agent-response')).toContainText('Grid operations modernization')
        await expect(window.getByRole('button', { name: 'Send Email' })).toBeVisible()
        await expect(window.getByRole('button', { name: 'Export' })).toBeVisible()
        await window.getByRole('button', { name: 'Close Next best actions' }).click()
        await expect(window.getByRole('complementary', { name: 'Next best actions blade' })).toHaveCount(0)
        await window.getByRole('button', { name: 'Close Milestones' }).click()
        await expect(window.getByRole('region', { name: 'Milestones blade' })).toHaveCount(0)
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