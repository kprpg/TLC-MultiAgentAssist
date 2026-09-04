import type { EmailComposeRequest } from '../../../../packages/common/index.js'
import type { BlockContent, Content, ListItem, PhrasingContent, Root, Table } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

const maxComposeUriLength = 16_000
const mimeBoundary = '----tlc-agent-response-boundary'

export function createOutlookDraftMessage(request: EmailComposeRequest): string {
  const textBody = markdownToEmailText(request.responseMarkdown)
  const htmlBody = markdownToEmailHtml(request.responseMarkdown)
  return [
    `To: ${request.recipients.map(sanitizeHeader).join(', ')}`,
    `Subject: ${encodeMimeHeader(request.subject)}`,
    'MIME-Version: 1.0',
    'X-Unsent: 1',
    `Content-Type: multipart/alternative; boundary="${mimeBoundary}"`,
    '',
    `--${mimeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBase64Lines(textBody),
    `--${mimeBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBase64Lines(emailDocument(request.responseTitle, htmlBody)),
    `--${mimeBoundary}--`,
    ''
  ].join('\r\n')
}

export function createOutlookComposeUri(request: EmailComposeRequest): string {
  const recipients = request.recipients.map(encodeURIComponent).join(',')
  const body = markdownToEmailText(request.responseMarkdown)
  const composeUri = `mailto:${recipients}?subject=${encodeURIComponent(request.subject)}&body=${encodeURIComponent(body)}`

  if (composeUri.length > maxComposeUriLength) {
    throw new Error('The response is too long to open in Outlook. Export it to Word instead.')
  }

  return composeUri
}

export function markdownToEmailText(markdown: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  return formatBlocks(tree.children).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

function formatBlocks(nodes: readonly Content[], indent = ''): string[] {
  return nodes.flatMap((node): string[] => {
    switch (node.type) {
      case 'heading': {
        const heading = inlineText(node.children).trim()
        return heading ? [`${heading}\n${headingSeparator(heading, node.depth)}`] : []
      }
      case 'paragraph':
        return [inlineText(node.children).trim()]
      case 'list':
        return [node.children.map((item, index) => formatListItem(item, node.ordered ? `${(node.start ?? 1) + index}.` : '-', indent)).join('\n')]
      case 'table':
        return [formatTable(node)]
      case 'blockquote':
        return [formatBlocks(node.children, `${indent}  `).join('\n\n').split('\n').map((line) => `${indent}  ${line}`).join('\n')]
      case 'code':
        return [node.value.split('\n').map((line) => `${indent}    ${line}`).join('\n')]
      case 'thematicBreak':
        return ['----------------------------------------']
      case 'html':
        return []
      default:
        return []
    }
  }).filter(Boolean)
}

function formatListItem(item: ListItem, marker: string, indent: string): string {
  const [first, ...rest] = item.children
  const firstText = first?.type === 'paragraph'
    ? inlineText(first.children).trim()
    : first
      ? formatBlocks([first], `${indent}  `).join('\n')
      : ''
  const lines = [`${indent}${marker} ${firstText}`]

  for (const child of rest) {
    if (child.type === 'list') {
      lines.push(formatBlocks([child], `${indent}  `).join('\n'))
    } else {
      lines.push(...formatBlocks([child], `${indent}  `).map((line) => `${indent}  ${line}`))
    }
  }

  return lines.join('\n')
}

function formatTable(table: Table): string {
  const rows = table.children.map((row) => row.children.map((cell) => inlineText(cell.children).trim()))
  if (rows.length === 0) return ''
  const columnCount = Math.max(...rows.map((row) => row.length))
  const widths = Array.from({ length: columnCount }, (_, column) => Math.max(3, ...rows.map((row) => row[column]?.length ?? 0)))
  const formatRow = (row: string[]) => row.map((cell, column) => (cell ?? '').padEnd(widths[column] ?? 3)).join(' | ').trimEnd()
  const separator = widths.map((width) => '-'.repeat(width)).join('-+-')
  return [formatRow(rows[0] ?? []), separator, ...rows.slice(1).map(formatRow)].join('\n')
}

function inlineText(nodes: readonly PhrasingContent[]): string {
  return nodes.map((node): string => {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        return node.value
      case 'break':
        return '\n'
      case 'link': {
        const label = inlineText(node.children)
        return label === node.url ? label : `${label} (${node.url})`
      }
      case 'image':
        return node.alt ? `${node.alt} (${node.url})` : node.url
      case 'strong':
      case 'emphasis':
      case 'delete':
        return inlineText(node.children)
      default:
        return textContent(node)
    }
  }).join('')
}

function textContent(node: BlockContent | PhrasingContent): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  return 'children' in node && Array.isArray(node.children)
    ? node.children.map((child) => textContent(child as BlockContent | PhrasingContent)).join('')
    : ''
}

