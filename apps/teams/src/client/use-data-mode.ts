import { useCallback, useEffect, useRef, useState } from 'react'
import { teamsApiBasePath, teamsDataModesSchema, type TeamsDataMode, type TeamsDataModes } from '../../../../packages/common/contracts/teams-data-mode.js'
import { initializeBrowserAuthentication, type BrowserAuthentication } from './authentication.js'

export function useTeamsDataMode() {
  const [catalog, setCatalog] = useState<TeamsDataModes>()
  const [selectedMode, setSelectedMode] = useState<TeamsDataMode>()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const authentications = useRef(new Map<string, BrowserAuthentication>())
  const initialization = useRef<Promise<void>>(Promise.resolve())
  const hostReady = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      const response = await fetch('/api/teams/modes', { credentials: 'omit', cache: 'no-store', signal: controller.signal })
      if (response.status === 404) { setError('This runtime does not support in-app mode switching. Rebuild it to enable the selector.'); return }
      if (!response.ok) throw new Error(`Data-mode availability could not be loaded (HTTP ${response.status}).`)
      const modes = teamsDataModesSchema.parse(await response.json())
      if (!controller.signal.aborted) { setCatalog(modes); setSelectedMode(modes.initialMode) }
    })().catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
      .finally(() => { if (!controller.signal.aborted) setReady(true) })
    return () => controller.abort()
  }, [])
  const initializeAuthentication = useCallback((onTheme: (theme: string) => void): Promise<BrowserAuthentication> => {
    const mode = selectedMode ?? catalog?.initialMode
    const key = mode ?? 'default'
    const initialize = async () => {
      const cached = authentications.current.get(key)
      if (cached && await cached.activate(onTheme)) return cached
      authentications.current.delete(key)
      const base = mode && catalog ? teamsApiBasePath(mode, catalog.runtimeMode) : '/api/teams'
      const auth = await initializeBrowserAuthentication(onTheme, base, hostReady.current)
      hostReady.current = auth.context.embedded
      if (mode && auth.configuration.mode !== mode) { await auth.clear(); throw new Error('The selected data mode does not match the backend response.') }
      authentications.current.set(key, auth)
      return auth
    }
    const result = initialization.current.then(initialize, initialize)
    initialization.current = result.then(() => undefined, () => undefined)
    return result
  }, [catalog, selectedMode])
  function select(mode: TeamsDataMode) {
    if (!catalog?.availableModes.includes(mode)) throw new Error('That data mode is not configured for this runtime.')
    setSelectedMode(mode)
  }
  return { catalog, selectedMode, ready, error, select, initializeAuthentication }
}
