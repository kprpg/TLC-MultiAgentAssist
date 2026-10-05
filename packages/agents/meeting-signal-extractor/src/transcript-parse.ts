/**
 * Transcript parsing for *actual* meeting recordings.
 *
 * Phase 1 testing uses a real recording's transcript (uploaded or pasted) against the
 * SQLite opportunity/milestone store. This converts WebVTT (what Microsoft Graph returns
 * for Teams meeting transcripts) or a simple `Speaker: text` paste into the canonical
 * `MeetingTranscript` the extractor consumes. Phase 2 (live Graph) reuses the same shape.
 */
import { meetingTranscriptSchema, type MeetingTranscript, type MeetingTranscriptSegment, type MeetingType } from '../../../common/index.js'

export interface ParseTranscriptOptions {
    id?: string
    opportunityId?: string
    meetingType?: MeetingType
    title?: string
    /** Force a format; otherwise it is auto-detected. */
    format?: 'vtt' | 'text'
}

function parseTimestampMs(stamp: string): number | undefined {
    const m = stamp.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/)
    if (!m || m[2] === undefined || m[3] === undefined) return undefined
    const hours = m[1] ? Number(m[1]) : 0
    const minutes = Number(m[2])
    const seconds = Number(m[3])
    const millis = m[4] ? Number(m[4].padEnd(3, '0')) : 0
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis
}

/** Strips WebVTT speaker voice tags: `<v Priya Nair>text</v>` -> `{ speaker, text }`. */
function extractVoiceTag(line: string): { speaker?: string; text: string } {
    const voice = line.match(/^<v\s+([^>]+)>(.*)$/i)
    if (voice && voice[1] !== undefined) return { speaker: voice[1].trim(), text: (voice[2] ?? '').replace(/<\/v>\s*$/i, '').trim() }
    const colon = line.match(/^([A-Z][\w .'-]{1,60}?):\s+(.*)$/)
    if (colon && colon[1] !== undefined) return { speaker: colon[1].trim(), text: (colon[2] ?? '').trim() }
    return { text: line.trim() }
}

function parseVtt(raw: string): Array<Omit<MeetingTranscriptSegment, 'segmentId'>> {
    const lines = raw.replace(/\r/g, '').split('\n')
    const segments: Array<Omit<MeetingTranscriptSegment, 'segmentId'>> = []
    let startMs: number | undefined
    let endMs: number | undefined
    let buffer: string[] = []

    const flush = (): void => {
        if (buffer.length === 0) return
        const joined = buffer.join(' ').trim()
        if (joined) {
            const { speaker, text } = extractVoiceTag(joined)
            if (text) {
                segments.push({
                    text,
                    ...(startMs !== undefined ? { startMs } : {}),
                    ...(endMs !== undefined ? { endMs } : {}),
                    ...(speaker ? { speaker } : {})
                })
            }
        }
        buffer = []
        startMs = undefined
        endMs = undefined
    }

    for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '' ) { flush(); continue }
        if (/^WEBVTT/i.test(trimmed) || /^NOTE\b/i.test(trimmed)) continue
        const cue = trimmed.match(/^([\d:.]+)\s*-->\s*([\d:.]+)/)
        if (cue && cue[1] !== undefined && cue[2] !== undefined) {
            flush()
            startMs = parseTimestampMs(cue[1])
            endMs = parseTimestampMs(cue[2])
            continue
        }
        // A bare cue identifier (number or GUID) on its own line: ignore.
        if (buffer.length === 0 && startMs === undefined && /^[\w-]+$/.test(trimmed) && !/\s/.test(trimmed)) continue
        buffer.push(trimmed)
    }
    flush()
    return segments
}

function parsePlainText(raw: string): Array<Omit<MeetingTranscriptSegment, 'segmentId'>> {
    return raw
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const { speaker, text } = extractVoiceTag(line)
            return { text, ...(speaker ? { speaker } : {}) }
        })
        .filter((seg) => seg.text.length > 0)
}

/** Parses a raw transcript (WebVTT or `Speaker: text`) into a validated `MeetingTranscript`. */
export function parseTranscriptContent(raw: string, options: ParseTranscriptOptions = {}): MeetingTranscript {
    const looksLikeVtt = options.format === 'vtt' || (options.format !== 'text' && (/^\uFEFF?WEBVTT/i.test(raw.trimStart()) || /-->/.test(raw)))
    const rawSegments = looksLikeVtt ? parseVtt(raw) : parsePlainText(raw)
    const segments: MeetingTranscriptSegment[] = rawSegments.map((seg, index) => ({ segmentId: `seg-${index + 1}`, ...seg }))

    const transcript = {
        id: options.id ?? `upload-${Date.now()}`,
        meetingType: options.meetingType ?? 'customer',
        source: 'upload' as const,
        segments,
        ...(options.opportunityId ? { opportunityId: options.opportunityId } : {}),
        ...(options.title ? { title: options.title } : {})
    }
    return meetingTranscriptSchema.parse(transcript)
}
