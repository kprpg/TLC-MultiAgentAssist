import { describe, expect, it, vi } from 'vitest'
import { GraphMeetingConnector, GraphMeetingError, meetingHandle, mergeMeetingTranscripts, toMeetingSourceError } from '../../../packages/connectors/graph/meetings.js'
import { assertCliTokenCanReadMeetings, MeetingSourceError, meetingSignInFailure } from '../../../packages/connectors/common/meeting-source.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'

const now = new Date('2026-10-24T20:00:00.000Z')
const teams = (suffix: string) => `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${suffix}%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d`
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const vtt = (text: string) => `WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Alex>${text}</v>\n`

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, subject: `Subject ${id}`, isCancelled: false, isOnlineMeeting: true,
    start: { dateTime: '2026-10-23T14:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-10-23T15:00:00.0000000', timeZone: 'UTC' },
    onlineMeeting: { joinUrl: teams(id) },
    attendees: [{ type: 'required', emailAddress: { address: 'me@contoso.com' } }],
    ...overrides
  }
}

function graph(handlers: { events?: unknown[]; profile?: unknown; profileStatus?: number; meetings?: Record<string, unknown>; transcripts?: string[] }) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/v1.0/me/calendarView') return json({ value: handlers.events ?? [] })
    if (url.pathname === '/v1.0/me') return json(handlers.profile ?? { mail: 'me@contoso.com' }, handlers.profileStatus ?? 200)
    if (url.pathname === '/v1.0/me/onlineMeetings') return json({ value: [{ id: 'online-meeting-1' }] })
    if (url.pathname === '/v1.0/me/onlineMeetings/online-meeting-1') return json({ id: 'online-meeting-1', subject: 'Graph subject' })
    if (url.pathname === '/v1.0/me/onlineMeetings/online-meeting-1/transcripts') return json({ value: (handlers.transcripts ?? []).map((_, index) => ({ id: `tr-${index + 1}` })) })
    const transcript = /\/transcripts\/tr-(\d+)\/content$/.exec(url.pathname)
    if (transcript) return new Response(handlers.transcripts?.[Number(transcript[1]) - 1] ?? '', { headers: { 'content-type': 'text/vtt' } })
    return json({ error: { code: 'NotFound' } }, 404)
  })
}

