import { describe, expect, it } from 'vitest'
import {
  manualMeetingTranscriptRequestSchema, manualMeetingTranscriptVersion, transcriptMaximumCharacters
} from '../../packages/common/contracts/meeting.js'

const input = {
  contractVersion: manualMeetingTranscriptVersion, opportunityId: 'sanitized-opportunity',
  meetingType: 'internal', source: 'paste', content: 'Seller: Review the next steps.'
}

describe('manual meeting transcript contract', () => {
  it.each(['paste', 'upload'])('accepts %s evidence without claiming a verified Graph meeting', (source) => {
    expect(manualMeetingTranscriptRequestSchema.parse({ ...input, source })).toEqual({ ...input, source })
  })
  it.each(['vtt', 'text'])('accepts an explicit %s format', (format) => {
    expect(manualMeetingTranscriptRequestSchema.parse({ ...input, format }).format).toBe(format)
  })
  it.each([
    { contractVersion: '0.0' }, { source: 'teams' }, { opportunityId: '' }, { meetingType: 'unknown' },
    { content: '   ' }, { content: 'short' }, { content: 'x'.repeat(transcriptMaximumCharacters + 1) },
    { content: 'Binary\0data must not be accepted' }, { format: 'docx' }, { proposals: [] }, { meetingId: 'cannot-claim-Graph-authority' }
  ])('rejects invalid or authority-claiming input %#', (override) => {
    expect(manualMeetingTranscriptRequestSchema.safeParse({ ...input, ...override }).success).toBe(false)
  })
})
