import { describe, expect, it } from 'vitest'
import { contractVersion, type EmailComposeRequest } from '../../packages/common/index.js'
import { createOutlookComposeUri } from '../../apps/desktop/electron/main/outlook-compose.js'

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

    expect(uri).toBe('mailto:alex%40example.com,casey%40example.com?subject=Account+pulse%3A+Contoso+%26+Fabrikam&body=%23%23+Summary%0A%0AReview+the+customer+plan.')
    expect(uri).not.toContain('token')
  })

  it('rejects content too large for a reliable compose URI', () => {
    expect(() => createOutlookComposeUri({
      ...request,
      responseMarkdown: 'x'.repeat(20_000)
    })).toThrow('The response is too long to open in Outlook. Export it to Word instead.')
  })
})