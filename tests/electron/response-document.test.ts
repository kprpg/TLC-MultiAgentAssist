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
      responseMarkdown: '## Summary\n\n**Priority:** Act now.\n\n[Open opportunity in MSX](https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=opp-1)\n\n1. Confirm owner\n2. Schedule review\n\n- First signal\n  - Supporting evidence\n\n| Owner | Action |\n| --- | --- |\n| AE | Confirm |\n\n[Open evidence](https://example.com/evidence)'
    })
    const archive = await JSZip.loadAsync(buffer)
    const documentXml = await archive.file('word/document.xml')!.async('string')
    const stylesXml = await archive.file('word/styles.xml')!.async('string')
    const numberingXml = await archive.file('word/numbering.xml')!.async('string')
    const relationshipsXml = await archive.file('word/_rels/document.xml.rels')!.async('string')

    expect(documentXml).toContain('Account Pulse')
    expect(documentXml).toContain('Summary')
    expect(documentXml).toContain('Confirm owner')
    expect(documentXml).toContain('<w:tbl>')
    expect(documentXml).toContain('Open evidence')
    expect(documentXml).toMatch(/<w:pStyle w:val="Title"\/>/)
    expect(documentXml).toMatch(/<w:pStyle w:val="Heading2"\/>/)
    expect(documentXml).toMatch(/<w:b\/>/)
    expect(documentXml.match(/<w:numPr>/g)).toHaveLength(4)
    expect(stylesXml).toMatch(/<w:style[^>]+w:styleId="Title"[\s\S]*?<w:b\/>/)
    expect(stylesXml).toMatch(/<w:style[^>]+w:styleId="Heading2"[\s\S]*?<w:b\/>/)
    expect(numberingXml).toContain('w:val="decimal"')
    expect(numberingXml).toContain('w:val="bullet"')
    expect(relationshipsXml).toContain('https://example.com/evidence')
    expect(relationshipsXml).toContain('https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&amp;etn=opportunity&amp;id=opp-1')
  })
})