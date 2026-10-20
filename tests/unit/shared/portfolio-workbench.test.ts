import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PortfolioLayoutControls } from '../../../apps/shared/portfolio-layout-controls.js'
import { NextBestActions } from '../../../apps/shared/next-best-actions.js'
import { sortMilestones, sortOpportunities } from '../../../apps/shared/portfolio-sorting.js'

describe('browser-safe shared Portfolio presentation', () => {
  it('exposes independent labeled pane controls', () => {
    const html = renderToStaticMarkup(createElement(PortfolioLayoutControls, {
      accountsExpanded: true, detailsExpanded: false, actionsExpanded: true,
      onToggleAccounts: vi.fn(), onToggleDetails: vi.fn(), onToggleActions: vi.fn()
    }))
    for (const name of ['Hide Accounts panel', 'Show opportunity details panel', 'Hide Next Best Actions panel']) expect(html).toContain(name)
    expect(html).toContain('aria-controls="portfolio-details-panel"')
  })
  it('retains evidence, owner roles, assumptions and read-only guidance', () => {
    const html = renderToStaticMarkup(createElement(NextBestActions, {
      loading: false, onRun: vi.fn(), onOpenEvidence: vi.fn(),
      evaluation: {
        recordedStage: 2, evidenceBasedStage: 3,
        recommendations: [{ id: 'r1', action: 'Confirm readiness', ownerRole: 'SE', rationale: 'Exit evidence needs review', evidenceIds: ['e1'], confidence: 'high', assumption: true }],
        evidence: [{ id: 'e1', title: 'Reviewed criterion', source: 'mcem' }]
      }
    }))
    for (const text of ['SE', 'Confirm readiness', 'Reviewed criterion', 'Assumption', 'Read-only preview', '1 recommendations']) expect(html).toContain(text)
    expect(html).not.toContain('Confirm selected changes')
  })
  it('sorts contract-shaped records without mutating them or losing additional fields', () => {
    const records = [
      { id: 'b', name: 'B', value: 10, closeDate: '2027-02-01', recordedStage: 3, accountId: 'account' },
      { id: 'a', name: 'A', value: 20, closeDate: '2027-01-01', recordedStage: 2, accountId: 'account' }
    ]
    expect(sortOpportunities(records, 'closeDate', 'ascending').map((item) => item.id)).toEqual(['a', 'b'])
    expect(sortOpportunities(records, 'value', 'descending')[0]?.accountId).toBe('account')
    expect(records[0]?.id).toBe('b')
    expect(sortMilestones([
      { id: 'b', name: 'B', status: 'At Risk' },
      { id: 'a', name: 'A', status: 'On Track', targetDate: '2027-01-01' }
    ], 'targetDate', 'descending').map((item) => item.id)).toEqual(['a', 'b'])
  })
})
