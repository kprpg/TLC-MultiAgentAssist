import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expectWorkingSessionIcon } from '../working-session-icon.js'

// Runs the real Electron app (preload bridge, validated IPC, folder sink) in sample mode. Documents are redirected to a
// temp folder so nothing is written to the user's real Documents.
test('prepares a working session through the Desktop IPC bridge into Documents\\TLC', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'tlc-ws-userdata-'))
    const documents = await mkdtemp(join(tmpdir(), 'tlc-ws-documents-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userData}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_DATA_STORE: 'sqlite', TLC_UI_MODE: '', TLC_DOCUMENTS_FOLDER: documents }
    })
    try {
        const window = await app.firstWindow()
        await window.setViewportSize({ width: 1400, height: 900 })
        await window.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
        const blade = window.getByRole('region', { name: 'Opportunities blade' })
        await blade.getByRole('button', { name: /^Grid operations modernization/ }).click()
        const launcher = blade.locator('.blade-header').getByRole('button', { name: 'Generate Prep/ Delivery Artifacts' })
        await expectWorkingSessionIcon(launcher)
        await launcher.click()
        const panel = window.getByRole('dialog', { name: 'Prepare working session' })

        await panel.getByRole('button', { name: 'Suggest topic' }).click()
        await expect(panel.getByRole('textbox', { name: 'Topic' })).not.toHaveValue('')
        await panel.getByRole('textbox', { name: 'Topic' }).fill('Grid analytics proof of concept')
        await panel.getByRole('button', { name: 'Prepare' }).click()
        await expect(panel.getByText(/Prepared \d+ file/)).toBeVisible()
        await expect(panel.getByRole('button', { name: 'Open folder' })).toBeVisible()
        await expect(panel.getByText(/Saved to .*TLC/)).toBeVisible()

        const [folderName] = await readdir(join(documents, 'TLC'))
        expect(folderName).toBe('Grid operations modernization - Customer outcome validation')
        const files = (await readdir(join(documents, 'TLC', folderName!), { recursive: true })).map(String)
        expect(files).toEqual(expect.arrayContaining(['README.md', 'manifest.json', join('iac', 'main.bicep')]))
        expect(await readFile(join(documents, 'TLC', folderName!, 'README.md'), 'utf8')).toContain('Grid analytics proof of concept')

        // The renderer cannot ask the main process to open a folder outside Documents\TLC.
        const refused = await window.evaluate(async (path) => {
            const bridge = (window as unknown as { tlc: { openWorkingSessionFolder(path: string): Promise<void> } }).tlc
            try { await bridge.openWorkingSessionFolder(path); return 'opened' } catch (error) { return (error as Error).message }
        }, 'C:\\Windows')
        expect(refused).toContain('Documents')
    } finally {
        await app.close().catch(() => undefined)
        await rm(userData, { recursive: true, force: true })
        await rm(documents, { recursive: true, force: true })
    }
})
