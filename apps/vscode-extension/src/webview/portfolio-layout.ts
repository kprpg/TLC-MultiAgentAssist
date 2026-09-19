export function portfolioLayoutClassName({
    accountsExpanded,
    detailsExpanded,
    actionsExpanded
}: {
    accountsExpanded: boolean
    detailsExpanded: boolean
    actionsExpanded: boolean
}): string {
    return [
        'split portfolio-split',
        accountsExpanded ? '' : 'accounts-collapsed',
        detailsExpanded || actionsExpanded ? '' : 'workbench-collapsed',
        !accountsExpanded && detailsExpanded && !actionsExpanded ? 'details-only' : ''
    ].filter(Boolean).join(' ')
}