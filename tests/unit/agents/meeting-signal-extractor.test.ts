import { describe, expect, it } from 'vitest'
import {
  extractMeetingSignals,
  MEETING_FIELD_DICTIONARY,
  type MeetingExtractionContext
} from '../../../packages/agents/meeting-signal-extractor/src/index.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'
import type { MeetingTranscript } from '../../../packages/common/index.js'

const gapOpportunity = {
  id: 'opp-test',
  name: 'Test opportunity',
  fields: {
    budgetAmount: null,
    budgetStatus: null,
    timeline: null,
    purchaseProcess: null,
    need: null,
    identifyCompetitors: false,
    qualificationComments: null
  }
}

function transcript(segments: MeetingTranscript['segments']): MeetingTranscript {
  return { id: 'tr-test', meetingType: 'customer', source: 'upload', segments }
}

describe('meeting-signal extractor', () => {
  it('maps budget, timeline, process, and need onto dictionary fields with evidence', () => {
    const ctx: MeetingExtractionContext = {
      transcript: transcript([
        { segmentId: 's1', speakerRole: 'customer', text: 'We have sign-off to spend about 900 thousand this quarter.' },
        { segmentId: 's2', speakerRole: 'customer', text: 'Our steering committee decides, and it is a must-have for us.' }
      ]),
      opportunity: gapOpportunity,
      milestones: []
    }
    const proposal = extractMeetingSignals(ctx, { changeSetId: 'cs-1', now: () => new Date('2026-01-01T00:00:00Z') })
    const byField = new Map(proposal.slots.map((slot) => [slot.targetField, slot]))

    expect(byField.get('budgetAmount')?.after).toBe(900_000)
    expect(byField.get('budgetStatus')?.after).toBe('Yes')
    expect(byField.get('timeline')?.after).toBe('This Quarter')
    expect(byField.get('purchaseProcess')?.after).toBe('Committee')
    expect(byField.get('need')?.after).toBe('Must have')
    for (const slot of proposal.slots) {
      expect(slot.evidence.length).toBeGreaterThan(0)
      expect(MEETING_FIELD_DICTIONARY[slot.targetField]).toBeDefined()
    }
  })

  it('drops no-op slots when the opportunity already holds the value', () => {
    const ctx: MeetingExtractionContext = {
      transcript: transcript([
        { segmentId: 's1', speakerRole: 'customer', text: 'We want to decide this quarter.' }
      ]),
      opportunity: { id: 'opp-test', name: 'Test', fields: { timeline: 'This Quarter' } },
      milestones: []
    }
    const proposal = extractMeetingSignals(ctx, { changeSetId: 'cs-2' })
    expect(proposal.slots.find((slot) => slot.targetField === 'timeline')).toBeUndefined()
  })

  it('routes internal competitive intel to the qualification note, not customer fields', () => {
    const ctx: MeetingExtractionContext = {
      transcript: transcript([
        { segmentId: 's1', speakerRole: 'internal', text: 'We are competing against AWS; schedule a proof of value.' }
      ]),
      opportunity: gapOpportunity,
      milestones: []
    }
    const proposal = extractMeetingSignals(ctx, { changeSetId: 'cs-3' })
    const qual = proposal.slots.find((slot) => slot.targetField === 'qualificationComments')
    expect(qual?.after).toContain('AWS')
    expect(proposal.newMilestones.map((milestone) => milestone.name)).toContain('Proof of value')
    expect(proposal.unmappedSignals.length).toBeGreaterThan(0)
  })

  it('never pre-checks a low-confidence sentiment slot', () => {
    const ctx: MeetingExtractionContext = {
      transcript: transcript([
        { segmentId: 's1', speakerRole: 'customer', text: 'Honestly we are quite concerned about the timeline.' }
      ]),
      opportunity: { id: 'opp-test', name: 'Test', fields: { opportunityRating: 'Hot' } },
      milestones: []
    }
    const proposal = extractMeetingSignals(ctx, { changeSetId: 'cs-4' })
    const rating = proposal.slots.find((slot) => slot.targetField === 'opportunityRating')
    expect(rating?.after).toBe('Cold')
    expect(rating?.checkedByDefault).toBe(false)
  })
})

describe('transcript parser', () => {
  it('parses WebVTT with voice tags into diarized segments', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:12.000 --> 00:00:24.000',
      '<v Priya Nair>We can commit around 4 million this year.</v>',
      '',
      '00:00:48.000 --> 00:00:61.000',
      '<v Daniel Reyes>The committee decides this quarter.</v>'
    ].join('\n')
    const parsed = parseTranscriptContent(vtt, { meetingType: 'customer' })
    expect(parsed.segments).toHaveLength(2)
    expect(parsed.segments[0]?.speaker).toBe('Priya Nair')
    expect(parsed.segments[0]?.startMs).toBe(12_000)
    expect(parsed.source).toBe('upload')
  })

  it('parses a simple Speaker: text paste', () => {
    const text = 'Priya Nair: We approved the budget.\nDaniel Reyes: We decide this quarter.'
    const parsed = parseTranscriptContent(text, { meetingType: 'customer' })
    expect(parsed.segments).toHaveLength(2)
    expect(parsed.segments[1]?.speaker).toBe('Daniel Reyes')
    expect(parsed.segments[1]?.text).toContain('this quarter')
  })
})
