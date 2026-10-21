import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from '@fluentui/react-components'
import * as c from '../../../../packages/common/contracts/index.js'
import { AddCustomerButton, type CustomerAccount, type CustomerSearchClient } from '../../../shared/add-customer.js'
import { NewWorkspace, type CreationClient } from '../../../shared/record-creation/new-workspace.js'
import { sortOpportunities, type OpportunitySort, type SortDirection } from '../../../shared/portfolio-sorting.js'
import { formatOpportunityIntent } from '../../../shared/opportunity-intent.js'
import { sellerMoney } from '../../../shared/seller-dashboard-analysis.js'
import { OpportunityWorkbench, type DetailTab } from './opportunity-workbench.js'
import { DiscoveryWorkspace } from './discovery.js'
import { defaultPortfolioPanes, type PortfolioPanes } from './workspace-navigation.js'
import type { TeamsApiClient, ReviewAction } from './data-client.js'
import { useResponsiveDisclosure } from './use-responsive-disclosure.js'
import { OpportunityCommentsEditor } from './record-actions.js'

export interface WorkingSelection { account: c.Account; opportunity: c.Opportunity }
type AccountWorkspace = 'portfolio' | 'discovery' | 'new'
function customerView(account: c.Account): CustomerAccount {
  return { id: account.id, name: account.name, segment: account.segment, ...(account.tpid === undefined ? {} : { tpid: account.tpid }) }
}

