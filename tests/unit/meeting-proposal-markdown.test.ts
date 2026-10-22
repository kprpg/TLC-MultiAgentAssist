import { describe, expect, it } from 'vitest'
import { meetingProposalToMarkdown } from '../../apps/shared/meeting-proposal-markdown.js'

describe('shared meeting proposal Markdown', () => {
  it('preserves the Desktop and Extension export format including review flags and optional sections', () => {
    const proposal = {
      meetingType: 'internal',
      slots: [
        { label: 'Budget', checkedByDefault: true, blocked: false, displayBefore: 'Unknown', displayAfter: 'Approved', mcemCriterion: 'Funding', confidence: 0.956 },
        { label: 'Owner', checkedByDefault: true, blocked: true, displayAfter: 'Unverified owner', mcemCriterion: 'Ownership', confidence: 0.5 },
        { label: 'Timing', checkedByDefault: false, blocked: false, displayAfter: 'Next quarter', mcemCriterion: 'Timeline', confidence: 0.75 }
      ],
      newMilestones: [{ name: 'Pilot', milestoneDate: '2099-12-01' }, { name: 'Validation' }],
      unmappedSignals: [{ label: 'Open question', text: 'Confirm the sponsor.' }]
    }
    expect(meetingProposalToMarkdown(proposal, 'Sanitized opportunity')).toBe([
      '# Meeting signals - Sanitized opportunity', '', 'Meeting type: internal', '',
      '## Proposed field changes', '',
      '| Apply | Field | Current | Proposed | MCEM | Confidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| yes | Budget | Unknown | Approved | Funding | 96% |',
      '| review | Owner | (empty) | Unverified owner | Ownership | 50% |',
      '| review | Timing | (empty) | Next quarter | Timeline | 75% |',
      '', '## New milestones', '', '- Pilot (2099-12-01)', '- Validation',
      '', '## Other signals (not injected)', '', '- Open question: Confirm the sponsor.'
    ].join('\n'))
  })

  it('keeps an empty proposal honest without inventing milestones or other signals', () => {
    const markdown = meetingProposalToMarkdown({ meetingType: 'customer', slots: [], newMilestones: [], unmappedSignals: [] }, 'Sanitized opportunity')
    expect(markdown).toContain('Meeting type: customer')
    expect(markdown).toContain('## Proposed field changes')
    expect(markdown).not.toContain('## New milestones')
    expect(markdown).not.toContain('## Other signals')
  })
})
