import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { contractVersion } from '../../packages/common/index.js'
import { createResponseDocumentBuffer } from '../../apps/desktop/electron/main/response-document.js'

describe('createResponseDocumentBuffer', () => {
  it('creates a valid Word document with structured Markdown content', async () => {
    const buffer = await createResponseDocumentBuffer({
      contractVersion,
      responseTitle: 'Account Pulse',
      generatedAt: '2026-08-24T12:00:00.000Z',
      responseMarkdown: '## Summary\n\n**Priority:** Act now.\n\n1. Confirm owner\n2. Schedule review\n\n| Owner | Action |\n| --- | --- |\n| AE | Confirm |\n\n[Open evidence](https://example.com/evidence)'
    })
    const archive = await JSZip.loadAsync(buffer)
    const documentXml = await archive.file('word/document.xml')!.async('string')
    const relationshipsXml = await archive.file('word/_rels/document.xml.rels')!.async('string')

    expect(documentXml).toContain('Account Pulse')
    expect(documentXml).toContain('Summary')
    expect(documentXml).toContain('Confirm owner')
    expect(documentXml).toContain('<w:tbl>')
    expect(documentXml).toContain('Open evidence')
    expect(relationshipsXml).toContain('https://example.com/evidence')
  })
})