import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('opens Sample beside an occupied default profile without cache errors and preserves its browser state', async () => {
    test.setTimeout(60_000)
    const executablePath = process.env['TLC_PACKAGED_APP_PATH']
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-session-cache-'))
    const cacheOwnerFile = join(userDataDirectory, 'cache-owner.cjs')
    const applications: ElectronApplication[] = []

    try {
        await writeFile(cacheOwnerFile, `
const { app, BrowserWindow } = require('electron')
app.whenReady().then(async () => {
    const window = new BrowserWindow()
    await window.loadURL('data:text/html,<title>Default profile cache owner</title>')
})
app.on('window-all-closed', () => app.quit())
`, 'utf8')
        const cacheOwner = await electron.launch({
            args: [cacheOwnerFile, `--user-data-dir=${userDataDirectory}`]
        })
        applications.push(cacheOwner)
        await expect(await cacheOwner.firstWindow()).toHaveTitle('Default profile cache owner')
        expect(await cacheOwner.evaluate(({ app }) => app.getPath('sessionData'))).toBe(userDataDirectory)

        for (const attempt of [0, 1]) {
            const logFile = join(userDataDirectory, `sample-chromium-${attempt}.log`)
            const sample = await electron.launch({
                ...(executablePath ? { executablePath } : {}),
                args: [
                    ...(executablePath ? [] : [resolve('apps', 'desktop')]),
                    `--user-data-dir=${userDataDirectory}`,
                    '--enable-logging=file',
                    `--log-file=${logFile}`
                ],
                env: {
                    ...process.env,
                    TLC_DATA_MODE: 'sample',
                    TLC_DATA_STORE: 'fixture',
                    TLC_DATA_STORE_PATH: '',
                    TLC_UI_MODE: ''
                }
            })
            applications.push(sample)
            const window = await sample.firstWindow()
            expect(await sample.evaluate(({ app }) => ({
                userData: app.getPath('userData'),
                sessionData: app.getPath('sessionData')
            }))).toEqual({
                userData: userDataDirectory,
                sessionData: join(userDataDirectory, 'sample-session')
            })
            await expect(window.getByRole('navigation', { name: 'Primary tabs' })).toBeVisible()

            if (attempt === 0) {
                await window.evaluate(() => localStorage.setItem('tlc-cache-regression', 'preserved'))
            } else {
                expect(await window.evaluate(() => localStorage.getItem('tlc-cache-regression'))).toBe('preserved')
            }
            await sample.close()
            applications.pop()
            const chromiumLog = await readFile(logFile, 'utf8')
            expect(chromiumLog).not.toMatch(/Unable to move the cache|Unable to create cache|Gpu Cache Creation failed/i)
        }
    } finally {
        try {
            await Promise.all(applications.map((application) => application.close()))
        } finally {
            await rm(userDataDirectory, { recursive: true, force: true })
        }
    }
})
