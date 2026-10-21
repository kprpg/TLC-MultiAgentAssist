import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { FluentProvider, teamsDarkTheme, teamsHighContrastTheme, teamsLightTheme } from '@fluentui/react-components'
import { meeting } from '@microsoft/teams-js'
import { z } from 'zod'
import { actionPreviewSchema, contextBindingSchema, type ActionPreview, type ActionReceipt, type TeamsSession } from '../../../../packages/common/contracts/collaboration.js'
import { accountCandidateSchema, accountSchema, opportunitySchema, type AccountCandidate } from '../../../../packages/common/contracts/index.js'
import type { BrowserAuthentication } from './authentication.js'
import { TeamsApiClient, type ReviewAction, type ReviewPreview } from './data-client.js'
import { TeamsShell } from './shell.js'
import { useWorkspaceNavigation } from './use-workspace-navigation.js'
import { teamsSurface } from './workspace-navigation.js'
import { sellerDashboardResponseSchema } from '../../../../packages/common/contracts/seller-dashboard.js'
import type { SellerDashboardRequest } from '../../../../packages/common/contracts/seller-dashboard.js'
import { PortfolioLayoutControls } from '../../../shared/portfolio-layout-controls.js'
import { PortfolioSearch } from './portfolio-search.js'
import { AccountsWorkspace, type WorkingSelection } from './accounts.js'
import { ContextWorkspace, SharedStage } from './context.js'
import { ReviewDialog } from './review-dialog.js'
import { NativeConnectionPanel } from './native-connection-panel.js'
import { TeamsLaunchStatusPanel } from './launch-status.js'
import { useTeamsDataMode } from './use-data-mode.js'
import { DataModeSwitcher } from './data-mode-switcher.js'
import type { TeamsDataMode } from '../../../../packages/common/contracts/teams-data-mode.js'
import { WorkspaceBoundary } from './workspace-boundary.js'

interface PendingReview { preview: ActionPreview; resolve(receipt: ActionReceipt): void; reject(error: Error): void }

const WorkflowsWorkspace = lazy(() => import('./workflows.js').then((module) => ({ default: module.WorkflowsWorkspace })))
const MeetingsWorkspace = lazy(() => import('./meetings.js').then((module) => ({ default: module.MeetingsWorkspace })))
const ActivityWorkspace = lazy(() => import('./activity.js').then((module) => ({ default: module.ActivityWorkspace })))
const DashboardWorkspace = lazy(() => import('../../../shared/dashboard-workspace.js').then((module) => ({ default: module.DashboardWorkspace })))

