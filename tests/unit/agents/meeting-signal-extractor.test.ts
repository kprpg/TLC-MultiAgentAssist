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

  it('extracts the complete narrative, decision, date, value, and milestone field set', () => {
    const ctx: MeetingExtractionContext = {
      transcript: transcript([
        { segmentId: 's1', speakerRole: 'customer', text: 'The projected deal value is $2.75 million.' },
        { segmentId: 's2', speakerRole: 'customer', text: 'The decision-maker identified is Priya Nair. Customer need: reduce cloud risk.' },
        { segmentId: 's3', speakerRole: 'customer', text: 'Proposed solution: Microsoft Defender for Cloud. Final decision date: March 5, 2027.' },
        { segmentId: 's4', speakerRole: 'internal', text: 'Security posture discovery is committed. Risk: procurement review may delay approval.' }
      ]),
      opportunity: {
        id: 'opp-test',
        name: 'Test',
        fields: {
          estimatedValue: 900_000,
          decisionMaker: false,
          customerNeed: null,
          proposedSolution: null,
          finalDecisionDate: null
        }
      },
      milestones: [{
        id: 'ms-security',
        name: 'Security posture discovery',
        fields: { milestoneCommitment: 'Uncommitted', milestoneRisk: null }
      }]
    }

    const proposal = extractMeetingSignals(ctx, { changeSetId: 'cs-complete' })
    const byField = new Map(proposal.slots.map((slot) => [slot.targetField, slot]))

    expect(byField.get('estimatedValue')?.after).toBe(2_750_000)
    expect(byField.get('decisionMaker')?.after).toBe(true)
    expect(byField.get('customerNeed')?.after).toBe('reduce cloud risk')
    expect(byField.get('proposedSolution')?.after).toBe('Microsoft Defender for Cloud')
    expect(byField.get('finalDecisionDate')?.after).toBe('2027-03-05')
    expect(byField.get('milestoneCommitment')?.after).toBe('Committed')
    expect(byField.get('milestoneCommitment')?.targetRecordId).toBe('ms-security')
    expect(byField.get('milestoneRisk')?.after).toBe('procurement review may delay approval')
    expect(byField.get('milestoneRisk')?.targetRecordId).toBe('ms-security')
    expect(proposal.suggestedMilestoneIds).toEqual(['ms-security'])
    for (const slot of proposal.slots) expect(slot.evidence.length).toBeGreaterThan(0)
  })

  it.each([
    ['The final decision is 2027-04-02.', '2027-04-02'],
    ['We will make the final decision by 05/14/2027.', '2027-05-14'],
    ['Final decision date: June 18, 2027.', '2027-06-18']
  ])('normalizes explicit final-decision date "%s"', (text, expected) => {
    const ctx: MeetingExtractionContext = {
      transcript: transcript([{ segmentId: 's1', speakerRole: 'customer', text }]),
      opportunity: { id: 'opp-test', name: 'Test', fields: { finalDecisionDate: null } },
      milestones: []
    }

    const proposal = extractMeetingSignals(ctx, { changeSetId: 'cs-date' })
    expect(proposal.slots.find((slot) => slot.targetField === 'finalDecisionDate')?.after).toBe(expected)
  })

  it('does not route customer-spoken milestone risk into the internal risk field', () => {
    const ctx: MeetingExtractionContext = {
      transcript: transcript([
        { segmentId: 's1', speakerRole: 'customer', text: 'Security posture discovery is committed. Risk: procurement may be late.' }
      ]),
      opportunity: { id: 'opp-test', name: 'Test', fields: {} },
      milestones: [{
        id: 'ms-security',
        name: 'Security posture discovery',
        fields: { milestoneCommitment: 'Uncommitted', milestoneRisk: null }
      }]
    }

    const proposal = extractMeetingSignals(ctx, { changeSetId: 'cs-customer-risk' })
    expect(proposal.slots.find((slot) => slot.targetField === 'milestoneCommitment')?.after).toBe('Committed')
    expect(proposal.slots.find((slot) => slot.targetField === 'milestoneRisk')).toBeUndefined()
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
