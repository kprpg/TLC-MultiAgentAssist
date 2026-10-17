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

test('adds and removes the signed-in user on a milestone team via the +/- toggle', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-revamp-ms-team-'))
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
        await opportunitiesBlade.getByRole('button', { name: /^Grid operations modernization / }).click()

        const milestones = opportunitiesBlade.getByRole('region', { name: 'Grid operations modernization milestones' })
        await expect(milestones).toContainText('Customer outcome validation')

        const toggle = milestones.getByRole('button', { name: /the team for Customer outcome validation/ })
        await expect(toggle).toBeVisible()
        const initiallyPressed = await toggle.getAttribute('aria-pressed')
        const flipped = initiallyPressed === 'true' ? 'false' : 'true'

        // Toggle membership and confirm the independent state flips, then restore it.
        await toggle.click()
        if (initiallyPressed === 'true') {
            await window.getByRole('dialog', { name: 'Remove from milestone team' }).getByRole('button', { name: 'Remove membership' }).click()
        }
        await expect(toggle).toHaveAttribute('aria-pressed', flipped)
        await toggle.click()
        if (initiallyPressed !== 'true') {
            await window.getByRole('dialog', { name: 'Remove from milestone team' }).getByRole('button', { name: 'Remove membership' }).click()
        }
        await expect(toggle).toHaveAttribute('aria-pressed', initiallyPressed ?? 'false')

        // The opportunity stays in the portfolio throughout because Deal Team membership is unchanged.
        await expect(opportunitiesBlade.getByRole('button', { name: /^Grid operations modernization / })).toBeVisible()
    } finally {
        await app.close().catch(() => undefined)
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('creates an Activity (Task) regarding a milestone from the milestone Actions menu', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-revamp-ms-activity-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1200, height: 600 })

        await window.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
        const opportunitiesBlade = window.getByRole('region', { name: 'Opportunities blade' })
        await opportunitiesBlade.getByRole('button', { name: /^Grid operations modernization / }).click()

        const milestones = window.getByRole('region', { name: 'Grid operations modernization milestones' })
        const firstRow = milestones.getByRole('row').filter({ hasText: 'Customer outcome validation' }).first()
        await firstRow.getByRole('button', { name: /^Edit / }).click()
        await window.getByRole('menuitem', { name: 'Activities', exact: true }).click()

        const dialog = window.getByRole('dialog')
        await expect(dialog).toContainText('Activities —')
        await expect(dialog.getByRole('button', { name: 'Close' })).toBeInViewport()
        await expect(dialog.getByRole('button', { name: 'Create task' })).toBeInViewport()
        const dialogBox = await dialog.boundingBox()
        expect(dialogBox).not.toBeNull()
        expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(600)
        await dialog.getByLabel('Subject').fill('Architecture review session')
        await dialog.getByRole('button', { name: 'Create task' }).click()
        await expect(dialog.getByText('Architecture review session')).toBeVisible()
    } finally {
        await app.close().catch(() => undefined)
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})

test('expands a discovered opportunity and joins a milestone team without joining the Deal Team', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-revamp-discover-ms-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1400, height: 900 })

        await window.locator('.rail-button[title="Discover opportunities"]').click()
        // Use an opportunity that is not already on the Deal Team.
        await window.locator('.discover-launcher .scope-switcher button').first().click()
        const discoverTable = window.getByRole('table', { name: 'Discovered opportunities' })
        await expect(discoverTable).toBeVisible()
        const discoveredRow = discoverTable.getByRole('row').filter({ hasText: 'Hybrid networking modernization' })
        await expect(discoveredRow.getByRole('button', { name: 'Add me' })).toBeVisible()
        await discoveredRow.getByRole('button', { name: 'Show milestones for Hybrid networking modernization' }).click()

        const milestonesRow = window.locator('.discover-milestones-row')
        const toggle = milestonesRow.getByRole('button', { name: /the team for Customer outcome validation/ }).first()
        await expect(toggle).toBeVisible()
        await expect(toggle).toHaveAttribute('aria-pressed', 'false')

        // Joining a milestone team for a never-joined opportunity flips the toggle and does not join the Deal Team.
        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-pressed', 'true')
        await expect(discoveredRow.getByRole('button', { name: 'Add me' })).toBeVisible()
    } finally {
        await app.close().catch(() => undefined)
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})