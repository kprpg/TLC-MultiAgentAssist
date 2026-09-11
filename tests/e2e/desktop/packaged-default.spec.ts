import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('a fresh packaged install seeds the shared Foundry default and opens the application', async () => {
    const executablePath = process.env['TLC_PACKAGED_APP_PATH']
    test.skip(!executablePath, 'Set TLC_PACKAGED_APP_PATH to a packaged desktop executable.')
    if (!executablePath) return
    test.setTimeout(60_000)

    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-packaged-default-'))
    const app = await electron.launch({
        executablePath,
        args: [`--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample' }
    })

    try {
        const window = await app.firstWindow()
        await expect(window).toHaveTitle('TLC Account Team Intelligence | Desktop')
        await expect(window.getByText('DESKTOP · CONNECTED DATA')).toBeVisible()
        await expect(window.getByRole('region', { name: 'Accounts blade' })).toBeVisible()

        const [seededContent, defaultContent] = await Promise.all([
            readFile(join(userDataDirectory, 'foundry.environment.json'), 'utf8'),
            readFile(resolve('config/foundry.environment.default.json'), 'utf8')
        ])
        expect(JSON.parse(seededContent)).toEqual(JSON.parse(defaultContent))
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})