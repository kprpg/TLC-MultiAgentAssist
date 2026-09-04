import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions
} from 'docx'
import type { Content, PhrasingContent, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { ExportResponseRequest } from '../../../../packages/common/index.js'

const numberingReference = 'agent-response-numbering'
const bulletReference = 'agent-response-bullets'

const listLevels = Array.from({ length: 6 }, (_, level) => ({
  level,
  format: LevelFormat.DECIMAL,
  text: `%${level + 1}.`,
  alignment: AlignmentType.START,
  style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } }
}))

const bulletLevels = ['•', '◦', '▪', '•', '◦', '▪'].map((text, level) => ({
  level,
  format: LevelFormat.BULLET,
  text,
  alignment: AlignmentType.START,
  style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } }
}))

export async function createResponseDocumentBuffer(request: ExportResponseRequest): Promise<Buffer> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(request.responseMarkdown) as Root
  const children: ISectionOptions['children'] = [
    new Paragraph({ text: request.responseTitle, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: `Generated ${new Date(request.generatedAt).toLocaleString('en-US')}`, color: '666666', italics: true })]
    }),
    ...tree.children.flatMap((node) => blockToDocument(node))
  ]
  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Aptos', size: 22, color: '242424' },
          paragraph: { spacing: { after: 120, line: 276 } }
        },
        title: {
          run: { font: 'Aptos Display', size: 36, bold: true, color: '17365D' },
          paragraph: { spacing: { after: 180 } }
        },
        heading1: {
          run: { font: 'Aptos Display', size: 30, bold: true, color: '17365D' },
          paragraph: { spacing: { before: 280, after: 120 }, keepNext: true }
        },
        heading2: {
          run: { font: 'Aptos Display', size: 26, bold: true, color: '24527A' },
          paragraph: { spacing: { before: 240, after: 100 }, keepNext: true }
        },
        heading3: {
          run: { font: 'Aptos', size: 23, bold: true, color: '2F5F85' },
          paragraph: { spacing: { before: 200, after: 80 }, keepNext: true }
        }
      }
    },
    numbering: {
      config: [
        { reference: numberingReference, levels: listLevels },
        { reference: bulletReference, levels: bulletLevels }
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
        }
      },
      children
    }]
  })
  return Packer.toBuffer(document)
}

function blockToDocument(node: Content, listLevel = 0): Array<Paragraph | Table> {
  switch (node.type) {
    case 'heading':
      return [new Paragraph({ heading: headingLevel(node.depth), children: inlineChildren(node.children) })]
    case 'paragraph':
      return [new Paragraph({ children: inlineChildren(node.children), spacing: { after: 120 } })]
    case 'list':
      return node.children.flatMap((item) => item.children.flatMap((child) => {
        if (child.type === 'list') return blockToDocument(child, Math.min(listLevel + 1, 5))
        const children = child.type === 'paragraph' ? inlineChildren(child.children) : [new TextRun(textContent(child))]
        return [new Paragraph({
          children,
          numbering: { reference: node.ordered ? numberingReference : bulletReference, level: listLevel },
          spacing: { after: 60 }
        })]
      }))
    case 'table':
      return [new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: node.children.map((row) => new TableRow({
          children: row.children.map((cell) => new TableCell({
            children: [new Paragraph({ children: inlineChildren(cell.children) })]
          }))
        }))
      })]
    case 'blockquote':
      return node.children.flatMap((child) => blockToDocument(child).map((block) => block instanceof Paragraph
        ? new Paragraph({ children: [new TextRun({ text: textContent(child), italics: true, color: '555555' })], indent: { left: 360 } })
        : block))
    case 'code':
      return [new Paragraph({ children: [new TextRun({ text: node.value, font: 'Consolas' })], shading: { fill: 'F3F4F6' } })]
    case 'thematicBreak':
      return [new Paragraph({ text: '' })]
    default:
      return []
  }
}

function inlineChildren(nodes: readonly PhrasingContent[]): Array<TextRun | ExternalHyperlink> {
  return nodes.flatMap((node): Array<TextRun | ExternalHyperlink> => {
    switch (node.type) {
      case 'text':
        return [new TextRun(node.value)]
      case 'strong':
        return [new TextRun({ text: textContent(node), bold: true })]
      case 'emphasis':
        return [new TextRun({ text: textContent(node), italics: true })]
      case 'delete':
        return [new TextRun({ text: textContent(node), strike: true })]
      case 'inlineCode':
        return [new TextRun({ text: node.value, font: 'Consolas' })]
      case 'break':
        return [new TextRun({ break: 1 })]
      case 'link':
        return /^https:\/\//i.test(node.url)
          ? [new ExternalHyperlink({ link: node.url, children: [new TextRun({ text: textContent(node), style: 'Hyperlink' })] })]
          : [new TextRun(textContent(node))]
      default:
        return [new TextRun(textContent(node))]
    }
  })
}

function textContent(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const candidate = node as { value?: unknown; children?: unknown }
  if (typeof candidate.value === 'string') return candidate.value
  return Array.isArray(candidate.children) ? candidate.children.map(textContent).join('') : ''
}

function headingLevel(depth: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  return [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][depth - 1] ?? HeadingLevel.HEADING_6
}