export function TeamsApp() {
  const parameters = new URLSearchParams(location.search)
  const surface = parameters.get('surface')
  const bindingId = parameters.get('bindingId')
  const referenceId = parameters.get('referenceId')
  const linkedRunId = parameters.get('runId')
  const [theme, setTheme] = useState('default')
  const [authentication, setAuthentication] = useState<BrowserAuthentication>()
  const [client, setClient] = useState<TeamsApiClient>()
  const [session, setSession] = useState<TeamsSession>()
  const { view, setView, panes, togglePane } = useWorkspaceNavigation(parameters)
  const [selection, setSelection] = useState<WorkingSelection | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<PendingReview | null>(null)
  const pendingRef = useRef<PendingReview | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [sharedId, setSharedId] = useState('')
  const [requiredClaims, setRequiredClaims] = useState<string>()
  const [reference, setReference] = useState<AccountCandidate>()
  const [preferredAccountId, setPreferredAccountId] = useState('')
  const [preferredOpportunityId, setPreferredOpportunityId] = useState('')
  const [boundOpportunityId, setBoundOpportunityId] = useState('')
  const [bindingStatus, setBindingStatus] = useState<'loading' | 'ready' | 'denied'>(bindingId ? 'loading' : 'ready')

  const clearPrivateWorkspace = useCallback((message: string) => {
    setSession(undefined); setSelection(null); setReference(undefined)
    setPreferredAccountId(''); setPreferredOpportunityId(''); setBoundOpportunityId(''); setSharedId(''); setNotice('')
    setBindingStatus(bindingId ? 'loading' : 'ready')
    pendingRef.current?.reject(new Error('Reconnect and prepare a fresh review before continuing.'))
    pendingRef.current = null; setPending(null); setError(message)
  }, [bindingId])
  const dataMode = useTeamsDataMode()
  useEffect(() => {
    if (!dataMode.ready) return
    let alive = true
    let api: TeamsApiClient | undefined
    dataMode.initializeAuthentication((value) => { if (alive) setTheme(value) }).then(async (auth) => {
      if (!alive) return
      setAuthentication(auth)
      const localConnection = auth.localConnection
      api = new TeamsApiClient(() => auth.getToken(), (claims) => {
        if (!alive) return
        auth.localConnection?.clear(); setRequiredClaims(claims)
        clearPrivateWorkspace('Sign in again to satisfy current access policy. Private results were cleared; reopen any unsent review.')
      }, localConnection ? (token) => localConnection.isCurrentToken(token) : undefined, auth.apiBasePath, auth.configuration.mode)
      setClient(api)
      if (auth.localConnection && !auth.localConnection.sessionExpiresAt()) return
      const identity = await api.session()
      if (alive) setSession(identity)
    }).catch((cause: unknown) => { if (alive) setError(String(cause)) })
    return () => { alive = false; api?.dispose() }
  }, [clearPrivateWorkspace, dataMode.ready, dataMode.initializeAuthentication])
  const finishLocalConnection = useCallback(async () => {
    if (!client) throw new Error('The local API client is unavailable.')
    setError(''); setRequiredClaims(undefined); setSession(await client.session())
  }, [client])
  useEffect(() => {
    if (!client || !session || !bindingId) return
    const controller = new AbortController()
    void (async () => {
      const binding = await client.request(`contexts/${encodeURIComponent(bindingId)}`, contextBindingSchema, undefined, controller.signal)
      const accounts = await client.operation('listAccounts', {}, z.array(accountSchema), controller.signal)
      const account = accounts.find((item) => item.id === binding.accountId)
      if (!account) throw new Error('The bound account is unavailable with your source permissions.')
      const opportunities = await client.operation('listOpportunities', { accountId: account.id }, z.array(opportunitySchema), controller.signal)
      const opportunity = binding.opportunityId ? opportunities.find((item) => item.id === binding.opportunityId) : opportunities[0]
      if (binding.opportunityId && !opportunity) throw new Error('The bound opportunity is unavailable with your source permissions.')
      if (!controller.signal.aborted) {
        setPreferredAccountId(account.id); setBoundOpportunityId(binding.opportunityId ?? ''); setPreferredOpportunityId(binding.opportunityId ?? ''); setBindingStatus('ready')
        if (opportunity) setSelection({ account, opportunity })
      }
    })().catch((cause: unknown) => { if (!controller.signal.aborted) { setBindingStatus('denied'); setError(String(cause)) } })
    return () => controller.abort()
  }, [client, session, bindingId])
  useEffect(() => {
    if (!client || !session || !referenceId) return
    const controller = new AbortController()
    client.request(`references/${encodeURIComponent(referenceId)}`, accountCandidateSchema, undefined, controller.signal).then((candidate) => {
      if (controller.signal.aborted) return
      setReference(candidate); setView('portfolio')
      if (candidate.state === 'visible') setPreferredAccountId(candidate.id)
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client, session, referenceId])
  const reviewPreview = useCallback<ReviewPreview>((preview) => new Promise((resolve, reject) => {
    if (pendingRef.current) { reject(new Error('Finish or cancel the current review first.')); return }
    const next = { preview, resolve, reject }
    pendingRef.current = next
    setReviewError(''); setPending(next)
  }), [])
  const review = useCallback<ReviewAction>(async (operation, input) => {
    if (!client) throw new Error('Sign in before reviewing changes.')
    if (authentication && 'authentication' in authentication.configuration && authentication.configuration.authentication === 'local-azure-cli' &&
        authentication.configuration.writeMode === 'read-only') {
      throw new Error('This Azure CLI connection is read-only. Relaunch with -CliWriteMode reviewed to enable explicitly reviewed MSX changes.')
    }
    return reviewPreview(await client.preview(operation, input))
  }, [client, reviewPreview, authentication])
  function cancelReview() {
    pendingRef.current?.reject(new Error('Review canceled. No new changes were sent.'))
    pendingRef.current = null; setPending(null)
  }
  async function confirmReview(reason: string) {
    if (!client || !pendingRef.current) return
    setReviewBusy(true); setReviewError('')
    try {
      const receipt = await client.commit(pendingRef.current.preview, reason)
      pendingRef.current.resolve(receipt)
      pendingRef.current = null; setPending(null)
      setNotice(receipt.state === 'confirmed' ? 'Reviewed operation completed.'
        : receipt.state === 'failed-before-send' ? 'No external change was dispatched. Resume work and prepare a fresh review.'
          : 'Outcome unconfirmed. Do not repeat the operation; open Activity.')
      if (receipt.operation === 'publishSummary' && receipt.state === 'confirmed') {
        const result = z.object({ sharedId: z.string() }).parse(receipt.result)
        setSharedId(result.sharedId)
      }
    } catch (cause) { setReviewError(`${String(cause)}. Check Activity before retrying a request that may have been sent.`) }
    finally { setReviewBusy(false) }
  }
  async function signIn() {
    if (!authentication || !client) return
    try { setError(''); await authentication.getToken(true, requiredClaims); setSession(await client.session()) }
    catch (cause) { setError(String(cause)) }
  }
  async function publish() {
    if (!client || !bindingId) return
    try {
      await reviewPreview(await client.request('publications/preview', actionPreviewSchema, { bindingId }))
    } catch (cause) { setError(String(cause)) }
  }
  async function curateReference() {
    if (!reference || !client) return
    try {
      const receipt = await review(reference.state === 'hidden' ? 'setAccountVisibility' : 'addAccount',
        reference.state === 'hidden' ? { accountId: reference.id, visibility: 'visible' } : { accountId: reference.id })
      if (receipt.state !== 'confirmed') throw new Error('The account action needs reconciliation. Open Activity.')
      setPreferredAccountId(reference.id); setReference(undefined)
    } catch (cause) { setError(String(cause)) }
  }
  function shareStage() {
    if (!sharedId) return
    if (session?.mode === 'live') {
      setError('Live stage sharing is blocked until the current meeting audience can be authoritatively verified. Channel membership alone is not sufficient.')
      return
    }
    const url = `${location.origin}/?surface=stage&artifactId=${encodeURIComponent(sharedId)}`
    if (!authentication?.context.embedded) { window.open(url, '_blank', 'noopener'); return }
    meeting.shareAppContentToStage((cause) => { if (cause) setError('Teams could not share this approved brief on the current client.') }, url)
  }
  const selectedTheme = theme === 'dark' ? teamsDarkTheme : theme === 'contrast' ? teamsHighContrastTheme : teamsLightTheme
  const workspaceAllowed = !bindingId || bindingStatus === 'ready'
  const hostSurface = teamsSurface(parameters, authentication?.context.frameContext)
  function switchDataMode(mode: TeamsDataMode) {
    if (reviewBusy) { setError('Wait for the current write confirmation before switching modes.'); return }
    if (bindingId || hostSurface !== 'personal') { setError('Data-mode switching is available in the personal workbench only.'); return }
    if (!dataMode.catalog?.availableModes.includes(mode)) { setError('That data mode is not configured for this runtime.'); return }
    if (authentication?.localConnection && !authentication.localConnection.sessionExpiresAt()) authentication.localConnection.clear()
    client?.dispose()
    clearPrivateWorkspace('')
    setClient(undefined); setAuthentication(undefined); setRequiredClaims(undefined); setReviewError('')
    const url = new URL(location.href)
    for (const key of ['referenceId', 'runId', 'artifactId', 'accountId', 'opportunityId']) url.searchParams.delete(key)
    url.searchParams.set('view', 'portfolio')
    history.replaceState(null, '', url)
    setView('portfolio')
    dataMode.select(mode)
  }
  const modeControl = hostSurface === 'personal' && !bindingId && authentication
    ? <DataModeSwitcher catalog={dataMode.catalog} mode={authentication.configuration.mode} locked={reviewBusy}
      error={dataMode.error} onSwitch={switchDataMode} /> : null
  const focusPortfolio = useCallback((accountId: string, opportunityId = '') => {
    setPreferredAccountId(accountId); setPreferredOpportunityId(opportunityId); setView('portfolio')
  }, [setView])
  const invokeDashboard = useCallback((input: SellerDashboardRequest) => {
    if (!client) throw new Error('Sign in before opening Dashboards.')
    return client.operation('sellerDashboard', input, sellerDashboardResponseSchema)
  }, [client])
  useEffect(() => {
    if (hostSurface === 'panel') setView('meetings')
    if (hostSurface === 'configure') setView('configure')
  }, [hostSurface, setView])
  return <FluentProvider theme={selectedTheme}>
    {hostSurface === 'personal' && !bindingId && <TeamsLaunchStatusPanel authentication={authentication} client={client} connected={!!session} runtimeModes={dataMode.catalog} />}
    {!session || !client || !authentication ? <main className="signin-panel">
      <h1>TLC Assist for Teams</h1><p>Private, grounded account-team guidance.</p>
      {modeControl}
      {error ? <p role="alert" className="error-banner">{error}</p> : <p role="status">{authentication?.localConnection ? 'Local runtime ready. Connect and pair this page yourself to access live MSX.' : 'Initializing your Teams workspace...'}</p>}
      {authentication?.localConnection && client ? <NativeConnectionPanel connection={authentication.localConnection} client={client}
        authentication={'authentication' in authentication.configuration ? authentication.configuration.authentication : 'local-interactive'}
        writeMode={'writeMode' in authentication.configuration ? authentication.configuration.writeMode : 'read-only'}
        connected={false} onConnected={finishLocalConnection} onDisconnected={clearPrivateWorkspace} />
        : authentication?.configuration.mode === 'live' && <button type="button" className="primary" onClick={() => { void signIn() }}>Sign in with Microsoft</button>}
    </main> : surface === 'stage' ? <SharedStage client={client} artifactId={parameters.get('artifactId')} /> : <TeamsShell mode={session.mode} view={view} onNavigate={setView} surface={hostSurface}
      commands={<>
        {modeControl}
        {hostSurface === 'personal' && <PortfolioSearch client={client} contextKey={`${session.mode}:${view}`} onSelect={focusPortfolio} />}
        {view === 'portfolio' && <PortfolioLayoutControls {...panes} onToggleAccounts={() => togglePane('accountsExpanded')}
          onToggleDetails={() => togglePane('detailsExpanded')} onToggleActions={() => togglePane('actionsExpanded')} />}
      </>}>
      {error && <p role="alert" className="error-banner">{error}</p>}
      {notice && <p role="status" className="success-banner">{notice}</p>}
      {authentication.localConnection && <NativeConnectionPanel connection={authentication.localConnection} client={client}
        authentication={'authentication' in authentication.configuration ? authentication.configuration.authentication : 'local-interactive'}
        writeMode={'writeMode' in authentication.configuration ? authentication.configuration.writeMode : 'read-only'}
        connected={true} onConnected={finishLocalConnection} onDisconnected={clearPrivateWorkspace} />}
      {reference && <section className="panel"><h2>Private account reference</h2><p>{reference.name}: {reference.state === 'visible' ? 'already available in your Portfolio' : reference.state === 'hidden' ? 'hidden in your private Portfolio' : 'accessible in search, not yet added'}.</p>
        {reference.state !== 'visible' && <button type="button" onClick={() => { void curateReference() }}>{reference.state === 'hidden' ? 'Review unhiding account' : 'Review adding account'}</button>}
      </section>}
      {bindingId && <div className="context-banner">Bound Teams workspace. Data below uses your own source permissions.
        <button type="button" onClick={() => { void publish() }}>Preview shared brief</button>
        {sharedId && <button type="button" onClick={shareStage}>Share approved brief to stage</button>}
      </div>}
      {workspaceAllowed && view === 'home' && <section className="hero panel">
        <p className="eyebrow">YOUR ACCOUNT-TEAM WORKSPACE</p><h1>Turn account signals into your next action.</h1>
        <p>Stay in Teams. Explore your portfolio, run shared TLC workflows, and review meeting-derived updates before they change MSX.</p>
        <div className="home-cards">
          <button type="button" onClick={() => setView('portfolio')}><strong>Work an account</strong><span>Portfolio, Discovery, MCEM and grounded guidance</span></button>
          <button type="button" onClick={() => setView('plays')}><strong>Run a workflow</strong><span>Evidence, source health and actionable results</span></button>
          <button type="button" onClick={() => setView('meetings')}><strong>Prepare and follow up</strong><span>Automatic authorized transcript acquisition</span></button>
        </div>
        <p className="privacy-note">{session.mode === 'sample' ? 'This demonstration uses the canonical sanitized SQLite dataset. No live MSX, Graph, MCP or Foundry calls.'
          : 'authentication' in authentication.configuration && authentication.configuration.authentication === 'local-azure-cli'
            ? 'Private MSX access uses your verified current CLI user and source permissions. Source changes require enabled reviewed-write mode and explicit approval. No FTE or publication role is inferred.'
            : 'Microsoft FTE access, your delegated source rights, and reviewed-action policies are enforced separately.'}</p>
      </section>}
      {bindingId && bindingStatus !== 'ready' ? <section className="panel"><h1>{bindingStatus === 'denied' ? 'Bound workspace unavailable' : 'Loading your authorized bound workspace'}</h1>
        <p>A shared tab does not grant account access. <a href={`${location.origin}/`}>Open your private workbench</a>.</p>
      </section> : <div hidden={!['portfolio', 'discover', 'new'].includes(view)}><AccountsWorkspace client={client} mode={session.mode} selection={selection} onSelect={setSelection} review={review}
        preferredAccountId={preferredAccountId} preferredOpportunityId={preferredOpportunityId} panes={panes}
        {...(view === 'new' ? { workspace: 'new' as const } : view === 'discover' ? { workspace: 'discovery' as const } : view === 'portfolio' ? { workspace: 'portfolio' as const } : {})}
        onMeeting={() => setView('meetings')} onFocus={focusPortfolio}
        {...(bindingId && preferredAccountId ? { boundAccountId: preferredAccountId, boundOpportunityId } : {})} /></div>}
      <WorkspaceBoundary key={view}><Suspense fallback={<section className="panel" role="status">Loading workspace controls...</section>}>
      {workspaceAllowed && view === 'plays' && <WorkflowsWorkspace client={client} selection={selection} onFocus={focusPortfolio}
        {...('authentication' in authentication.configuration ? { authentication: authentication.configuration.authentication } : {})}
        {...(linkedRunId ? { initialRunId: linkedRunId } : {})} {...(bindingId && preferredAccountId ? {
        scope: selection ? { kind: 'opportunity' as const, accountId: selection.account.id, opportunityId: selection.opportunity.id } : { kind: 'account' as const, accountId: preferredAccountId }
      } : {})} />}
      {workspaceAllowed && view === 'dashboard' && !bindingId && <DashboardWorkspace invokeSellerDashboard={invokeDashboard} />}
      {workspaceAllowed && view === 'meetings' && <MeetingsWorkspace client={client} mode={session.mode} selection={selection} reviewPreview={reviewPreview} compact={hostSurface === 'panel'}
        graphAvailable={!('authentication' in authentication.configuration && authentication.configuration.authentication === 'local-azure-cli')} />}
      {workspaceAllowed && view === 'activity' && <ActivityWorkspace client={client} onDisconnect={() => {
        setSelection(null); setReference(undefined)
        pendingRef.current?.reject(new Error('Work disconnected. Resume and prepare a fresh review.'))
        pendingRef.current = null; setPending(null)
      }} />}
      {workspaceAllowed && view === 'configure' && <ContextWorkspace client={client} host={authentication.context} selection={selection} />}
      </Suspense></WorkspaceBoundary>
    </TeamsShell>}
    <ReviewDialog preview={pending?.preview ?? null} onCancel={cancelReview} onConfirm={(reason) => { void confirmReview(reason) }} error={reviewError} busy={reviewBusy} />
  </FluentProvider>
}
