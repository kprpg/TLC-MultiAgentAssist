import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

/** The fields every surface needs to present a meeting choice; structural so browser-only bundles can use it. */
export interface MeetingPickerItem {
    id: string
    subject: string
    occurredAt: string
    meetingType: string
    segmentCount?: number | undefined
}

export interface MeetingFormatOptions { locale?: string | undefined; timeZone?: string | undefined }

/** `Subject - Fri, Oct 23, 2:00 PM (customer)`, plus the line count when the transcript is already known. */
export function formatMeetingOption(item: MeetingPickerItem, options: MeetingFormatOptions = {}): string {
    const when = new Date(item.occurredAt)
    const stamp = Number.isNaN(when.getTime()) ? '' : new Intl.DateTimeFormat(options.locale, {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        ...(options.timeZone ? { timeZone: options.timeZone } : {})
    }).format(when)
    const detail = [item.meetingType, item.segmentCount === undefined ? undefined : `${item.segmentCount} lines`].filter(Boolean).join(', ')
    return `${item.subject}${stamp ? ` - ${stamp}` : ''}${detail ? ` (${detail})` : ''}`
}

export function sortMeetingsNewestFirst<T extends MeetingPickerItem>(items: readonly T[]): T[] {
    return [...items].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || left.subject.localeCompare(right.subject))
}

/** Removes transport prefixes such as Electron's "Error invoking remote method '...': Error:" from a failure. */
export function meetingListFailure(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error)
    const message = raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(?:[A-Za-z]+Error):\s*/, '').trim()
    return message || 'The Teams meeting list could not be loaded. Use Paste / upload.'
}

export interface MeetingListState<T extends MeetingPickerItem> {
    status: 'idle' | 'loading' | 'ready' | 'error'
    items: T[]
    error: string
    refresh: () => void
}

/**
 * Loads the picker list only while the Teams-meeting tab is showing, so a live host asks for Graph
 * consent in response to a user action rather than whenever an opportunity is selected.
 */
export function useMeetingList<T extends MeetingPickerItem>(
    load: () => Promise<T[]>,
    enabled: boolean,
    resetKey: string,
    onLoaded?: (items: T[]) => void
): MeetingListState<T> {
    const [state, setState] = useState<{ status: MeetingListState<T>['status']; items: T[]; error: string }>({ status: 'idle', items: [], error: '' })
    const [reload, setReload] = useState(0)
    const loader = useRef(load)
    const notify = useRef(onLoaded)
    loader.current = load
    notify.current = onLoaded

    useEffect(() => { setState({ status: 'idle', items: [], error: '' }) }, [resetKey])
    useEffect(() => {
        if (!enabled) return
        let current = true
        setState((previous) => ({ ...previous, status: 'loading', error: '' }))
        loader.current().then((items) => {
            if (!current) return
            const sorted = sortMeetingsNewestFirst(items)
            setState({ status: 'ready', items: sorted, error: '' })
            notify.current?.(sorted)
        }).catch((error: unknown) => {
            if (current) setState({ status: 'error', items: [], error: meetingListFailure(error) })
        })
        return () => { current = false }
    }, [enabled, resetKey, reload])

    const refresh = useCallback(() => setReload((value) => value + 1), [])
    return { ...state, refresh }
}

/** The "Teams meeting" tab body: loading, an explained failure, an empty state, or the meeting dropdown. */
export function MeetingPicker<T extends MeetingPickerItem>({ list, selectedId, onSelect, format, placeholder, disabled = false, labelClassName = 'meeting-field' }: {
    list: MeetingListState<T>
    selectedId: string
    onSelect: (id: string) => void
    format?: MeetingFormatOptions
    /** Adds a leading empty choice, for surfaces where choosing a meeting immediately starts the import. */
    placeholder?: string
    disabled?: boolean
    labelClassName?: string
}): ReactElement {
    if (list.status === 'loading' || list.status === 'idle') return <p className="muted" role="status">Loading your recent Teams meetings...</p>
    if (list.status === 'error') {
        return (
            <div className="meeting-picker-problem">
                <p className="error" role="alert">{list.error}</p>
                <button type="button" className="secondary" onClick={list.refresh}>Try again</button>
            </div>
        )
    }
    if (list.items.length === 0) return <p className="muted">No linked meeting transcripts. Use Paste / upload.</p>
    const importsOnExtract = list.items.some((item) => item.segmentCount === undefined)
    return (
        <div className="meeting-picker">
            <label className={labelClassName}>Meeting
                <select value={selectedId} disabled={disabled} onChange={(event) => onSelect(event.target.value)}>
                    {placeholder !== undefined && <option value="">{placeholder}</option>}
                    {list.items.map((item) => <option key={item.id} value={item.id}>{formatMeetingOption(item, format)}</option>)}
                </select>
            </label>
            {importsOnExtract && <p className="muted meeting-picker-hint">{placeholder !== undefined
                ? 'The transcript is imported from Teams as soon as you choose a meeting.'
                : 'The transcript is imported from Teams when you choose Extract & Review.'}</p>}
            <button type="button" className="secondary meeting-picker-refresh" disabled={disabled} onClick={list.refresh}>Refresh meetings</button>
        </div>
    )
}
