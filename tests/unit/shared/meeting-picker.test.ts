import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatMeetingOption, MeetingPicker, meetingListFailure, sortMeetingsNewestFirst, type MeetingListState, type MeetingPickerItem } from '../../../apps/shared/meeting-picker.js'

const base: MeetingPickerItem = { id: 'gm_1', subject: 'Arc review', occurredAt: '2026-10-23T14:05:00.000Z', meetingType: 'customer' }
const render = (list: Partial<MeetingListState<MeetingPickerItem>>, selectedId = '') => renderToStaticMarkup(createElement(MeetingPicker<MeetingPickerItem>, {
  list: { status: 'ready', items: [], error: '', refresh: () => undefined, ...list }, selectedId, onSelect: () => undefined, format: { locale: 'en-US', timeZone: 'UTC' }
}))

describe('meeting option labels', () => {
  it('shows the title, date and time, and classification for a calendar meeting', () => {
    expect(formatMeetingOption(base, { locale: 'en-US', timeZone: 'UTC' })).toBe('Arc review - Fri, Oct 23, 2:05 PM (customer)')
  })
  it('adds the line count only when the transcript is already known', () => {
    expect(formatMeetingOption({ ...base, segmentCount: 12 }, { locale: 'en-US', timeZone: 'UTC' })).toBe('Arc review - Fri, Oct 23, 2:05 PM (customer, 12 lines)')
    expect(formatMeetingOption({ ...base, segmentCount: 0 }, { locale: 'en-US', timeZone: 'UTC' })).toContain('0 lines')
  })
  it('tolerates an unparseable date rather than throwing', () => {
    expect(formatMeetingOption({ ...base, occurredAt: 'not a date' })).toBe('Arc review (customer)')
  })
  it('orders newest first and leaves the input untouched', () => {
    const input = [{ ...base, id: 'a', occurredAt: '2026-10-20T10:00:00.000Z' }, { ...base, id: 'b', occurredAt: '2026-10-23T10:00:00.000Z' }]
    expect(sortMeetingsNewestFirst(input).map((item) => item.id)).toEqual(['b', 'a'])
    expect(input.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('meeting list failures', () => {
  it('removes Electron and error-class prefixes so every surface shows the same sentence', () => {
    const message = 'Microsoft Graph did not allow access. You can still use Paste / upload.'
    expect(meetingListFailure(new Error(`Error invoking remote method 'tlc:list-meeting-transcripts': MeetingSourceError: ${message}`))).toBe(message)
    expect(meetingListFailure(new Error(message))).toBe(message)
    expect(meetingListFailure('plain text')).toBe('plain text')
  })
  it('falls back to a safe sentence for an empty failure', () => {
    expect(meetingListFailure(new Error(''))).toContain('Paste / upload')
  })
})

describe('Teams meeting picker rendering', () => {
  it('renders a combobox named Meeting with a dated option per meeting and the import hint', () => {
    const html = render({ items: [base, { ...base, id: 'gm_2', subject: 'Internal sync', meetingType: 'internal', occurredAt: '2026-10-22T09:00:00.000Z' }] }, 'gm_1')
    expect(html).toContain('<label class="meeting-field">Meeting')
    expect(html).toContain('<option value="gm_1" selected="">Arc review - Fri, Oct 23, 2:05 PM (customer)</option>')
    expect(html).toContain('Internal sync - Thu, Oct 22, 9:00 AM (internal)')
    expect(html).toContain('imported from Teams when you choose Extract &amp; Review')
    expect(html).toContain('Refresh meetings')
  })
  it('omits the import hint for transcripts that are already stored locally', () => {
    expect(render({ items: [{ ...base, segmentCount: 8 }] }, 'gm_1')).not.toContain('imported from Teams')
  })
  it('shows progress, an explained failure with retry, or the empty state, never a silent blank', () => {
    expect(render({ status: 'loading' })).toContain('Loading your recent Teams meetings')
    const failed = render({ status: 'error', error: 'Microsoft Graph did not allow access.' })
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('Microsoft Graph did not allow access.')
    expect(failed).toContain('Try again')
    expect(render({ items: [] })).toContain('No linked meeting transcripts. Use Paste / upload.')
  })
  it('renders meeting titles as text, never markup', () => {
    const html = render({ items: [{ ...base, subject: '<img src=x onerror=alert(1)>' }] }, 'gm_1')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
