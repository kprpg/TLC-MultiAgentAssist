import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Exercises Meeting Capture end to end against the relational SQLite sample store
// (TLC_DATA_STORE=sqlite), which seeds a real Teams transcript for Contoso Energy's
// "Grid operations modernization" opportunity: pick the seeded transcript, extract a
// change-set proposal, review/approve it with a reason, and confirm the all-or-none apply.
test('captures meeting signals from a seeded Teams transcript and applies the approved change set', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-meeting-capture-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_UI_MODE: '' }
    })

    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1400, height: 900 })
        window.on('dialog', (dialog) => void dialog.accept())

        await window.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
        const opportunitiesBlade = window.getByRole('region', { name: 'Opportunities blade' })
        await opportunitiesBlade.getByRole('button', { name: /^Grid operations modernization/ }).click()

        const opportunityHeader = opportunitiesBlade.locator('.blade-header')
        const launcher = opportunityHeader.getByRole('button', { name: 'Meeting capture' })
        await expect(launcher).toBeVisible()
        await expect(opportunitiesBlade.getByRole('region', { name: 'Grid operations modernization milestones' }).getByRole('button', { name: 'Meeting capture' })).toHaveCount(0)
        await launcher.click()

        // The Teams-pick tab is the default and must show the seeded transcript, not an empty state.
        await expect(window.getByText('No linked meeting transcripts')).toHaveCount(0)
        const meetingPicker = window.getByRole('combobox', { name: 'Meeting' })
        await expect(meetingPicker).toBeVisible()

        await window.getByRole('button', { name: 'Extract & Review' }).click()

        const dialog = window.getByRole('dialog', { name: 'Review meeting signals' })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('row', { name: /Purchase timeline/ })).toBeVisible()
        await expect(dialog.getByRole('checkbox', { name: /Purchase timeline/ })).toBeChecked()

        const submit = dialog.getByRole('button', { name: 'Submit (all-or-none)' })
        await expect(submit).toBeDisabled()
        await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill('Captured from executive architecture review meeting notes.')
        await expect(submit).toBeEnabled()
        await submit.click()

        await expect(dialog.getByText(/^Applied/)).toBeVisible()
        await expect(dialog.getByText(/Purchase timeline: This Year/)).toBeVisible()
        await dialog.getByRole('button', { name: 'Done' }).click()
        await expect(dialog).toHaveCount(0)
        await launcher.click()
        await expect(window.getByRole('button', { name: 'Review last result', exact: true })).toHaveCount(0)
    } finally {
        await app.close().catch(() => undefined)
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})
