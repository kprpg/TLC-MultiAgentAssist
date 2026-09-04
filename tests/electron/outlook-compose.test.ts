import { describe, expect, it } from 'vitest'
import { contractVersion, type EmailComposeRequest } from '../../packages/common/index.js'
import { createOutlookComposeUri, markdownToEmailText } from '../../apps/desktop/electron/main/outlook-compose.js'

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

  it('rejects content too large for a reliable compose URI', () => {
    expect(() => createOutlookComposeUri({
      ...request,
      responseMarkdown: 'x'.repeat(20_000)
    })).toThrow('The response is too long to open in Outlook. Export it to Word instead.')
  })
})