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
                recommendations: [{ id: 'action-1', action: 'Confirm the decision team.', ownerRole: 'AE', confidence: 'high' }],
                missingData: []
            },
            loading: false,
            onRun: vi.fn()
        }))

        expect(markup).toContain('Next Best Actions')
        expect(markup).toContain('Confirm the decision team.')
        expect(markup).toContain('AE')
        expect(markup).toContain('high confidence')
    })

    it('renders Plays role names without the redundant label', () => {
        const markup = renderToStaticMarkup(createElement(PlayRoleOwners, { roles: ['AE', 'Manager'] }))

        expect(markup).toContain('AE, Manager')
        expect(markup).not.toContain('Role owners:')
    })
})