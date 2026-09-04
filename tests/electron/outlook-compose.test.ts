import { describe, expect, it } from 'vitest'
import { contractVersion, type EmailComposeRequest } from '../../packages/common/index.js'
import { createOutlookComposeUri, createOutlookDraftMessage, markdownToEmailHtml, markdownToEmailText } from '../../apps/desktop/electron/main/outlook-compose.js'

const request: EmailComposeRequest = {
  contractVersion,
  recipients: ['alex@example.com', 'casey@example.com'],
  subject: 'Account pulse: Contoso & Fabrikam',
  responseTitle: 'Account Pulse',
  responseMarkdown: '## Summary\n\nReview the customer plan.'
}

describe('Outlook compose URI', () => {
  it('encodes recipients, subject, and body without credentials', () => {
    const uri = createOutlookComposeUri(request)

    expect(uri).toBe('mailto:alex%40example.com,casey%40example.com?subject=Account%20pulse%3A%20Contoso%20%26%20Fabrikam&body=Summary%0A-------%0A%0AReview%20the%20customer%20plan.')
    expect(uri).not.toContain('+')
    expect(uri).not.toContain('token')
  })

  it('formats Markdown as readable email text', () => {
    const text = markdownToEmailText(`## Qualification gaps

- **Customer outcomes** — Missing
  - No supporting KPI was found.
  - Next action: ATS should identify expected outcomes.

| Owner | Action |
| --- | --- |
| Specialist | Validate funding |

[Open opportunity](https://example.com/opportunity)`)

    expect(text).toBe(`Qualification gaps
------------------

- Customer outcomes — Missing
  - No supporting KPI was found.
  - Next action: ATS should identify expected outcomes.

Owner      | Action
-----------+-----------------
Specialist | Validate funding

Open opportunity (https://example.com/opportunity)`)
    expect(text).not.toMatch(/\*\*|##|\| ---/)
  })

  it('creates an unsent HTML email draft with rich Markdown formatting', () => {
    const markdown = '## Summary\n\n**Priority:** Act now.\n\n[Open opportunity in MSX](https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=opp-1)\n\n1. Confirm owner\n2. Schedule review\n\n- First signal\n\n| Owner | Action |\n| --- | --- |\n| AE | Confirm |'
    const message = createOutlookDraftMessage({ ...request, responseMarkdown: markdown })
    const html = markdownToEmailHtml(markdown)

    expect(message).toContain('X-Unsent: 1\r\n')
    expect(message).toContain('Content-Type: multipart/alternative')
    expect(message).toContain('Content-Type: text/html; charset="UTF-8"')
    expect(html).toContain('<h2>Summary</h2>')
    expect(html).toContain('<strong>Priority:</strong>')
    expect(html).toContain('<ol><li>')
    expect(html).toContain('<ul><li>')
    expect(html).toContain('<table>')
    expect(html).toContain('<a href="https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&amp;etn=opportunity&amp;id=opp-1">Open opportunity in MSX</a>')
  })

  it('escapes active HTML and prevents MIME header injection', () => {
    const message = createOutlookDraftMessage({
      ...request,
      subject: 'Review\r\nBcc: attacker@example.com',
      responseMarkdown: '<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))'
    })
    const html = markdownToEmailHtml('<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))')

    expect(message).not.toContain('\r\nBcc:')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
  })

  it('rejects content too large for a reliable compose URI', () => {
    expect(() => createOutlookComposeUri({
      ...request,
      responseMarkdown: 'x'.repeat(20_000)
    })).toThrow('The response is too long to open in Outlook. Export it to Word instead.')
  })
})