describe('recent Teams meeting listing', () => {
  it('lists only past, active Teams meetings newest first with a stable handle and no join link in the summary data', async () => {
    const fetcher = graph({ events: [
      event('older', { start: { dateTime: '2026-10-20T14:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-20T15:00:00.0000000', timeZone: 'UTC' } }),
      event('newer'),
      event('cancelled', { isCancelled: true }),
      event('not-online', { isOnlineMeeting: false }),
      event('future', { end: { dateTime: '2026-10-25T15:00:00.0000000', timeZone: 'UTC' } }),
      event('zoom', { onlineMeeting: { joinUrl: 'https://zoom.us/j/123' } }),
      event('no-link', { onlineMeeting: null }),
      event('local-zone', { start: { dateTime: '2026-10-23T09:00:00', timeZone: 'Pacific Standard Time' } }),
      { id: 'malformed' }
    ] })
    const meetings = await new GraphMeetingConnector(async () => 'token', fetcher).listRecentMeetings({ now })
    expect(meetings.map((meeting) => meeting.subject)).toEqual(['Subject newer', 'Subject older'])
    expect(meetings[0]).toMatchObject({ handle: meetingHandle('newer'), startsAt: '2026-10-23T14:00:00.000Z', meetingType: 'internal' })
    expect(meetings[0]?.handle).toMatch(/^gm_[A-Za-z0-9_-]{32}$/)
    expect(meetingHandle('newer')).toBe(meetingHandle('newer'))
    expect(meetingHandle('newer')).not.toBe(meetingHandle('older'))
  })

  it('requests a bounded read-only window ordered newest first', async () => {
    const fetcher = graph({ events: [event('one')] })
    await new GraphMeetingConnector(async () => 'token', fetcher).listRecentMeetings({ now, days: 7 })
    const [url, init] = fetcher.mock.calls[0]!
    const request = new URL(String(url))
    expect(request.origin + request.pathname).toBe('https://graph.microsoft.com/v1.0/me/calendarView')
    expect(request.searchParams.get('startDateTime')).toBe('2026-10-17T20:00:00.000Z')
    expect(request.searchParams.get('endDateTime')).toBe('2026-10-24T20:00:00.000Z')
    expect(request.searchParams.get('$orderby')).toBe('start/dateTime desc')
    expect(request.searchParams.get('$top')).toBe('50')
    expect(init?.method ?? 'GET').toBe('GET')
    expect(init?.redirect).toBe('error')
  })

  it('applies the limit and classifies a meeting with an outside attendee as a customer meeting', async () => {
    const events = Array.from({ length: 5 }, (_, index) => event(`m${index}`, {
      start: { dateTime: `2026-10-2${index}T14:00:00`, timeZone: 'UTC' }, end: { dateTime: `2026-10-2${index}T15:00:00`, timeZone: 'UTC' },
      attendees: index === 4 ? [
        { type: 'required', emailAddress: { address: 'me@contoso.com' } },
        { type: 'required', emailAddress: { address: 'buyer@customer.example' } },
        { type: 'resource', emailAddress: { address: 'room@elsewhere.example' } }
      ] : [{ type: 'resource', emailAddress: { address: 'room@elsewhere.example' } }, { type: 'required', emailAddress: { address: 'peer@contoso.com' } }]
    }))
    const meetings = await new GraphMeetingConnector(async () => 'token', graph({ events })).listRecentMeetings({ now, limit: 3 })
    expect(meetings).toHaveLength(3)
    expect(meetings[0]).toMatchObject({ subject: 'Subject m4', meetingType: 'customer' })
    expect(meetings[1]?.meetingType).toBe('internal')
  })

  it('defaults to a customer classification when the signed-in domain cannot be read', async () => {
    const meetings = await new GraphMeetingConnector(async () => 'token', graph({ events: [event('one')], profileStatus: 403 })).listRecentMeetings({ now })
    expect(meetings[0]?.meetingType).toBe('customer')
  })

  it('keeps an empty calendar empty and makes no profile request', async () => {
    const fetcher = graph({ events: [] })
    expect(await new GraphMeetingConnector(async () => 'token', fetcher).listRecentMeetings({ now })).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    [401, 'InvalidAuthenticationToken', 'sign-in-required'],
    [403, 'Forbidden', 'denied'],
    [429, 'TooManyRequests', 'unavailable']
  ])('maps Graph %s to a user-safe %s failure without leaking details', async (status, code, expected) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ error: { code } }, status))
    const failure = await new GraphMeetingConnector(async () => 'secret-token', fetcher).listRecentMeetings({ now }).catch((error: unknown) => toMeetingSourceError(error))
    expect(failure).toBeInstanceOf(MeetingSourceError)
    expect((failure as MeetingSourceError).code).toBe(expected)
    expect((failure as MeetingSourceError).message).toContain('Paste / upload')
    expect((failure as MeetingSourceError).message).not.toContain('secret-token')
  })
})

