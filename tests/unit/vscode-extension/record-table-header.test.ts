import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecordTableHeader } from '../../../apps/vscode-extension/src/webview/record-table-header.js'

describe('RecordTableHeader', () => {
    it.each([
        { nameLabel: 'Opportunity name', showOpportunityIntent: true },
        { nameLabel: 'Milestone name', showOpportunityIntent: false }
    ])('renders the $nameLabel table columns', ({ nameLabel, showOpportunityIntent }) => {
        const markup = renderToStaticMarkup(createElement('table', null, createElement(RecordTableHeader, { nameLabel, showOpportunityIntent })))

        expect(markup).toContain(`<th scope="col">${nameLabel}</th>`)
        expect(markup.includes('<th scope="col">Opportunity intent</th>')).toBe(showOpportunityIntent)
        expect(markup).toContain('<th scope="col">Stage</th>')
        expect(markup).toContain('<th scope="col">Comments</th>')
    })
})