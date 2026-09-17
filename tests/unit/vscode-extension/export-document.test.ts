import { describe, expect, it } from 'vitest'
import { buildExportDocument, exportBlockedReason, sanitizeFileName } from '../../../apps/vscode-extension/src/export-document.js'

describe('vscode-extension export document', () => {
    it('sanitizes titles into safe file names', () => {
        expect(sanitizeFileName('MCEM Coach - Grid operations!')).toBe('mcem-coach-grid-operations')
        expect(sanitizeFileName('   ')).toBe('tlc-export')
        expect(sanitizeFileName('a'.repeat(200)).length).toBeLessThanOrEqual(80)
    })

    it('builds a markdown document with a stable name and header', () => {
        const document = buildExportDocument('Guidance - Contoso', 'Body text', () => '2026-09-15T00:00:00.000Z')
        expect(document.suggestedFileName).toBe('guidance-contoso.md')
        expect(document.body).toContain('# Guidance - Contoso')
        expect(document.body).toContain('Exported 2026-09-15T00:00:00.000Z')
        expect(document.body.trimEnd().endsWith('Body text')).toBe(true)
    })

    it('falls back to a default title when empty', () => {
        const document = buildExportDocument('   ', 'x', () => '2026-09-15T00:00:00.000Z')
        expect(document.suggestedFileName).toBe('tlc-export.md')
        expect(document.body).toContain('# TLC Assist export')
    })

    it('blocks export only in untrusted workspaces', () => {
        expect(exportBlockedReason(true)).toBeUndefined()
        expect(exportBlockedReason(false)).toContain('trusted workspace')
    })
})