describe('choosing a recent meeting', () => {
  it('verifies the handle against the current calendar, then reads the meeting and merges multiple transcripts', async () => {
    const fetcher = graph({ events: [event('chosen')], transcripts: [vtt('First part.'), vtt('Second part.')] })
    const transcript = await new GraphMeetingConnector(async () => 'token', fetcher).acquireRecentTranscript(meetingHandle('chosen'), 'opp-1', { now })
    expect(transcript).toMatchObject({ source: 'teams', opportunityId: 'opp-1', title: 'Graph subject', meetingType: 'internal' })
    expect(transcript?.segments.map((segment) => [segment.segmentId, segment.text])).toEqual([['t1-seg-1', 'First part.'], ['t2-seg-1', 'Second part.']])
    const joinFilter = new URL(String(fetcher.mock.calls.find(([url]) => new URL(String(url)).pathname === '/v1.0/me/onlineMeetings')![0])).searchParams.get('$filter')
    expect(joinFilter).toContain(teams('chosen'))
  })

  it('returns a single transcript unchanged', async () => {
    const transcript = await new GraphMeetingConnector(async () => 'token', graph({ events: [event('one')], transcripts: [vtt('Only part.')] })).acquireRecentTranscript(meetingHandle('one'), 'opp', { now })
    expect(transcript?.id).toBe('tr-1')
    expect(transcript?.segments[0]?.segmentId).toBe('seg-1')
  })

  it('returns nothing, not a fabricated transcript, when the meeting has none yet', async () => {
    expect(await new GraphMeetingConnector(async () => 'token', graph({ events: [event('one')], transcripts: [] })).acquireRecentTranscript(meetingHandle('one'), 'opp', { now })).toBeUndefined()
  })

  it.each(['not-a-handle', 'gm_short', `gm_${'a'.repeat(40)}`, `${meetingHandle('x')}/../../`, 'https://evil.example.com'])('rejects a malformed handle %s before any Graph call', async (handle) => {
    const fetcher = graph({})
    await expect(new GraphMeetingConnector(async () => 'token', fetcher).acquireRecentTranscript(handle, 'opp', { now })).rejects.toMatchObject({ code: 'invalid_meeting_handle' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refuses a well-formed handle that is not in the user\'s recent calendar', async () => {
    const fetcher = graph({ events: [event('one')] })
    await expect(new GraphMeetingConnector(async () => 'token', fetcher).acquireRecentTranscript(meetingHandle('someone-elses'), 'opp', { now }))
      .rejects.toMatchObject({ code: 'meeting_not_in_recent_calendar' })
    expect(fetcher.mock.calls.some(([url]) => new URL(String(url)).pathname.includes('onlineMeetings'))).toBe(false)
  })

  it('maps missing consent and organizer-only blocks to explicit, actionable failures', () => {
    expect(toMeetingSourceError(new GraphMeetingError('auth-required', 'delegated_session_unavailable')).code).toBe('sign-in-required')
    expect(toMeetingSourceError(new GraphMeetingError('admin-blocked', 'GraphAccessToTranscriptsDisabled')).code).toBe('admin-blocked')
    expect(toMeetingSourceError(new GraphMeetingError('paused', 'content_budget_exceeded')).code).toBe('too-large')
    expect(toMeetingSourceError(new GraphMeetingError('unsupported', 'meeting_not_in_recent_calendar')).code).toBe('not-found')
    expect(toMeetingSourceError(new Error('boom with a secret')).message).not.toContain('secret')
  })

  it('asks only for the calendar token to list meetings, and for the transcript token only when one is chosen', async () => {
    const purposes: string[] = []
    const connector = new GraphMeetingConnector(async (purpose) => { purposes.push(purpose); return 'token' },
      graph({ events: [event('chosen')], transcripts: [vtt('Only part.')] }))
    await connector.listRecentMeetings({ now })
    expect(new Set(purposes)).toEqual(new Set(['list']))
    purposes.length = 0
    await connector.acquireRecentTranscript(meetingHandle('chosen'), 'opp', { now })
    expect(purposes[0]).toBe('list')
    expect(purposes).toContain('transcript')
  })

  it('lets a host sign-in failure reach the user with its real reason instead of a generic one', async () => {
    const failure = meetingSignInFailure(new Error('AADSTS65001: admin approval is required\n'))
    const connector = new GraphMeetingConnector(async () => { throw failure }, graph({}))
    const error = await connector.listRecentMeetings({ now }).catch((reason: unknown) => reason)
    expect(error).toBe(failure)
    expect(toMeetingSourceError(error).message).toContain('AADSTS65001: admin approval is required')
    expect(toMeetingSourceError(error).message).not.toContain('\n')
  })
})

describe('Azure CLI tokens', () => {
  const token = (scp?: string) => `h.${Buffer.from(JSON.stringify(scp === undefined ? {} : { scp })).toString('base64url')}.s`

  it('are rejected up front when they carry no calendar or transcript scope', () => {
    expect(() => assertCliTokenCanReadMeetings(token('User.Read.All Group.ReadWrite.All'), 'list')).toThrow(expect.objectContaining({ code: 'cli-sign-in' }))
    expect(() => assertCliTokenCanReadMeetings(token('Calendars.Read'), 'transcript')).toThrow(expect.objectContaining({ code: 'cli-sign-in' }))
  })

  it('are accepted when the scope is present, and left for Graph to judge when the token is opaque', () => {
    expect(assertCliTokenCanReadMeetings(token('openid Calendars.Read'), 'list')).toContain('.')
    expect(assertCliTokenCanReadMeetings(token('OnlineMeetingTranscript.Read.All'), 'transcript')).toContain('.')
    expect(assertCliTokenCanReadMeetings('opaque-token', 'list')).toBe('opaque-token')
    expect(assertCliTokenCanReadMeetings(token(), 'list')).toContain('.')
  })
})

describe('merging transcripts', () => {
  const part = (id: string, text: string) => parseTranscriptContent(`Alex: ${text}`, { id, source: 'teams', meetingType: 'customer' })
  it('keeps segment identifiers unique and the combined id deterministic', () => {
    const merged = mergeMeetingTranscripts([part('a', 'one'), part('b', 'two')], 'gm_x')
    expect(merged?.segments.map((segment) => segment.segmentId)).toEqual(['t1-seg-1', 't2-seg-1'])
    expect(mergeMeetingTranscripts([part('a', 'one'), part('b', 'two')], 'gm_x')?.id).toBe(merged?.id)
    expect(mergeMeetingTranscripts([], 'gm_x')).toBeUndefined()
  })
})
