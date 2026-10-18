import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { MeetingTranscript, MeetingType } from '../../common/contracts/meeting.js'
import { parseTranscriptContent } from '../../agents/meeting-signal-extractor/src/transcript-parse.js'
import { readBoundedText, ResponseSizeError } from '../common/http-response.js'

export type GraphFailureState = 'denied' | 'admin-blocked' | 'auth-required' | 'unsupported' | 'paused'
export class GraphMeetingError extends Error {
  constructor(readonly state: GraphFailureState, readonly code: string) {
    super(`Meeting transcript acquisition is ${state} (${code}).`)
    this.name = 'GraphMeetingError'
  }
}
const graphRoot = 'https://graph.microsoft.com/v1.0'
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
    private readonly getAccessToken: () => Promise<string>,
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
  private async request(url: URL, accept = 'application/json'): Promise<Response> {
    let token: string
    try { token = await this.getAccessToken() } catch (error) {
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
  private async read(response: Response): Promise<string> {
    try {
      return await readBoundedText(response, this.maximumBytes)
    } catch (error) {
      if (error instanceof ResponseSizeError) throw new GraphMeetingError('paused', 'content_budget_exceeded')
      throw error
    }
  }
}
