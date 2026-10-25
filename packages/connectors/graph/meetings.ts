import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { MeetingTranscript, MeetingType } from '../../common/contracts/meeting.js'
import { transcriptMaximumSegments } from '../../common/contracts/meeting.js'
import { recentMeetingLimit, recentMeetingWindowDays, type MeetingTokenPurpose } from '../../common/configuration/meeting-sources.js'
import { parseTranscriptContent } from '../../agents/meeting-signal-extractor/src/transcript-parse.js'
import { readBoundedText, ResponseSizeError } from '../common/http-response.js'
import { meetingSourceError, MeetingSourceError } from '../common/meeting-source.js'

export type GraphFailureState = 'denied' | 'admin-blocked' | 'auth-required' | 'unsupported' | 'paused'
export class GraphMeetingError extends Error {
  constructor(readonly state: GraphFailureState, readonly code: string) {
    super(`Meeting transcript acquisition is ${state} (${code}).`)
    this.name = 'GraphMeetingError'
  }
}

/** Converts any Graph meeting failure into a message that is safe and actionable for every UI. */
export function toMeetingSourceError(error: unknown): MeetingSourceError {
  if (error instanceof MeetingSourceError) return error
  if (error instanceof GraphMeetingError) {
    if (error.code === 'content_budget_exceeded' || error.code === 'invalid_transcript_segments' || error.code === 'transcript_count_exceeded') return meetingSourceError('too-large')
    if (error.code === 'invalid_meeting_handle' || error.code === 'meeting_not_in_recent_calendar' || error.code === 'meeting_unavailable' || error.code === 'invalid_meeting_link') return meetingSourceError('not-found')
    const code = error.code
    if (error.state === 'admin-blocked') return meetingSourceError('admin-blocked', code)
    if (error.state === 'auth-required') return meetingSourceError('sign-in-required', code)
    if (error.state === 'denied') return meetingSourceError('denied', code)
    if (error.state === 'unsupported') return meetingSourceError('not-found', code)
    return meetingSourceError('unavailable', code)
  }
  return meetingSourceError('unavailable')
}
const graphRoot = 'https://graph.microsoft.com/v1.0'
const teamsHosts = ['teams.microsoft.com', 'teams.cloud.microsoft']

/** A past Teams meeting from the signed-in user's calendar. `joinUrl` stays server-side. */
export interface RecentMeeting {
  handle: string
  subject: string
  startsAt: string
  meetingType: MeetingType
  joinUrl: string
}
export interface RecentMeetingOptions { now?: Date; days?: number; limit?: number }

const recentEvent = z.object({
  id: z.string().min(1).max(1000),
  subject: z.string().nullable().optional(),
  isCancelled: z.boolean().optional(),
  isOnlineMeeting: z.boolean().optional(),
  start: z.object({ dateTime: z.string(), timeZone: z.string().optional() }),
  end: z.object({ dateTime: z.string(), timeZone: z.string().optional() }),
  onlineMeeting: z.object({ joinUrl: z.string().nullable().optional() }).nullable().optional(),
  attendees: z.array(z.object({
    type: z.string().optional(),
    emailAddress: z.object({ address: z.string().nullable().optional() }).nullable().optional()
  })).optional()
})
const recentPage = z.object({ value: z.array(z.unknown()).max(200) })
const selfProfile = z.object({ mail: z.string().nullable().optional(), userPrincipalName: z.string().nullable().optional() })
const handlePattern = /^gm_[A-Za-z0-9_-]{32}$/

export function meetingHandle(eventId: string): string {
  return `gm_${createHash('sha256').update(eventId).digest('base64url').slice(0, 32)}`
}

function utcInstant(value: { dateTime: string; timeZone?: string | undefined }): number | undefined {
  if (value.timeZone && value.timeZone.toUpperCase() !== 'UTC') return undefined
  const parsed = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value.dateTime) ? value.dateTime : `${value.dateTime}Z`)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isTeamsJoinUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && teamsHosts.includes(url.hostname) && !url.username && !url.password
  } catch { return false }
}

