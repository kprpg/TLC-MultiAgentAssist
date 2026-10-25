import { contractVersion } from '../common/contracts/index.js'
import { createResponseDocumentBuffer } from './response-document.js'

const maximumMarkdownLength = 190_000

/** Renders Markdown as a Word document with the same renderer used for agent-response exports. */
export async function renderMarkdownDocument(title: string, markdown: string, generatedAt: Date = new Date()): Promise<Uint8Array> {
  const clipped = markdown.length > maximumMarkdownLength ? `${markdown.slice(0, maximumMarkdownLength)}\n\n_Content was shortened to fit the document size limit. See the individual pages._\n` : markdown
  return createResponseDocumentBuffer({ contractVersion, responseTitle: title.slice(0, 255), responseMarkdown: clipped, generatedAt: generatedAt.toISOString() })
}
