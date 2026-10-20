import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MeetingsWorkspace } from '../../../apps/teams/src/client/meetings.js'
import { TeamsApiClient, TeamsRequestError } from '../../../apps/teams/src/client/data-client.js'
import { meetingCaptureError } from '../../../apps/teams/src/client/meeting-capture.js'

describe('Teams manual meeting capture presentation', () => {
  it('offers paste and file input by default for a live CLI profile without implying Graph authority', () => {
    const client = new TeamsApiClient(async () => '')
    const request = vi.spyOn(client, 'request')
    const reviewPreview = vi.fn()
    const html = renderToStaticMarkup(createElement(MeetingsWorkspace, {
      client, mode: 'live', graphAvailable: false, reviewPreview,
      selection: {
        account: { id: 'account', name: 'Sanitized customer', segment: 'Enterprise' },
        opportunity: { id: 'opp', accountId: 'account', name: 'Sanitized opportunity', recordedStage: 1, value: 100, currency: 'USD', closeDate: '2099-12-31' }
      }
    }))
    for (const text of ['Transcript input', 'Paste / upload', 'Transcript file', '.vtt,.txt,text/vtt,text/plain', 'Transcript text', 'Extract &amp; Review', 'does not verify a Graph meeting', 'source changes require separate review']) expect(html).toContain(text)
    expect(html).not.toContain('Verify meeting and acquire transcript')
    expect(request).not.toHaveBeenCalled()
    expect(reviewPreview).not.toHaveBeenCalled()
  })
  it.each([
    ['local_read_only', 'You can extract and inspect transcript suggestions'],
    ['graph_unavailable_in_cli_profile', 'not Microsoft Graph meeting lookup'],
    ['graph_auth_required', 'Your MSX connection has not been changed'],
    ['graph_denied', 'did not grant this user access'],
    ['graph_admin_blocked', 'cannot bypass this policy'],
    ['graph_invalid_meeting_link', 'valid HTTPS Teams meeting join link'],
    ['graph_unsupported', 'unavailable through the current Graph lookup'],
    ['graph_paused', 'temporarily unavailable'],
    ['empty_transcript', 'No readable transcript segments'],
    ['too_many_transcript_segments', 'exceeds 2,000 segments']
  ])('describes %s without exposing source contents or dropping its error reference', (code, message) => {
    const text = meetingCaptureError(new TeamsRequestError(code, 'sanitized-reference'))
    expect(text).toContain(message)
    expect(text).toContain('reference sanitized-reference')
    expect(text).not.toContain('operation failed')
  })
  it('preserves other actionable errors rather than returning a success-shaped fallback', () => {
    expect(meetingCaptureError(new Error('Source permissions changed.'))).toBe('Source permissions changed.')
  })
})
