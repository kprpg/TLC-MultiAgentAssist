import { useCallback, useState } from 'react'
import { defaultPortfolioPanes, initialTeamsView, togglePortfolioPane, type PortfolioPanes } from './workspace-navigation.js'

export function useWorkspaceNavigation(parameters: URLSearchParams) {
  const [view, setView] = useState(() => initialTeamsView(parameters))
  const [panes, setPanes] = useState(defaultPortfolioPanes)
  const togglePane = useCallback((pane: keyof PortfolioPanes) => setPanes((current) => togglePortfolioPane(current, pane)), [])
  return { view, setView, panes, togglePane }
}