/** Combines a meeting's transcripts (restarted recordings produce several) into one reviewable transcript. */
export function mergeMeetingTranscripts(transcripts: readonly MeetingTranscript[], handle: string): MeetingTranscript | undefined {
  const [first] = transcripts
  if (!first) return undefined
  if (transcripts.length === 1) return first
  const id = `graph-${createHash('sha256').update(transcripts.map((item) => item.id).join('|')).digest('hex').slice(0, 24)}`
  const segments = transcripts.flatMap((transcript, index) => transcript.segments.map((segment) => ({ ...segment, segmentId: `t${index + 1}-${segment.segmentId}` })))
  if (segments.length > transcriptMaximumSegments) throw new GraphMeetingError('paused', 'invalid_transcript_segments')
  return { ...first, id: id || handle, segments }
}

const transcriptPage = z.object({
  value: z.array(z.object({ id: z.string().min(1).max(500) })),
  '@odata.nextLink': z.url().optional()
})
export interface GraphAcquisitionResult {
  state: 'ready' | 'waiting'
  meetingId: string
  transcripts: MeetingTranscript[]
  attribution: 'attributed' | 'unattributed' | 'unknown'
  contentVersions: Record<string, string>
}

export class GraphMeetingConnector {
  private readonly maximumBytes: number
  constructor(
    private readonly getAccessToken: (purpose: MeetingTokenPurpose) => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
    options: { maximumBytes?: number } = {}
  ) {
    this.maximumBytes = options.maximumBytes ?? 512_000
    if (!Number.isSafeInteger(this.maximumBytes) || this.maximumBytes < 1) throw new Error('A positive transcript byte budget is required.')
  }
  async resolveMeeting(joinUrl: string): Promise<string> {
    const url = new URL(joinUrl)
    if (url.protocol !== 'https:' || !['teams.microsoft.com', 'teams.cloud.microsoft'].includes(url.hostname) || url.username || url.password) {
      throw new GraphMeetingError('unsupported', 'invalid_meeting_link')
    }
    const endpoint = new URL(`${graphRoot}/me/onlineMeetings`)
    endpoint.searchParams.set('$filter', `JoinWebUrl eq '${joinUrl.replaceAll("'", "''")}'`)
    const response = await this.request(endpoint)
    const value = z.object({ value: z.array(z.object({ id: z.string().min(1) })).max(1) }).parse(JSON.parse(await this.read(response)))
    if (!value.value[0]) throw new GraphMeetingError('denied', 'meeting_unavailable')
    return value.value[0].id
  }
  /** Lists past, non-cancelled Teams meetings from the signed-in user's calendar, newest first. */
  async listRecentMeetings(options: RecentMeetingOptions = {}): Promise<RecentMeeting[]> {
    const now = options.now ?? new Date()
    const days = options.days ?? recentMeetingWindowDays
    const limit = options.limit ?? recentMeetingLimit
    const endpoint = new URL(`${graphRoot}/me/calendarView`)
    endpoint.searchParams.set('startDateTime', new Date(now.getTime() - days * 86_400_000).toISOString())
    endpoint.searchParams.set('endDateTime', now.toISOString())
    endpoint.searchParams.set('$select', 'id,subject,start,end,isOnlineMeeting,isCancelled,onlineMeeting,attendees')
    endpoint.searchParams.set('$orderby', 'start/dateTime desc')
    endpoint.searchParams.set('$top', '50')
    const response = await this.request(endpoint, 'application/json', 'list')
    let page: z.infer<typeof recentPage>
    try { page = recentPage.parse(JSON.parse(await this.read(response, 2_000_000))) } catch (error) {
      if (error instanceof GraphMeetingError) throw error
      throw new GraphMeetingError('paused', 'invalid_calendar_response')
    }
    const candidates: Array<{ event: z.infer<typeof recentEvent>; startsAt: number; joinUrl: string }> = []
    for (const raw of page.value) {
      const parsed = recentEvent.safeParse(raw)
      if (!parsed.success) continue
      const event = parsed.data
      const joinUrl = event.onlineMeeting?.joinUrl
      const startsAt = utcInstant(event.start)
      const endsAt = utcInstant(event.end)
      if (event.isCancelled || event.isOnlineMeeting === false || !joinUrl || !isTeamsJoinUrl(joinUrl)
        || startsAt === undefined || endsAt === undefined || endsAt > now.getTime()) continue
      candidates.push({ event, startsAt, joinUrl })
    }
    candidates.sort((left, right) => right.startsAt - left.startsAt)
    const selected = candidates.slice(0, limit)
    const domain = selected.length ? await this.ownDomain() : undefined
    return selected.map(({ event, startsAt, joinUrl }) => ({
      handle: meetingHandle(event.id),
      subject: event.subject?.trim() || '(No subject)',
      startsAt: new Date(startsAt).toISOString(),
      meetingType: this.classify(event.attendees ?? [], domain),
      joinUrl
    }))
  }

