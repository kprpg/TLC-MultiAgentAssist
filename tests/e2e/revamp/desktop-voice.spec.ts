import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { recordedVoiceHost } from './voice-host-fixture.js'
import statements from '../../fixtures/voice-input/statements.json' with { type: 'json' }

test.skip(process.platform !== 'win32', 'Native offline Desktop voice is Windows-only.')

for (const statement of statements) {
    test(`Desktop IPC transcribes actual recorded ${statement.id} into reviewed search`, async () => {
        test.setTimeout(90_000)
        const directory = await mkdtemp(join(tmpdir(), 'tlc-desktop-voice-'))
        const fixture = await recordedVoiceHost(resolve('tests', 'fixtures', 'voice-input', 'recordings', `${statement.id}.wav`))
        const app = await electron.launch({
            ...(process.env['TLC_VOICE_ELECTRON_EXECUTABLE']
                ? { executablePath: process.env['TLC_VOICE_ELECTRON_EXECUTABLE'] }
                : {}),
            args: [resolve('apps', 'desktop'), `--user-data-dir=${directory}`],
            env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
        })
        try {
            await app.evaluate(({ ipcMain }, url) => {
                ipcMain.removeHandler('tlc:voice-input')
                ipcMain.handle('tlc:voice-input', async (_event, request: unknown) => {
                    const response = await fetch(url, { method: 'POST', body: JSON.stringify(request) })
                    if (!response.ok) throw new Error('Recorded voice host rejected the test request.')
                    return response.json()
                })
            }, fixture.url)
            const window = await app.firstWindow()
            await window.setViewportSize({ width: 1400, height: 850 })
            const errors: string[] = []
            window.on('pageerror', (error) => errors.push(error.message))
            await window.getByRole('button', { name: 'Start voice search', exact: true }).click()
            await window.getByRole('button', { name: 'Start listening', exact: true }).click()
            const search = window.getByRole('searchbox', { name: 'Search accounts and opportunities' })
            await expect(search).toHaveValue(new RegExp(statement.text, 'i'), { timeout: 20_000 })
            await expect(window.getByRole('heading', { name: 'Select a customer account', exact: true })).toBeVisible()
            expect(fixture.events.some((event) => event.type === 'segment' && event.segment.isFinal)).toBe(true)
            const recognized = fixture.events.flatMap((event) => event.type === 'segment' && event.segment.isFinal ? [event.segment.text] : []).join(' ')
            await expect(search).toHaveValue(recognized)
            expect(errors).toEqual([])
            await search.fill('grid operations')
            await search.press('Enter')
            await expect(window.getByRole('heading', { name: 'Grid operations modernization', exact: true })).toBeVisible()
        } finally {
            await app.close()
            await fixture.close()
            await rm(directory, { recursive: true, force: true })
        }
    })
}
