export type TeamsView = 'new' | 'discover' | 'portfolio' | 'plays' | 'dashboard' | 'home' | 'meetings' | 'activity' | 'configure'
export type TeamsSurface = 'personal' | 'bound' | 'meeting' | 'panel' | 'configure'
export interface PortfolioPanes { accountsExpanded: boolean; detailsExpanded: boolean; actionsExpanded: boolean }
export const defaultPortfolioPanes: PortfolioPanes = { accountsExpanded: true, detailsExpanded: true, actionsExpanded: true }

export function initialTeamsView(parameters: URLSearchParams): TeamsView {
  if (parameters.get('surface') === 'configure') return 'configure'
  if (parameters.get('surface') === 'meeting') return 'meetings'
  if (parameters.has('bindingId')) return 'portfolio'
  const view = parameters.get('view')
  if (view === 'new' || view === 'discover' || view === 'plays' || view === 'dashboard' || view === 'activity' || view === 'meetings' || view === 'home') return view
  return 'portfolio'
}

export function teamsSurface(parameters: URLSearchParams, frameContext?: string): TeamsSurface {
  if (frameContext === 'settings' || parameters.get('surface') === 'configure') return 'configure'
  if (frameContext === 'sidePanel') return 'panel'
  if (parameters.has('bindingId')) return 'bound'
  return parameters.get('surface') === 'meeting' ? 'meeting' : 'personal'
}

export function togglePortfolioPane(panes: PortfolioPanes, pane: keyof PortfolioPanes): PortfolioPanes {
  const next = { ...panes, [pane]: !panes[pane] }
  return Object.values(next).some(Boolean) ? next : { ...next, detailsExpanded: true }
}
