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
    onSearchSelect,
    contextKey
}: {
    tab: 'new' | 'portfolio' | 'plays' | 'discover' | 'dashboard'
    mode: 'sample' | 'live'
    accountsExpanded: boolean
    detailsExpanded: boolean
    actionsExpanded: boolean
    onSelectTab(tab: 'new' | 'portfolio' | 'plays' | 'discover' | 'dashboard'): void
    onToggleAccounts(): void
    onToggleDetails(): void
    onToggleActions(): void
    onOpenIssue(url: string): Promise<void> | void
    onSearchSelect(target: PortfolioSearchTarget): void
    contextKey?: string
}): ReactElement {
    return (
        <header className="app-header">
            <nav className="tabs">
                <button className={tab === 'new' ? 'tab active' : 'tab'} onClick={() => onSelectTab('new')}>New</button>
                <button className={tab === 'discover' ? 'tab active' : 'tab'} onClick={() => onSelectTab('discover')}>Discover</button>
                <button className={tab === 'portfolio' ? 'tab active' : 'tab'} onClick={() => onSelectTab('portfolio')}>Portfolio</button>
                <button className={tab === 'plays' ? 'tab active' : 'tab'} onClick={() => onSelectTab('plays')}>Plays</button>
                <button className={tab === 'dashboard' ? 'tab active' : 'tab'} onClick={() => onSelectTab('dashboard')}>Dashboards</button>
            </nav>
            <PortfolioSearch onSelect={onSearchSelect} contextKey={contextKey ?? `${tab}:${mode}`} />
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