export function AccountsWorkspace({ client, mode, selection, onSelect, review, preferredAccountId, preferredOpportunityId, boundAccountId, boundOpportunityId, workspace, panes = defaultPortfolioPanes, onMeeting, onFocus }: {
  client: TeamsApiClient; mode: 'sample' | 'live'; selection: WorkingSelection | null
  onSelect(selection: WorkingSelection | null): void; review: ReviewAction
  preferredAccountId?: string; preferredOpportunityId?: string; boundAccountId?: string; boundOpportunityId?: string; workspace?: AccountWorkspace
  panes?: PortfolioPanes; onMeeting(): void; onFocus(accountId: string, opportunityId: string): void
}) {
  const [accounts, setAccounts] = useState<c.Account[]>([])
  const [accountId, setAccountId] = useState(selection?.account.id ?? preferredAccountId ?? '')
  const [requestedAccountId, setRequestedAccountId] = useState(selection?.account.id ?? preferredAccountId ?? '')
  const [requestedOpportunityId, setRequestedOpportunityId] = useState(preferredOpportunityId ?? '')
  const [opportunities, setOpportunities] = useState<c.Opportunity[]>([])
  const [milestones, setMilestones] = useState<c.Milestone[]>([])
  const [tab, setTab] = useState<AccountWorkspace>(workspace ?? 'portfolio')
  const [newOpened, setNewOpened] = useState(workspace === 'new')
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showHidden, setShowHidden] = useState(false)
  const [sort, setSort] = useState<OpportunitySort>('closeDate')
  const [direction, setDirection] = useState<SortDirection>('ascending')
  const dirty = useRef(false)
  const [pendingScope, setPendingScope] = useState<{ apply(): void; cancel?(): void }>()
  const selected = useRef(selection)
  const scopeDisclosure = useResponsiveDisclosure(900, panes.accountsExpanded)
  selected.current = selection
  useEffect(() => {
    if (workspace) setTab(workspace)
    if (workspace === 'new') setNewOpened(true)
  }, [workspace])
  function changeScope(apply: () => void, cancel?: () => void) {
    if (dirty.current) { setPendingScope({ apply, ...(cancel ? { cancel } : {}) }); return }
    apply()
  }
  function cancelScopeChange() {
    pendingScope?.cancel?.()
    setPendingScope(undefined)
  }
  useEffect(() => {
    if (tab !== 'portfolio') return
    const controller = new AbortController()
    setLoading(true); setError(''); setOpportunities([]); setMilestones([])
    client.operation('getPortfolioWorkspace', {
      contractVersion: c.portfolioReadVersion, includeHidden: showHidden,
      ...(boundAccountId || requestedAccountId ? { accountId: boundAccountId || requestedAccountId } : {}),
      ...(boundOpportunityId || requestedOpportunityId ? { opportunityId: boundOpportunityId || requestedOpportunityId } : {})
    }, c.portfolioWorkspaceSchema, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      const scoped = boundAccountId ? result.accounts.filter((item) => item.id === boundAccountId) : result.accounts
      const eligible = boundOpportunityId ? result.opportunities.filter((item) => item.id === boundOpportunityId) : result.opportunities
      setAccounts(scoped); setOpportunities(eligible); setMilestones(result.milestones); setLoading(false)
      setAccountId(result.selectedAccountId ?? '')
      const account = scoped.find((item) => item.id === result.selectedAccountId)
      const opportunity = eligible.find((item) => item.id === result.selectedOpportunityId)
      onSelect(account && opportunity ? { account, opportunity } : null)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setAccounts([]); setOpportunities([]); onSelect(null); setError(String(cause)); setLoading(false) }
    })
    return () => controller.abort()
  }, [client, revision, boundAccountId, boundOpportunityId, requestedAccountId, requestedOpportunityId, showHidden, tab])
  useEffect(() => {
    if (!preferredAccountId || boundAccountId && boundAccountId !== preferredAccountId) return
    if (selected.current?.account.id === preferredAccountId && (!preferredOpportunityId || selected.current.opportunity.id === preferredOpportunityId)) return
    changeScope(() => {
      setRequestedOpportunityId(preferredOpportunityId ?? '')
      setAccountId(preferredAccountId)
      setRequestedAccountId(preferredAccountId)
    }, () => { if (selected.current) onFocus(selected.current.account.id, selected.current.opportunity.id) })
  }, [preferredAccountId, preferredOpportunityId, boundAccountId])
  const mutate = useCallback(async (operation: string, input: Record<string, unknown>) => {
    setError('')
    const receipt = await review(operation, input)
    if (receipt.state !== 'confirmed') throw new Error('The action outcome is unconfirmed. Do not repeat it. Open Activity.')
    dirty.current = false
    if (['leaveDealTeam', 'leaveMilestoneTeam'].includes(operation) && input['opportunityId'] === selected.current?.opportunity.id) setRequestedOpportunityId('')
    if (operation === 'setAccountVisibility' && input['visibility'] === 'hidden' && input['accountId'] === selected.current?.account.id) {
      setRequestedAccountId(''); setRequestedOpportunityId(''); setAccountId(''); onSelect(null)
    }
    setRevision((value) => value + 1)
    return receipt.result
  }, [review])
  const searchClient = useMemo<CustomerSearchClient>(() => ({
    getDataMode: async () => mode,
    searchAccounts: async (input) => (await client.operation('searchAccounts', input, z.array(c.accountCandidateSchema))).map((entry) => ({ ...customerView(entry), state: entry.state })),
    addAccount: async (id) => customerView(c.accountSchema.parse(await mutate('addAccount', { accountId: id }))),
    setAccountVisibility: async (id, visibility) => customerView(c.accountSchema.parse(await mutate('setAccountVisibility', { accountId: id, visibility })))
  }), [client, mode, mutate])
  const creationClient = useMemo<CreationClient>(() => ({
    listAccounts: async () => (await client.operation('listAccounts', {}, z.array(c.accountSchema))).map((entry) => ({
      id: entry.id, name: entry.name, ...(entry.visibility === undefined ? {} : { visibility: entry.visibility })
    })),
    getRecordCreationCatalog: (id) => client.operation('getRecordCreationCatalog', { contractVersion: c.contractVersion, accountId: id }, c.recordCreationCatalogSchema),
    previewRecordCreation: (target, draft) => client.operation('previewRecordCreation', { contractVersion: c.contractVersion, target, draft }, c.recordCreationPreviewSchema),
    commitRecordCreation: async (preview) => c.recordCreationResultSchema.parse(await mutate('commitRecordCreation', {
      contractVersion: c.contractVersion, preview, expectedDigest: preview.digest, confirmed: true
    })),
    exportRecordCreationDraft: (preview) => client.operation('exportRecordCreationDraft', {
      contractVersion: c.contractVersion, preview, expectedDigest: preview.digest, confirmed: true
    }, c.recordCreationDraftResultSchema)
  }), [client, mutate])
  async function action(operation: string, input: Record<string, unknown>) {
    try { await mutate(operation, input) } catch (cause) { setError(String(cause)) }
  }
  function selectOpportunity(id: string) {
    if (boundOpportunityId && id !== boundOpportunityId) return
    if (id === selection?.opportunity.id) return
    changeScope(() => {
      setRequestedOpportunityId(id)
      const account = accounts.find((item) => item.id === accountId)
      const opportunity = opportunities.find((item) => item.id === id)
      onSelect(account && opportunity ? { account, opportunity } : null)
    })
  }
  return <section aria-label="Account workspaces">
    {error && <p role="alert" className="error-banner">{error}</p>}
    <div hidden={tab !== 'portfolio'}>
      <div className="workspace-heading"><h1>Portfolio</h1><p className="muted">{mode === 'sample' ? 'Canonical sanitized sample data' : 'Private - your delegated source access'}</p>
        <button type="button" onClick={() => changeScope(() => setRevision((value) => value + 1))}>Refresh sources</button></div>
      {loading && <p role="status">Loading portfolio accounts, opportunities and milestones...</p>}
      {error && <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry Portfolio</button>}
      <div className={`portfolio-workbench${panes.accountsExpanded ? '' : ' accounts-collapsed'}${panes.detailsExpanded ? '' : ' details-collapsed'}${panes.actionsExpanded ? '' : ' actions-collapsed'}`}>
        <details className="portfolio-scope-disclosure" ref={scopeDisclosure} open hidden={!panes.accountsExpanded}><summary className="pane-disclosure-toggle">Account and opportunity scope</summary>
        <section id="portfolio-accounts-panel" className="pane portfolio-scope" hidden={!panes.accountsExpanded} aria-label="Accounts and opportunities">
          <div className="section-heading"><h2>Accounts</h2>{!boundAccountId && <AddCustomerButton client={searchClient} dataMode={mode} onAdded={(account) => { setAccountId(account.id); setRequestedAccountId(account.id); setRevision((value) => value + 1) }} />}</div>
          <label className="field">Customer account<select aria-label="Customer account" value={accountId} disabled={Boolean(boundAccountId)} onChange={(event) => {
            const nextAccountId = event.target.value
            changeScope(() => { setRequestedOpportunityId(''); onSelect(null); setAccountId(nextAccountId); setRequestedAccountId(nextAccountId) })
          }}><option value="">Choose an account</option>{accounts.filter((item) => item.visibility !== 'hidden').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {!boundAccountId && <><label className="inline-check"><input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />Show hidden</label>
            {selection && <button type="button" className="link" onClick={() => { void action('setAccountVisibility', { accountId, visibility: 'hidden' }) }}>Hide selected customer</button>}
            {showHidden && accounts.filter((item) => item.visibility === 'hidden').map((item) => <button key={item.id} type="button" onClick={() => { void action('setAccountVisibility', { accountId: item.id, visibility: 'visible' }) }}>Unhide {item.name}</button>)}
          </>}
          <h2 className="section-label">Opportunities</h2>
          <div className="toolbar"><label>Sort opportunities<select value={sort} onChange={(event) => {
            const value = event.target.value
            if (value === 'closeDate' || value === 'stage' || value === 'value') setSort(value)
          }}><option value="closeDate">Close Date</option><option value="stage">Stage</option><option value="value">Value</option></select></label>
            <button type="button" onClick={() => setDirection((current) => current === 'ascending' ? 'descending' : 'ascending')}>{direction === 'ascending' ? 'Asc' : 'Desc'}</button></div>
          <label className="field compact-opportunity-picker">Opportunity<select aria-label="Opportunity" value={selection?.opportunity.id ?? ''} disabled={Boolean(boundOpportunityId)} onChange={(event) => selectOpportunity(event.target.value)}>
            <option value="">Choose an opportunity</option>{opportunities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="record-table-wrap" role="region" aria-label="Opportunity list" tabIndex={0}><table className="portfolio-records"><thead><tr><th>Opportunity name</th><th>Intent</th><th>Stage</th><th>Comments</th></tr></thead>
            <tbody>{sortOpportunities(opportunities, sort, direction).map((item) => <tr key={item.id} className={item.id === selection?.opportunity.id ? 'selected-row' : ''}>
              <td><button type="button" className="record-link" title={item.name} onClick={() => selectOpportunity(item.id)}>{item.name}</button><small>{sellerMoney(item.value, true, item.currency)}</small></td>
              <td>{formatOpportunityIntent(item.opportunityIntent)}</td><td>Stage {item.recordedStage}</td>
              <td className="opportunity-comments"><span className="opportunity-comments-preview">{item.comments || 'No comments recorded.'}</span>
                <details><summary>Opportunity Comments</summary>
                  <OpportunityCommentsEditor opportunity={item} onAction={action} onDraftChange={() => { dirty.current = true }} label={`Comments for ${item.name}`} />
                </details>
              </td>
            </tr>)}</tbody></table></div>
          {!loading && !error && !opportunities.length && <p>No eligible Portfolio opportunities. Use Discover to review your working set.</p>}
          {!loading && !error && !accounts.length && <p>No customer accounts. Use Add customer to get started.</p>}
        </section></details>
        {selection ? <OpportunityWorkbench key={`${selection.opportunity.id}:${revision}`} client={client} selection={selection} opportunities={opportunities}
          milestones={milestones} panes={panes} tab={detailTab} onTabChange={setDetailTab} onSelectOpportunity={selectOpportunity}
          onAction={action} onMeeting={onMeeting} onDraftChange={() => { dirty.current = true }} />
          : <section className="pane"><h2>{loading ? 'Loading your selected workspace' : 'Select an opportunity'}</h2>
            {!loading && !error && <p>An account may be visible without any eligible Portfolio opportunities.</p>}</section>}
      </div>
    </div>
    <DiscoveryWorkspace client={client} mode={mode} active={tab === 'discovery'} searchClient={searchClient} onAction={mutate}
      {...(boundAccountId ? { boundAccountId } : {})} />
    <Dialog open={!!pendingScope} onOpenChange={(_, data) => { if (!data.open) cancelScopeChange() }}>
        <DialogSurface className="teams-review-dialog"><DialogBody>
          <DialogTitle>Discard unsent edits?</DialogTitle>
          <DialogContent>Changing customer, opportunity or refreshing sources discards unsent edits for this opportunity. No source change has been sent.</DialogContent>
          <DialogActions>
            <button type="button" onClick={cancelScopeChange}>Keep editing</button>
            <button type="button" className="primary" onClick={() => {
              const change = pendingScope
              setPendingScope(undefined); dirty.current = false; change?.apply()
            }}>Discard edits and continue</button>
          </DialogActions>
        </DialogBody></DialogSurface>
    </Dialog>
    <div hidden={tab !== 'new'}>{newOpened && <section className="panel"><h1>New / draft</h1>
      <p>{mode === 'live' ? 'Live record creation stays disabled. Export a reviewed draft.' : 'Creation changes the sample SQLite store only.'}</p>
      <NewWorkspace client={creationClient} onCommitted={onFocus} />
    </section>}</div>
  </section>
}
