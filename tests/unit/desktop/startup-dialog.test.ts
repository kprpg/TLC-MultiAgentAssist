import { describe, expect, it, vi } from 'vitest'
import { openConfigurationAndExit } from '../../../apps/desktop/electron/main/startup-dialog.js'

describe('openConfigurationAndExit', () => {
    it('waits for Electron readiness before showing the configuration dialog', async () => {
        const calls: string[] = []
        let resolveReady!: () => void
        const ready = new Promise<void>((resolve) => {
            resolveReady = resolve
        })
        const application = {
            whenReady: vi.fn(() => ready),
            quit: vi.fn(() => calls.push('quit'))
        }
        const configurationDialog = {
            showMessageBox: vi.fn(async () => {
                calls.push('dialog')
                return { response: 1 }
            })
        }
        const configurationShell = {
            openPath: vi.fn(async () => ''),
            showItemInFolder: vi.fn()
        }

        const opening = openConfigurationAndExit(
            application,
            configurationDialog,
            configurationShell,
            'C:\\Users\\tester\\foundry.environment.json',
            'The configuration could not be loaded.'
        )

        await Promise.resolve()
        expect(configurationDialog.showMessageBox).not.toHaveBeenCalled()

        resolveReady()
        await opening

        expect(calls).toEqual(['dialog', 'quit'])
        expect(configurationDialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
            detail: expect.stringContaining('C:\\Users\\tester\\foundry.environment.json')
        }))
    })
})