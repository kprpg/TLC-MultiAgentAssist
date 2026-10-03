import { describe, expect, it, vi } from 'vitest'
import { showResponseSaveDialog } from '../../apps/desktop/electron/main/response-save-dialog.js'

describe('showResponseSaveDialog', () => {
    it('attaches the Word export dialog to the requesting Desktop window', async () => {
        const parent = { id: 42 }
        const showDialog = vi.fn().mockResolvedValue({ canceled: false, filePath: 'C:\\Exports\\guidance.docx' })

        await expect(showResponseSaveDialog(parent, 'Account guidance.docx', showDialog)).resolves.toEqual({
            canceled: false,
            filePath: 'C:\\Exports\\guidance.docx'
        })

        expect(showDialog).toHaveBeenCalledWith({
            title: 'Export agent response',
            defaultPath: 'Account guidance.docx',
            filters: [{ name: 'Microsoft Word document', extensions: ['docx'] }],
            properties: ['createDirectory', 'showOverwriteConfirmation']
        }, parent)
    })
})