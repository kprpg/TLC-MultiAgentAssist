import type { ReactNode } from 'react'

export type TeamsView = 'home' | 'accounts' | 'workflows' | 'meetings' | 'activity' | 'configure'
const destinations: Array<{ id: TeamsView; label: string }> = [
  { id: 'home', label: 'My work' }, { id: 'accounts', label: 'Accounts' },
  { id: 'workflows', label: 'Workflows' }, { id: 'meetings', label: 'Meetings' },
  { id: 'activity', label: 'Activity' }
]

export function TeamsShell({ mode, view, onNavigate, children }: {
  mode: 'sample' | 'live'; view: TeamsView; onNavigate(view: TeamsView): void; children: ReactNode
}) {
  return <div className="teams-shell">
    <header className="teams-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true">T</span><strong>TLC Assist</strong></div>
      <span className="mode-badge">{mode === 'sample' ? 'Sample - no live business data' : 'Live - your delegated access'}</span>
      <button type="button" className="subtle" onClick={() => onNavigate('configure')}>Context settings</button>
    </header>
    <nav className="teams-navigation" aria-label="TLC navigation">
      {destinations.map((item) => <button type="button" key={item.id} className={view === item.id ? 'selected' : 'subtle'}
        aria-current={view === item.id ? 'page' : undefined} onClick={() => onNavigate(item.id)}>{item.label}</button>)}
    </nav>
    <main id="tlc-main" className="teams-main">{children}</main>
    <footer className="teams-footer">Grounded guidance. Human-reviewed changes. Your source-system permissions apply.</footer>
  </div>
}
