import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TeamsMcemStageBoard } from '../../../apps/teams/src/client/mcem-stage-board.js'
import { mcemStages } from '../../../apps/shared/mcem-stages.js'

describe('shared MCEM stage presentation', () => {
  it('renders all five stages and accountable roles and places each scoped opportunity in its recorded stage', () => {
    const html = renderToStaticMarkup(createElement(TeamsMcemStageBoard, {
      accountName: 'Sanitized account', selectedId: 'one', evaluation: undefined, onSelect: vi.fn(),
      opportunities: [
        { id: 'one', accountId: 'account', name: 'Stage one opportunity', recordedStage: 1, value: 100, currency: 'USD', closeDate: '2027-01-01' },
        { id: 'five', accountId: 'account', name: 'Stage five opportunity', recordedStage: 5, value: 100, currency: 'USD', closeDate: '2027-01-01' }
      ]
    }))
    for (const stage of mcemStages) {
      expect(html).toContain(`aria-label="Stage ${stage.id}: ${stage.name.replaceAll('&', '&amp;')}"`)
      expect(html).toContain(stage.role)
    }
    expect(html).toContain('aria-label="MCEM stage board"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Not evaluated')
    expect(html).not.toContain('Evaluating exit criteria')
  })
})
