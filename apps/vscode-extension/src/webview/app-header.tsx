import type { ReactElement } from 'react'
import { FeedbackButton } from '../../../shared/feedback-button.js'
import { PortfolioLayoutControls } from './portfolio-layout-controls.js'
import { PortfolioSearch, type PortfolioSearchTarget } from './portfolio-search.js'

export function AppHeader({
    tab,
    mode,
    accountsExpanded,
    detailsExpanded,
    actionsExpanded,
    onSelectTab,
    onToggleAccounts,
    onToggleDetails,
    onToggleActions,
    onOpenIssue,
    onSearchSelect
}: {
    tab: 'portfolio' | 'plays' | 'discover'
    mode: 'sample' | 'live'
    accountsExpanded: boolean
    detailsExpanded: boolean
    actionsExpanded: boolean
    onSelectTab(tab: 'portfolio' | 'plays' | 'discover'): void
    onToggleAccounts(): void
    onToggleDetails(): void
    onToggleActions(): void
    onOpenIssue(url: string): Promise<void> | void
    onSearchSelect(target: PortfolioSearchTarget): void
}): ReactElement {
    return (
        <header className="app-header">
            <nav className="tabs">
                <button className={tab === 'discover' ? 'tab active' : 'tab'} onClick={() => onSelectTab('discover')}>Discover</button>
                <button className={tab === 'portfolio' ? 'tab active' : 'tab'} onClick={() => onSelectTab('portfolio')}>Portfolio</button>
                <button className={tab === 'plays' ? 'tab active' : 'tab'} onClick={() => onSelectTab('plays')}>Plays</button>
            </nav>
            <PortfolioSearch onSelect={onSearchSelect} />
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
            <FeedbackButton onOpenIssue={onOpenIssue} />
            <span className={`mode-badge mode-${mode}`}>{mode === 'live' ? 'Live' : 'Sample'}</span>
        </header>
    )
}