import { describe, expect, it, vi } from 'vitest'
import { GraphMeetingConnector, GraphMeetingError } from '../../../packages/connectors/graph/meetings.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'

const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Alex>Confirm the customer outcome.</v>\n'
const plain = '00:00:01.000 --> 00:00:03.000\nBudget: decision pending\n'
const request = { meetingId: 'meeting-id', opportunityId: 'opp', meetingType: 'customer' as const }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

describe('automatic delegated Graph transcript reads', () => {
  it('checks actual meeting access, retrieves every transcript automatically and preserves Teams provenance', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 'meeting-id', subject: 'Test meeting' }))
      .mockResolvedValueOnce(json({ value: [{ id: 'transcript-1' }, { id: 'transcript-2' }] }))
      .mockResolvedValueOnce(new Response(vtt, { headers: { 'content-type': 'text/vtt' } }))
      .mockResolvedValueOnce(new Response(vtt, { headers: { 'content-type': 'text/vtt' } }))
    const token = vi.fn().mockResolvedValue('graph-user-token')
    const result = await new GraphMeetingConnector(token, fetcher).acquire(request)
    expect(result.state).toBe('ready')
    expect(result.transcripts).toHaveLength(2)
    expect(result.transcripts[0]).toMatchObject({
      id: 'transcript-1', source: 'teams', opportunityId: 'opp',
      segments: [{ segmentId: 'seg-1', startMs: 1000, endMs: 3000, speaker: 'Alex', text: 'Confirm the customer outcome.' }]
    })
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/onlineMeetings\//)
      expect(options?.method ?? 'GET').toBe('GET')
      expect(options?.redirect).toBe('error')
      expect(new Headers(options?.headers).get('authorization')).toBe('Bearer graph-user-token')
    }
  })
  it('retries only prohibited speaker attribution with the documented header, preserving the full unattributed utterance', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 'meeting-id' }))
      .mockResolvedValueOnce(json({ value: [{ id: 'transcript' }] }))
      .mockResolvedValueOnce(json({ error: { innerError: { code: 'SpeakerAttributionNotAllowed' } } }, 403))
      .mockResolvedValueOnce(new Response(plain, { headers: { 'content-type': 'application/vnd.microsoft.graph.transcript+text' } }))
    const result = await new GraphMeetingConnector(async () => 'token', fetcher).acquire(request)
    expect(result.attribution).toBe('unattributed')
    expect(result.transcripts[0]?.segments[0]).toMatchObject({ text: 'Budget: decision pending', startMs: 1000 })
    expect(result.transcripts[0]?.segments[0]).not.toHaveProperty('speaker')
    expect(new Headers(fetcher.mock.calls[3]?.[1]?.headers).get('accept')).toBe('application/vnd.microsoft.graph.transcript+text')
  })
  it.each([
    [401, 'InvalidAuthenticationToken', 'auth-required'],
    [403, 'GraphAccessToTranscriptsDisabled', 'admin-blocked'],
    [403, 'AccessDenied', 'denied'],
    [404, 'NotFound', 'unsupported'],
    [429, 'TooManyRequests', 'paused']
  ])('surfaces %s/%s without a privileged fallback', async (status, code, state) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ error: { innerError: { code } } }, status))
    await expect(new GraphMeetingConnector(async () => 'token', fetcher).acquire(request))
      .rejects.toMatchObject({ state })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('reports no transcript as waiting, not a fabricated successful capture', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: 'meeting-id' })).mockResolvedValueOnce(json({ value: [] }))
    expect(await new GraphMeetingConnector(async () => 'token', fetcher).acquire(request)).toMatchObject({ state: 'waiting', transcripts: [] })
  })
  it('rejects malicious pagination URLs before sending a token and caps input/content', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 'meeting-id' }))
      .mockResolvedValueOnce(json({ value: [], '@odata.nextLink': 'https://evil.example.com/steal-token' }))
    await expect(new GraphMeetingConnector(async () => 'token', fetcher).acquire(request)).rejects.toThrow(GraphMeetingError)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await expect(new GraphMeetingConnector(async () => 'token', fetcher).acquire({ ...request, meetingId: 'https://evil.example.com' })).rejects.toThrow()
    const large = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: 'meeting-id' })).mockResolvedValueOnce(json({ value: [{ id: 't' }] }))
      .mockResolvedValueOnce(new Response('x'.repeat(1000)))
    await expect(new GraphMeetingConnector(async () => 'token', large, { maximumBytes: 100 }).acquire(request)).rejects.toThrow()
  })
})

describe('Graph-aware parser compatibility', () => {
  it('keeps existing upload speaker parsing while prohibiting inferred Graph speakers', () => {
    expect(parseTranscriptContent('Alex: hello').segments[0]?.speaker).toBe('Alex')
    const graph = parseTranscriptContent('Budget: decision pending', {
      id: 'graph-transcript', source: 'teams', attribution: 'prohibited', meetingType: 'internal'
    })
    expect(graph).toMatchObject({ id: 'graph-transcript', source: 'teams', meetingType: 'internal' })
    expect(graph.segments).toEqual([{ segmentId: 'seg-1', text: 'Budget: decision pending' }])
  })
})
