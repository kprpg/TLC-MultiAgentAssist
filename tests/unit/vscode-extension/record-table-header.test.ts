import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecordTableHeader } from '../../../apps/vscode-extension/src/webview/record-table-header.js'

describe('RecordTableHeader', () => {
    it.each(['Opportunity name', 'Milestone name'])('renders the %s table columns', (nameLabel) => {
        const markup = renderToStaticMarkup(createElement('table', null, createElement(RecordTableHeader, { nameLabel })))

        expect(markup).toContain(`<th scope="col">${nameLabel}</th>`)
        expect(markup).toContain('<th scope="col">Stage</th>')
        expect(markup).toContain('<th scope="col">Comments</th>')
    })
})