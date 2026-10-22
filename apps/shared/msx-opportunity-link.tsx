import type { MouseEvent, ReactElement } from 'react'
import { buildMsxOpportunityUrl } from '../../packages/common/sharing/opportunity-link.js'

export function MsxOpportunityLink({ opportunity, onOpen, onError }: {
    opportunity: { id: string; name: string }
    onOpen(url: string): void | Promise<void>
    onError(message: string): void
}): ReactElement {
    const url = buildMsxOpportunityUrl(opportunity.id)

    async function open(event: MouseEvent<HTMLAnchorElement>): Promise<void> {
        event.preventDefault()
        onError('')
        try {
            await onOpen(url)
        } catch (cause) {
            onError(cause instanceof Error ? cause.message : 'Could not open the opportunity in MSX.')
        }
    }

    return <a className="msx-opportunity-link" href={url} target="_blank" rel="noopener noreferrer"
        title="Open opportunity in MSX (opens in your browser)" onClick={(event) => { void open(event) }}>
        {opportunity.name}
    </a>
}
