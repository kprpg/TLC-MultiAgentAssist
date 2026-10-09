import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NextBestActions } from '../../../apps/vscode-extension/src/webview/next-best-actions.js'
import { PlayRoleOwners } from '../../../apps/vscode-extension/src/webview/play-role-owners.js'

describe('VS Code portfolio parity', () => {
    it('renders Next Best Actions from MCEM recommendations', () => {
        const markup = renderToStaticMarkup(createElement(NextBestActions, {
            evaluation: {
                summary: 'Stage review complete.',
                state: 'complete',
                recordedStage: 2,
                evidenceBasedStage: 3,
                criteria: [],
                recommendations: [{
                    id: 'action-1', action: 'Confirm the decision team.', ownerRole: 'AE', confidence: 'high',
                    rationale: 'The accountable decision maker is not confirmed.', evidenceIds: ['msx-1', 'mcem-1'], assumption: false
                }],
                evidence: [
                    { id: 'msx-1', title: 'Opportunity snapshot', source: 'msx', url: 'https://example.test/opportunity' },
                    { id: 'mcem-1', title: 'Stage guidance', source: 'mcem' }
                ],
                missingData: []
            },
            loading: false,
            onRun: vi.fn(),
            onOpenEvidence: vi.fn()
        }))

        expect(markup).toContain('Next Best Actions')
        expect(markup).toContain('Confirm the decision team.')
        expect(markup).toContain('AE')
        expect(markup).toContain('high confidence')
        expect(markup).toContain('2 citations')
        expect(markup).toContain('The accountable decision maker is not confirmed.')
        expect(markup).toContain('Opportunity snapshot')
        expect(markup).toContain('Stage guidance')
        expect(markup).toContain('msx-1')
        expect(markup).toContain('mcem-1')
        expect(markup).not.toContain('Assumption')
    })

    it('labels assumptions and unresolved citation IDs without inventing evidence', () => {
        const markup = renderToStaticMarkup(createElement(NextBestActions, {
            evaluation: {
                summary: 'Partial review.', state: 'partial', recordedStage: 2, evidenceBasedStage: 1,
                criteria: [], missingData: [],
                recommendations: [{
                    id: 'assumption', action: 'Confirm scope.', ownerRole: 'AE', confidence: 'low',
                    rationale: 'Customer scope is not yet known.', evidenceIds: [], assumption: true
                }, {
                    id: 'missing-evidence', action: 'Review evidence.', ownerRole: 'SE', confidence: 'medium',
                    rationale: 'Review the cited source.', evidenceIds: ['unresolved-id'], assumption: false
                }]
            },
            loading: false, onRun: vi.fn(), onOpenEvidence: vi.fn()
        }))
        expect(markup).toContain('Assumption - confirm before acting.')
        expect(markup).toContain('0 citations')
        expect(markup).toContain('1 citation')
        expect(markup).toContain('Evidence unavailable: unresolved-id')
        expect(markup).not.toContain('href=')
    })

    it('renders Plays role names without the redundant label', () => {
        const markup = renderToStaticMarkup(createElement(PlayRoleOwners, { roles: ['AE', 'Manager'] }))

        expect(markup).toContain('AE, Manager')
        expect(markup).not.toContain('Role owners:')
    })
})