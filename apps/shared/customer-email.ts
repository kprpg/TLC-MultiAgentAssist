import type { RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { markdownToEmailText } from '../../packages/documents/outlook-compose.js'
import { formatResponseMarkdown } from './response-markdown.js'

export interface CustomerEmailDraft {
    subject: string
    markdown: string
}

export type CustomerEmailAction =
    | { kind: 'host'; compose(draft: CustomerEmailDraft): Promise<'opened' | 'cancelled'> }
    | { kind: 'recipients'; compose(draft: CustomerEmailDraft, recipients: string[]): Promise<'opened' | 'downloaded'> }

const parser = unified().use(remarkParse).use(remarkGfm)
const emailHeading = /\b(?:e-?mail|customer[- ](?:ready|facing)\s+(?:draft|message|response))\b/i
const internalHeading = /^(?:assumptions?\b|missing (?:data|information)\b|sources?\b|feedback prompt\b|suggested follow-ups?\b|internal\b|review(?:er)? notes?\b|notes? (?:for|to) (?:the )?(?:seller|reviewer)\b|human review\b|cautions?\b)/i

export interface LocatedCustomerEmail {
    draft: CustomerEmailDraft
    /** Offset in formatResponseMarkdown(content) where the customer email ends, always at a block boundary. */
    end: number
}

export function extractCustomerEmail(content: string): CustomerEmailDraft | undefined {
    return locateCustomerEmail(content)?.draft
}

export function locateCustomerEmail(content: string): LocatedCustomerEmail | undefined {
    const markdown = formatResponseMarkdown(content)
    const nodes = parser.parse(markdown).children
    const text = (node: RootContent): string => markdownToEmailText(markdown.slice(node.position?.start.offset, node.position?.end.offset)).split('\n')[0] ?? ''
    const subjectOf = (line: string): string | undefined => markdownToEmailText(line).split('\n')[0]?.match(/^Subject\s*:\s*(.+)$/i)?.[1]?.trim()
    const cleanBody = (value: string): string => value
        .replace(/^\s*(?:\*\*|__)?(?:Body|Email body)(?:\*\*|__)?\s*:(?:\*\*|__)?\s*/i, '')
        .replace(/\n\s*(?:---+|\*\*\*+|___+)\s*$/, '')
        .trim()
    let section: { index: number; depth: number } | undefined

    for (const [index, node] of nodes.entries()) {
        const subjectHeading = node.type === 'heading' && /^Subject\s*:/i.test(text(node))
        if (node.type === 'heading' && !subjectHeading) {
            if (emailHeading.test(text(node))) section = { index, depth: node.depth }
            else if (section && node.depth <= section.depth) section = undefined
        }
        // Agents often present the draft as a quoted block under an email heading.
        const quoted = node.type === 'blockquote' && section !== undefined
        if (node.type !== 'paragraph' && !subjectHeading && !quoted) continue
        const precedingHeading = nodes.slice(0, index).reverse().find((item) => item.type === 'heading')
        if (!section && precedingHeading) continue
        const start = node.position?.start.offset
        const nodeEnd = node.position?.end.offset
        if (start === undefined || nodeEnd === undefined) continue
        if (quoted) {
            const lines = markdown.slice(start, nodeEnd).split('\n').map((line) => line.replace(/^\s*>[ \t]?/, ''))
            for (const [lineIndex, line] of lines.entries()) {
                const subject = subjectOf(line)
                if (!subject) continue
                const body = cleanBody(lines.slice(lineIndex + 1).join('\n'))
                if (markdownToEmailText(body)) return { draft: { subject, markdown: body }, end: nodeEnd }
            }
            continue
        }
        let lineStart = start
        for (const line of markdown.slice(start, nodeEnd).split('\n')) {
            const subject = subjectOf(line)
            if (subject) {
                const end = nodes.slice(index + 1).find((item) => item.type === 'heading' &&
                    (internalHeading.test(text(item)) || (section !== undefined && item.depth <= section.depth)))?.position?.start.offset
                const body = cleanBody(markdown.slice(lineStart + line.length, end))
                if (markdownToEmailText(body)) return { draft: { subject, markdown: body }, end: end ?? markdown.length }
            }
            lineStart += line.length + 1
        }
    }
    return undefined
}

export function customerEmailHasPlaceholders(draft: CustomerEmailDraft): boolean {
    return /\[[^\]\n]*\s[^\]\n]*\](?!\()/.test(markdownToEmailText(draft.markdown))
}

export function customerEmailCopyText(draft: CustomerEmailDraft): string {
    return `Subject: ${draft.subject}\n\n${markdownToEmailText(draft.markdown)}`
}
