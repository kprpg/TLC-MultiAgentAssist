import type { ReviewMarks } from './stage-pipeline-analysis.js'

const storageKey = 'tlc.stagePipelineReview.marks.v1'

export const emptyMarks: ReviewMarks = { focus: new Set(), reviewed: new Set() }

function ids(value: unknown): Set<string> {
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 5_000) : [])
}

export function loadMarks(): ReviewMarks {
    try {
        const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? 'null')
        if (parsed && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>
            return { focus: ids(record.focus), reviewed: ids(record.reviewed) }
        }
    } catch {
        // Browser storage may be unavailable or corrupt; marks then start empty.
    }
    return emptyMarks
}

export function saveMarks(marks: ReviewMarks): void {
    try {
        globalThis.localStorage?.setItem(storageKey, JSON.stringify({ focus: [...marks.focus], reviewed: [...marks.reviewed] }))
    } catch {
        // Marks remain in memory for this session when storage is unavailable.
    }
}

export function toggleMark(marks: ReviewMarks, kind: keyof ReviewMarks, id: string): ReviewMarks {
    const next = new Set(marks[kind])
    if (!next.delete(id)) next.add(id)
    return { ...marks, [kind]: next }
}
