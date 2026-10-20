import { ClipboardTaskListLtr20Regular, PanelLeft20Regular, PanelRight20Regular } from '@fluentui/react-icons'
import type { ReactElement } from 'react'

export function PortfolioLayoutControls({
    accountsExpanded,
    detailsExpanded,
    actionsExpanded,
    onToggleAccounts,
    onToggleDetails,
    onToggleActions
}: {
    accountsExpanded: boolean
    detailsExpanded: boolean
    actionsExpanded: boolean
    onToggleAccounts(): void
    onToggleDetails(): void
    onToggleActions(): void
}): ReactElement {
    return (
        <div className="layout-controls" role="group" aria-label="Portfolio layout">
            <button
                type="button"
                className={`layout-control${accountsExpanded ? ' active' : ''}`}
                aria-label={`${accountsExpanded ? 'Hide' : 'Show'} Accounts panel`}
                aria-controls="portfolio-accounts-panel"
                aria-expanded={accountsExpanded}
                title={`${accountsExpanded ? 'Hide' : 'Show'} Accounts panel`}
                onClick={onToggleAccounts}
            >
                <PanelLeft20Regular />
            </button>
            <button
                type="button"
                className={`layout-control${detailsExpanded ? ' active' : ''}`}
                aria-label={`${detailsExpanded ? 'Hide' : 'Show'} opportunity details panel`}
                aria-controls="portfolio-details-panel"
                aria-expanded={detailsExpanded}
                title={`${detailsExpanded ? 'Hide' : 'Show'} opportunity details panel`}
                onClick={onToggleDetails}
            >
                <PanelRight20Regular />
            </button>
            <button
                type="button"
                className={`layout-control${actionsExpanded ? ' active' : ''}`}
                aria-label={`${actionsExpanded ? 'Hide' : 'Show'} Next Best Actions panel`}
                aria-controls="next-best-actions-panel"
                aria-expanded={actionsExpanded}
                title={`${actionsExpanded ? 'Hide' : 'Show'} Next Best Actions panel`}
                onClick={onToggleActions}
            >
                <ClipboardTaskListLtr20Regular />
            </button>
        </div>
    )
}