import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Exercises the relational SQLite sample store (TLC_DATA_STORE=sqlite) end to end, showcasing the
// three milestone-membership capabilities seeded into the store: mixed +/- states, the portfolio
// union (a milestone-team-only opportunity), and Discovery milestone expansion (greenfield join).
test('the SQLite sample store showcases milestone membership, portfolio union, and Discovery expansion', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-sqlite-showcase-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1400, height: 900 })
        window.on('dialog', (dialog) => void dialog.accept())

        // 1) Portfolio union: a milestone-team-only opportunity appears under Contoso with no Deal Team row.
        await window.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
        const opportunitiesBlade = window.getByRole('region', { name: 'Opportunities blade' })
        const milestoneOnly = opportunitiesBlade.getByRole('button', { name: /^Milestone-only workstream/ })
        await expect(milestoneOnly).toBeVisible()

        // 2) Milestone +/- states: expanding it shows the seeded membership as the "-" (member) toggle.
        await milestoneOnly.click()
        const memberToggle = window.getByRole('button', { name: /the team for Executive alignment review/ })
        await expect(memberToggle).toHaveAttribute('aria-pressed', 'true')

        // 3) Discovery milestone expansion (greenfield): join a milestone for an opportunity with no Deal Team.
        await window.locator('.rail-button[title="Discover opportunities"]').click()
        await window.locator('.discover-launcher .scope-switcher button').filter({ hasText: 'AI & Apps' }).click()
        const discoverTable = window.getByRole('table', { name: 'Discovered opportunities' })
        const greenfieldRow = discoverTable.getByRole('row').filter({ hasText: 'Greenfield AI expansion' })
        await greenfieldRow.getByRole('button', { name: /^Show milestones for / }).click()

        const joinToggle = window.locator('.discover-milestones-row').getByRole('button', { name: /the team for Customer outcome validation/ }).first()
        await expect(joinToggle).toHaveAttribute('aria-pressed', 'false')
        await joinToggle.click()
        await expect(joinToggle).toHaveAttribute('aria-pressed', 'true')
        // Joining the milestone team does NOT join the Deal Team.
        await expect(greenfieldRow.getByRole('button', { name: 'Add me' })).toBeVisible()
    } finally {
        await app.close().catch(() => undefined)
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})
