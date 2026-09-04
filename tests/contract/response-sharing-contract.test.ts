import { describe, expect, it } from 'vitest'
import {
  contractVersion,
  emailComposeRequestSchema,
  exportResponseRequestSchema
} from '../../packages/common/index.js'

describe('response sharing contracts', () => {
  it('rejects malformed recipients and unexpected email compose fields', () => {
    const result = emailComposeRequestSchema.safeParse({
      contractVersion,
      recipients: ['not-an-email'],
      subject: 'Account pulse',
      responseTitle: 'Account Pulse',
      responseMarkdown: 'Response',
      accessToken: 'must-not-cross-ipc'
    })

    expect(result.success).toBe(false)
  })

  it('accepts only the response content and metadata needed for Word export', () => {
    const result = exportResponseRequestSchema.safeParse({
      contractVersion,
      responseTitle: 'Account Pulse',
      responseMarkdown: '## Summary\n\nAct this week.',
      generatedAt: '2026-08-24T12:00:00.000Z'
    })

    expect(result.success).toBe(true)
  })
})