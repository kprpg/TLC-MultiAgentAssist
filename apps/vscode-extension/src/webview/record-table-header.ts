import { createElement, type ReactElement } from 'react'

export function RecordTableHeader({ nameLabel }: { nameLabel: string }): ReactElement {
    return createElement('thead', null,
        createElement('tr', null,
            createElement('th', { scope: 'col' }, nameLabel),
            createElement('th', { scope: 'col' }, 'Stage'),
            createElement('th', { scope: 'col' }, 'Comments')
        )
    )
}