import { createElement, type ReactElement } from 'react'

export function RecordTableHeader({ nameLabel, showOpportunityIntent = false }: { nameLabel: string; showOpportunityIntent?: boolean }): ReactElement {
    return createElement('thead', null,
        createElement('tr', null,
            createElement('th', { scope: 'col' }, nameLabel),
            showOpportunityIntent ? createElement('th', { scope: 'col' }, 'Opportunity intent') : null,
            createElement('th', { scope: 'col' }, 'Stage'),
            createElement('th', { scope: 'col' }, 'Comments')
        )
    )
}