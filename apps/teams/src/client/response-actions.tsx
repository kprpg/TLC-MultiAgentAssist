import { useState } from 'react'
import { contractVersion, emailComposeRequestSchema, exportResponseRequestSchema } from '../../../../packages/common/contracts/index.js'
import type { TeamsApiClient } from './data-client.js'

export function ResponseActions({ client, opportunityId, title, markdown, generatedAt }: {
  client: TeamsApiClient; opportunityId: string; title: string; markdown: string; generatedAt: string
}) {
  const [recipients, setRecipients] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function download(email: boolean) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const common = { contractVersion, responseTitle: title, responseMarkdown: markdown }
      if (email) {
        const addresses = recipients.split(/[;,]/).map((item) => item.trim()).filter(Boolean)
        if (!emailComposeRequestSchema.shape.recipients.safeParse(addresses).success) {
          throw new Error('Enter 1 to 20 valid email addresses, separated by commas or semicolons.')
        }
        const draft = emailComposeRequestSchema.parse({
          ...common, recipients: addresses, subject: title
        })
        await client.download('documents/email', { opportunityId, draft }, 'TLC-reviewed-draft.eml')
      } else {
        const document = exportResponseRequestSchema.parse({ ...common, generatedAt })
        await client.download('documents/export', { opportunityId, document }, 'TLC-response.docx')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <div className="response-actions" role="group" aria-label="Response exports" aria-busy={busy}>
    <button type="button" disabled={busy} onClick={() => { void download(false) }}>Export Word</button>
    <label className="field">Email draft recipients<input type="text" value={recipients} disabled={busy} placeholder="reviewer@example.com" onChange={(event) => setRecipients(event.target.value)} /></label>
    <button type="button" disabled={busy || !recipients.trim()} onClick={() => { void download(true) }}>Download unsent email draft</button>
    {error && <p role="alert" className="error-banner">{error}</p>}
  </div>
}
