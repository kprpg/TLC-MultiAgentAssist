import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('reveals milestones when an opportunity is expanded', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-revamp-milestones-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1400, height: 768 })

        const accountsBlade = window.getByRole('region', { name: 'Accounts blade' })
        await accountsBlade.getByRole('button', { name: /Contoso Energy/ }).click()

        const opportunitiesBlade = window.getByRole('region', { name: 'Opportunities blade' })
        const opportunity = opportunitiesBlade.getByRole('button', { name: /^Grid operations modernization / })
        await opportunity.click()

        const milestones = opportunitiesBlade.getByRole('region', { name: 'Grid operations modernization milestones' })
        await expect(opportunity).toHaveAttribute('aria-expanded', 'true')
        await expect(milestones).toContainText('Customer outcome validation')
        await expect(milestones).toBeInViewport()

        await opportunity.click()
        await expect(opportunity).toHaveAttribute('aria-expanded', 'false')
        await expect(milestones).toHaveCount(0)

        await opportunity.click()
        await expect(milestones).toBeInViewport()
    } finally {
        await app.close().catch(() => undefined)
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})