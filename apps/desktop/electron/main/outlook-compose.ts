import type { EmailComposeRequest } from '../../../../packages/common/index.js'

const maxComposeUriLength = 16_000

export function createOutlookComposeUri(request: EmailComposeRequest): string {
  const recipients = request.recipients.map(encodeURIComponent).join(',')
  const query = new URLSearchParams({
    subject: request.subject,
    body: request.responseMarkdown
  })
  const composeUri = `mailto:${recipients}?${query.toString()}`

  if (composeUri.length > maxComposeUriLength) {
    throw new Error('The response is too long to open in Outlook. Export it to Word instead.')
  }

  return composeUri
}