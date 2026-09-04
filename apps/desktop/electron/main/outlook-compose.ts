import type { EmailComposeRequest } from '../../../../packages/common/index.js'
import type { BlockContent, Content, ListItem, PhrasingContent, Root, Table } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

const maxComposeUriLength = 16_000

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