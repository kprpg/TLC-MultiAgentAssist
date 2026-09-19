import type { ReactElement } from 'react'
import { PortfolioLayoutControls } from './portfolio-layout-controls.js'

export function AppHeader({
    tab,
    mode,
    accountsExpanded,
    detailsExpanded,
    actionsExpanded,
    onSelectTab,
    onToggleAccounts,
    onToggleDetails,
    onToggleActions
}: {
    tab: 'portfolio' | 'plays'
    mode: 'sample' | 'live'
    accountsExpanded: boolean
    detailsExpanded: boolean
    actionsExpanded: boolean
    onSelectTab(tab: 'portfolio' | 'plays'): void
    onToggleAccounts(): void
    onToggleDetails(): void
    onToggleActions(): void
}): ReactElement {
    return (
        <header className="app-header">
            <nav className="tabs">
                <button className={tab === 'portfolio' ? 'tab active' : 'tab'} onClick={() => onSelectTab('portfolio')}>Portfolio</button>
                <button className={tab === 'plays' ? 'tab active' : 'tab'} onClick={() => onSelectTab('plays')}>Plays</button>
            </nav>
            {tab === 'portfolio' && (
                <PortfolioLayoutControls
                    accountsExpanded={accountsExpanded}
                    detailsExpanded={detailsExpanded}
                    actionsExpanded={actionsExpanded}
                    onToggleAccounts={onToggleAccounts}
                    onToggleDetails={onToggleDetails}
                    onToggleActions={onToggleActions}
                />
            )}
            <span className={`mode-badge mode-${mode}`}>{mode === 'live' ? 'Live' : 'Sample'}</span>
        </header>
    )
}