  /** Verifies the handle against the user's current recent calendar before any Graph meeting lookup. */
  async resolveRecentMeeting(handle: string, options: RecentMeetingOptions = {}): Promise<RecentMeeting & { meetingId: string }> {
    if (!handlePattern.test(handle)) throw new GraphMeetingError('unsupported', 'invalid_meeting_handle')
    const found = (await this.listRecentMeetings(options)).find((meeting) => meeting.handle === handle)
    if (!found) throw new GraphMeetingError('unsupported', 'meeting_not_in_recent_calendar')
    return { ...found, meetingId: await this.resolveMeeting(found.joinUrl) }
  }

  async acquireRecentMeeting(handle: string, opportunityId: string, options: RecentMeetingOptions = {}): Promise<GraphAcquisitionResult & { meetingType: MeetingType }> {
    const meeting = await this.resolveRecentMeeting(handle, options)
    const acquired = await this.acquire({ meetingId: meeting.meetingId, opportunityId, meetingType: meeting.meetingType })
    return { ...acquired, meetingType: meeting.meetingType }
  }

  /** Acquires and merges every transcript for a chosen recent meeting; `undefined` when none exists yet. */
  async acquireRecentTranscript(handle: string, opportunityId: string, options: RecentMeetingOptions = {}): Promise<MeetingTranscript | undefined> {
    return mergeMeetingTranscripts((await this.acquireRecentMeeting(handle, opportunityId, options)).transcripts, handle)
  }

  private ownDomainRequest: Promise<string | undefined> | undefined
  private ownDomain(): Promise<string | undefined> {
    this.ownDomainRequest ??= (async () => {
      try {
        const endpoint = new URL(`${graphRoot}/me`)
        endpoint.searchParams.set('$select', 'mail,userPrincipalName')
        const profile = selfProfile.parse(JSON.parse(await this.read(await this.request(endpoint, 'application/json', 'list'))))
        return (profile.mail ?? profile.userPrincipalName ?? '').split('@')[1]?.toLowerCase() || undefined
      } catch { return undefined }
    })()
    return this.ownDomainRequest
  }

  /** `customer` when anyone outside the signed-in user's domain was invited; the reviewer can still correct the result. */
  private classify(attendees: ReadonlyArray<{ type?: string | undefined; emailAddress?: { address?: string | null | undefined } | null | undefined }>, domain: string | undefined): MeetingType {
    if (!domain) return 'customer'
    const external = attendees.some((attendee) => {
      if (attendee.type === 'resource') return false
      const attendeeDomain = attendee.emailAddress?.address?.split('@')[1]?.toLowerCase()
      return attendeeDomain !== undefined && attendeeDomain !== domain
    })
    return external ? 'customer' : 'internal'
  }

