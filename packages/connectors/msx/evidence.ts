import type { EvidenceEntry } from '../common/index.js'

const entities: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" }

/** Collapses Dataverse rich text (notes and comments may contain HTML) to bounded plain text. */
export function plainText(value: unknown, limit = 4_000): string {
  if (typeof value !== 'string') return ''
  const text = value
    .replace(/<\s*(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, (entity) => entities[entity] ?? entity)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export interface CommentHistoryRow {
  comment: string
  modifiedOn?: string
  userId?: string
}

/**
 * Parses an MSX `msp_forecastcommentsjsonfield` value, a JSON array of
 * `{ userId, modifiedOn, comment }`. Unparseable or empty values yield no rows.
 */
export function parseCommentHistoryRows(raw: unknown): CommentHistoryRow[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  const items = Array.isArray(parsed) ? parsed : []
  const rows: CommentHistoryRow[] = []
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const { comment, modifiedOn, userId } = item as Record<string, unknown>
    const text = plainText(comment)
    if (!text) continue
    const at = isoTimestamp(modifiedOn)
    rows.push({
      comment: text,
      ...(at ? { modifiedOn: at } : {}),
      ...(typeof userId === 'string' && userId ? { userId } : {})
    })
  }
  return rows
}

export function commentHistoryEntries(rows: readonly CommentHistoryRow[], authorOf: (userId: string) => string | undefined, limit: number): EvidenceEntry[] {
  return rows
    .map((row): EvidenceEntry => ({
      kind: 'forecast-comment',
      text: row.comment,
      ...(row.modifiedOn ? { at: row.modifiedOn } : {}),
      ...(row.userId && authorOf(row.userId) ? { author: authorOf(row.userId)! } : {})
    }))
    .sort(newestFirst)
    .slice(0, limit)
}

export function newestFirst(left: { at?: string }, right: { at?: string }): number {
  return (right.at ?? '').localeCompare(left.at ?? '')
}

/** Normalizes a Dataverse timestamp to a canonical ISO string so entries sort lexically. */
export function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}
