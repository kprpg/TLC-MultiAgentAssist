import type { ReactNode } from 'react'
import type { TeamsSurface, TeamsView } from './workspace-navigation.js'
export type { TeamsView } from './workspace-navigation.js'

const destinations: Array<{ id: TeamsView; label: string }> = [
  { id: 'new', label: 'New' }, { id: 'discover', label: 'Discover' },
  { id: 'portfolio', label: 'Portfolio' }, { id: 'plays', label: 'Plays' },
  { id: 'dashboard', label: 'Dashboards' }
]
const utilities: Array<{ id: TeamsView; label: string }> = [
  { id: 'home', label: 'My work' }, { id: 'meetings', label: 'Meetings' },
  { id: 'activity', label: 'Activity' }, { id: 'configure', label: 'Context settings' }
]

export function TeamsShell({ mode, view, onNavigate, children, surface = 'personal', commands }: {
  mode: 'sample' | 'live'; view: TeamsView; onNavigate(view: TeamsView): void; children: ReactNode
  surface?: TeamsSurface; commands?: ReactNode
}) {
  const contextual = surface !== 'personal'
  return <div className={`teams-shell teams-surface-${surface}`}>
    <header className="teams-header">
      <span className="brand" aria-label="TLC Assist">TLC</span>
      {surface !== 'panel' && <nav className="teams-navigation" aria-label="TLC navigation">
        {(contextual ? destinations.filter((item) => item.id === 'portfolio' || item.id === 'plays') : destinations).map((item) =>
          <button type="button" key={item.id} className={view === item.id ? 'tab active' : 'tab'}
            aria-current={view === item.id ? 'page' : undefined} onClick={() => onNavigate(item.id)}>{item.label}</button>)}
      </nav>}
      {commands}
      <span className="mode-badge">{mode === 'sample' ? 'Sample - no live business data' : 'Live - your delegated access'}</span>
      <details className="teams-utilities" onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.removeAttribute('open')
          event.currentTarget.querySelector('summary')?.focus()
        }
      }}><summary>Tools</summary><div className="utility-menu">
        {utilities.map((item) => <button type="button" key={item.id} onClick={(event) => {
          onNavigate(item.id)
          event.currentTarget.closest('details')?.removeAttribute('open')
          document.getElementById('tlc-main')?.focus()
        }}>{item.label}</button>)}
        {contextual && <a href="/" target="_blank" rel="noopener noreferrer">Open private workbench</a>}
      </div></details>
    </header>
    <main id="tlc-main" className="teams-main" tabIndex={-1}>{children}</main>
    <footer className="teams-footer">Grounded guidance. Human-reviewed changes. Your source-system permissions apply.</footer>
  </div>
}
