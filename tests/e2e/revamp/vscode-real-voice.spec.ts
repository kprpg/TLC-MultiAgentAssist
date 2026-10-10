import { expect, test, _electron as electron } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import statements from '../../fixtures/voice-input/statements.json' with { type: 'json' }

const executable = process.env['TLC_VSCODE_EXECUTABLE'] ??
    join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe')

test('actual VS Code webview and foreground hotkey insert real offline recordings', async () => {
    test.skip(process.platform !== 'win32' || !existsSync(executable), 'Requires a locally installed Windows VS Code.')
    test.setTimeout(120_000)
    const directory = await mkdtemp(join(tmpdir(), 'tlc-real-vscode-voice-'))
    const extensions = join(directory, 'extensions')
    const profile = join(directory, 'profile')
    await mkdir(extensions)
    await mkdir(profile)
    const app = await electron.launch({
        executablePath: executable,
        args: [
            '--user-data-dir', profile, '--extensions-dir', extensions,
            `--extensionDevelopmentPath=${resolve('apps', 'vscode-extension')}`,
            `--extensionTestsPath=${resolve('tests', 'electron', 'vscode-voice-bootstrap.cjs')}`,
            '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-workspace-trust', '--new-window'
        ],
        env: {
            ...process.env, TLC_MODE: 'sample', TLC_VOICE_TEST_DIRECTORY: directory,
            TLC_VOICE_TEST_AUDIO: resolve('tests', 'fixtures', 'voice-input', 'recordings', `${statements[0]!.id}.wav`)
        },
        timeout: 60_000
    })
    let bridgeUrl: string | undefined
    try {
        await expect.poll(() => existsSync(join(directory, 'bridge.json')), { timeout: 45_000 }).toBe(true)
        const bridge: { url: string } = JSON.parse(await readFile(join(directory, 'bridge.json'), 'utf8'))
        bridgeUrl = bridge.url
        const page = await app.firstWindow()
        await expect(page).toHaveTitle(/TLC Assist/)
        await expect.poll(() => page.frames().some((frame) => frame.url().includes('/fake.html')), { timeout: 20_000 }).toBe(true)
        const frame = page.frames().find((frame) => frame.url().includes('/fake.html'))
        if (!frame) throw new Error('The real VS Code webview frame is unavailable.')
        const search = frame.getByRole('searchbox', { name: 'Search accounts and opportunities' })
        for (const statement of statements) {
            const response = await fetch(`${bridgeUrl}/audio`, {
                method: 'POST', body: JSON.stringify({
                    inputFile: resolve('tests', 'fixtures', 'voice-input', 'recordings', `${statement.id}.wav`)
                })
            })
            expect(response.ok).toBe(true)
            await search.fill('')
            await search.focus()
            await page.keyboard.press('Control+Alt+m')
            if (await frame.getByRole('dialog', { name: 'Voice search' }).count()) {
                await frame.getByRole('button', { name: 'Start listening', exact: true }).click()
            } else if (statement.id === statements[0]!.id) {
                await frame.getByRole('dialog', { name: 'Voice search' }).waitFor({ timeout: 10_000 })
                await frame.getByRole('button', { name: 'Start listening', exact: true }).click()
            }
            await expect(search).toHaveValue(new RegExp(statement.text, 'i'), { timeout: 20_000 })
            await expect(frame.getByRole('button', { name: 'Stop voice search', exact: true })).toHaveCount(0)
        }
        await search.fill('grid operations')
        await search.press('Enter')
        await expect(search).toHaveValue('')
        await expect(frame.locator('#portfolio-details-panel').getByRole('heading', { name: 'Grid operations modernization', exact: true })).toBeVisible()
    } finally {
        if (bridgeUrl) await fetch(`${bridgeUrl}/finish`).catch(() => undefined)
        await app.close().catch(() => undefined)
        await rm(directory, { recursive: true, force: true })
    }
})
