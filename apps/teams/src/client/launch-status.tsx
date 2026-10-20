import { useEffect, useState } from 'react'
import { teamsClientReadyResultSchema, teamsLaunchStatusSchema, teamsLaunchVersion, type TeamsLaunchStatus } from '../../../../packages/common/contracts/teams-launch.js'
import type { BrowserAuthentication } from './authentication.js'
import type { TeamsApiClient } from './data-client.js'

declare const __TLC_TEAMS_CLIENT_BUILD_ID__: string
const clientBuildId = typeof __TLC_TEAMS_CLIENT_BUILD_ID__ === 'undefined' ? undefined : __TLC_TEAMS_CLIENT_BUILD_ID__

export function TeamsLaunchStatusPanel({ authentication, client, connected }: {
  authentication: BrowserAuthentication | undefined
  client: TeamsApiClient | undefined
  connected: boolean
}) {
  const [status, setStatus] = useState<TeamsLaunchStatus>()
  const [managed, setManaged] = useState(true)
  const [reported, setReported] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let refreshing = false
    const refresh = async () => {
      if (refreshing || document.visibilityState === 'hidden') return
      refreshing = true
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
        const response = await fetch('/api/teams/launch', { credentials: 'omit', cache: 'no-store', signal })
        if (controller.signal.aborted) return
        if (response.status === 404) { setManaged(false); setStatus(undefined); setReported(false); return }
        if (!response.ok) throw new Error(`Backend readiness check failed (HTTP ${response.status}). Run the launcher with -Status.`)
        const current = teamsLaunchStatusSchema.parse(await response.json())
        if (current.origin !== location.origin || current.clientBuildId !== clientBuildId) {
          throw new Error('This Teams client does not match the running backend build. Close this tab and run the launcher with -Resume to open the matching app.')
        }
        if (authentication && current.mode !== authentication.configuration.mode) throw new Error('The backend mode changed. Reopen the Teams app and pair again.')
        if (authentication && current.authentication !== ('authentication' in authentication.configuration ? authentication.configuration.authentication : 'hosted-obo')) {
          throw new Error('The backend authentication profile changed. Reopen the Teams app and pair again.')
        }
        if (authentication?.context.embedded && new URLSearchParams(location.search).get('tlcAppVersion') !== current.packageVersion) {
          throw new Error('The installed Teams app is stale or has no matching package-version stamp. Run the launcher with -Resume -Reinstall, accept the app update, then close and reopen My work in Teams.')
        }
        if (controller.signal.aborted) return
        setManaged(true); setStatus(current); setError('')
        if (authentication && client && connected) {
          await client.request('launch/ready', teamsClientReadyResultSchema, {
            contractVersion: teamsLaunchVersion, runId: current.runId, clientBuildId, packageVersion: current.packageVersion,
            host: authentication.context.embedded ? 'teams' : 'browser'
          }, signal)
          if (!controller.signal.aborted) setReported(true)
        } else setReported(false)
      } catch (cause) {
        if (!controller.signal.aborted) { setError(String(cause)); setReported(false) }
      } finally { refreshing = false }
    }
    const onVisibility = () => { void refresh() }
    void refresh()
    const timer = setInterval(onVisibility, 10_000)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [authentication, client, connected])
  const teams = authentication?.context.embedded === true
  return <>
    {error && <p role="alert" className="error-banner">{error}</p>}
    <details className="panel" aria-label="Backend connection">
      <summary>{!managed ? 'Backend connection - not launcher-managed' : error ? 'Backend connection - verification failed'
        : !status ? 'Checking backend connection...' : reported && teams ? 'Teams client and backend verified'
          : reported ? 'Browser preview connected - Teams verification still required' : connected ? 'Backend ready - checking client' : 'Backend ready - page pairing required'}</summary>
      {status ? <dl>
        <dt>Backend</dt><dd>{status.origin}</dd>
        <dt>Mode</dt><dd>{status.mode} / {status.authentication}</dd>
        <dt>App version</dt><dd>{status.packageVersion}</dd>
        <dt>Backend run</dt><dd><code>{status.runId}</code></dd>
        <dt>Client build</dt><dd><code>{status.clientBuildId}</code></dd>
        <dt>Client host</dt><dd>{teams ? 'Microsoft Teams' : 'Browser preview (not a Teams installation check)'}</dd>
      </dl> : <p>{managed ? 'Waiting for the backend identity check.' : 'This backend has no launcher verification session. Use run-teams-local.ps1 for guided setup and status.'}</p>}
      <p>Use the same launcher work directory with <code>-Status</code> to check or <code>-Resume</code> to finish without restarting. No source write is performed by these checks.</p>
    </details>
  </>
}