  async acquire(input: { meetingId: string; opportunityId: string; meetingType: MeetingType }): Promise<GraphAcquisitionResult> {
    if (!input.meetingId || input.meetingId.length > 500 || /[/:\\?#\r\n]/.test(input.meetingId)) {
      throw new GraphMeetingError('unsupported', 'invalid_meeting_id')
    }
    const meetingPath = `${graphRoot}/me/onlineMeetings/${encodeURIComponent(input.meetingId)}`
    let requests = 0
    const get = async (url: string, accept = 'application/json') => {
      if (++requests > 30) throw new GraphMeetingError('paused', 'request_budget_exhausted')
      const target = new URL(url)
      if (target.origin !== 'https://graph.microsoft.com' || !target.pathname.startsWith(new URL(meetingPath).pathname)
        || target.username || target.password || target.hash) {
        throw new GraphMeetingError('unsupported', 'invalid_graph_continuation')
      }
      return this.request(target, accept)
    }
    const meeting = z.object({ id: z.string().min(1), subject: z.string().optional() }).parse(JSON.parse(await this.read(await get(meetingPath))))
    if (meeting.id !== input.meetingId) throw new GraphMeetingError('denied', 'meeting_identity_mismatch')
    const ids: string[] = []
    let next: string | undefined = `${meetingPath}/transcripts`
    const visited = new Set<string>()
    while (next) {
      if (visited.has(next)) throw new GraphMeetingError('paused', 'repeated_page')
      visited.add(next)
      const page = transcriptPage.parse(JSON.parse(await this.read(await get(next))))
      for (const row of page.value) if (!ids.includes(row.id)) ids.push(row.id)
      if (ids.length > 20) throw new GraphMeetingError('paused', 'transcript_count_exceeded')
      next = page['@odata.nextLink']
    }
    const transcripts: MeetingTranscript[] = []
    const contentVersions: Record<string, string> = {}
    let unattributed = false
    let totalBytes = 0
    for (const id of ids) {
      const endpoint = `${meetingPath}/transcripts/${encodeURIComponent(id)}/content`
      let response: Response
      let prohibited = false
      try {
        response = await get(endpoint, 'text/vtt')
      } catch (error) {
        if (!(error instanceof GraphMeetingError) || error.code !== 'SpeakerAttributionNotAllowed') throw error
        response = await get(endpoint, 'application/vnd.microsoft.graph.transcript+text')
        prohibited = true
        unattributed = true
      }
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
      if (contentType && !['text/vtt', 'text/plain', 'application/vnd.microsoft.graph.transcript+text'].includes(contentType)) {
        throw new GraphMeetingError('unsupported', 'unexpected_content_type')
      }
      if (contentType === 'application/vnd.microsoft.graph.transcript+text') { prohibited = true; unattributed = true }
      const content = await this.read(response)
      totalBytes += Buffer.byteLength(content)
      if (totalBytes > this.maximumBytes || content.length > 150_000) throw new GraphMeetingError('paused', 'content_budget_exceeded')
      const transcript = parseTranscriptContent(content, {
        id, source: 'teams', meetingType: input.meetingType, opportunityId: input.opportunityId,
        attribution: prohibited ? 'prohibited' : 'allowed',
        ...(meeting.subject ? { title: meeting.subject } : {})
      })
      if (!transcript.segments.length || transcript.segments.length > 2000) throw new GraphMeetingError('unsupported', 'invalid_transcript_segments')
      transcripts.push(transcript)
      contentVersions[id] = createHash('sha256').update(content).digest('hex')
    }
    return {
      state: transcripts.length ? 'ready' : 'waiting', meetingId: input.meetingId, transcripts,
      attribution: transcripts.length ? unattributed ? 'unattributed' : 'attributed' : 'unknown', contentVersions
    }
  }
  private async request(url: URL, accept = 'application/json', purpose: MeetingTokenPurpose = 'transcript'): Promise<Response> {
    let token: string
    try { token = await this.getAccessToken(purpose) } catch (error) {
      if (error instanceof MeetingSourceError) throw error
      if (error instanceof Error && error.name === 'TeamsAuthorizationError') throw error
      throw new GraphMeetingError('auth-required', 'delegated_session_unavailable')
    }
    if (!token) throw new GraphMeetingError('auth-required', 'missing_delegated_token')
    let response: Response
    try {
      response = await this.fetcher(url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${token}`, accept }
      })
    } catch {
      throw new GraphMeetingError('paused', 'graph_transport')
    }
    if (response.ok) return response
    let code = `http_${response.status}`
    const text = await this.read(response)
    try {
      const error = z.object({ error: z.object({ code: z.string().optional(), innerError: z.object({ code: z.string().optional() }).optional() }) }).parse(JSON.parse(text))
      const candidate = error.error.innerError?.code ?? error.error.code
      if (candidate && /^[A-Za-z0-9_]{1,100}$/.test(candidate)) code = candidate
    } catch {
      throw new GraphMeetingError(response.status === 401 ? 'auth-required' : response.status === 403 ? 'denied' : 'paused', code)
    }
    throw new GraphMeetingError(code === 'GraphAccessToTranscriptsDisabled' ? 'admin-blocked'
      : response.status === 401 ? 'auth-required' : response.status === 403 ? 'denied'
        : response.status === 404 ? 'unsupported' : 'paused', code)
  }
  private async read(response: Response, maximumBytes = this.maximumBytes): Promise<string> {
    try {
      return await readBoundedText(response, maximumBytes)
    } catch (error) {
      if (error instanceof ResponseSizeError) throw new GraphMeetingError('paused', 'content_budget_exceeded')
      throw error
    }
  }
}