function headingSeparator(heading: string, depth: number): string {
  return (depth === 1 ? '=' : '-').repeat(Math.min(heading.length, 72))
}

export function markdownToEmailHtml(markdown: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  return htmlBlocks(tree.children)
}

function htmlBlocks(nodes: readonly Content[]): string {
  return nodes.map((node): string => {
    switch (node.type) {
      case 'heading':
        return `<h${node.depth}>${inlineHtml(node.children)}</h${node.depth}>`
      case 'paragraph':
        return `<p>${inlineHtml(node.children)}</p>`
      case 'list': {
        const tag = node.ordered ? 'ol' : 'ul'
        const start = node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : ''
        return `<${tag}${start}>${node.children.map((item) => `<li>${htmlBlocks(item.children)}</li>`).join('')}</${tag}>`
      }
      case 'table':
        return `<table><thead><tr>${node.children[0]?.children.map((cell) => `<th>${inlineHtml(cell.children)}</th>`).join('') ?? ''}</tr></thead><tbody>${node.children.slice(1).map((row) => `<tr>${row.children.map((cell) => `<td>${inlineHtml(cell.children)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      case 'blockquote':
        return `<blockquote>${htmlBlocks(node.children)}</blockquote>`
      case 'code':
        return `<pre><code>${escapeHtml(node.value)}</code></pre>`
      case 'thematicBreak':
        return '<hr>'
      default:
        return ''
    }
  }).join('')
}

function inlineHtml(nodes: readonly PhrasingContent[]): string {
  return nodes.map((node): string => {
    switch (node.type) {
      case 'text':
        return escapeHtml(node.value)
      case 'strong':
        return `<strong>${inlineHtml(node.children)}</strong>`
      case 'emphasis':
        return `<em>${inlineHtml(node.children)}</em>`
      case 'delete':
        return `<s>${inlineHtml(node.children)}</s>`
      case 'inlineCode':
        return `<code>${escapeHtml(node.value)}</code>`
      case 'break':
        return '<br>'
      case 'link':
        return /^https:\/\//i.test(node.url)
          ? `<a href="${escapeHtml(node.url)}">${inlineHtml(node.children)}</a>`
          : inlineHtml(node.children)
      case 'image':
        return node.alt ? escapeHtml(node.alt) : ''
      default:
        return escapeHtml(textContent(node))
    }
  }).join('')
}

function emailDocument(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Aptos,Calibri,sans-serif;color:#242424;font-size:11pt;line-height:1.45}h1,h2,h3,h4,h5,h6{color:#17365d;margin:18px 0 8px}h1{font-size:22pt}h2{font-size:17pt}h3{font-size:13pt}p{margin:0 0 10px}li{margin:0 0 5px}table{border-collapse:collapse;margin:12px 0}th,td{border:1px solid #b7c9d6;padding:6px 9px;text-align:left}th{background:#eaf1f6;font-weight:700}blockquote{border-left:3px solid #8aa6b8;margin:12px 0;padding-left:12px;color:#555}code,pre{font-family:Consolas,monospace;background:#f3f4f6}pre{padding:10px;white-space:pre-wrap}a{color:#0563c1}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function encodeMimeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(sanitizeHeader(value), 'utf8').toString('base64')}?=`
}

function encodeBase64Lines(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''
}