import { useEffect, useState } from 'react'
import { Button, FluentProvider, Tooltip, webDarkTheme, webLightTheme } from '@fluentui/react-components'
import {
  Apps20Regular,
  ArrowClockwise20Regular,
  Building20Regular,
  CheckmarkCircle20Filled,
  ChevronDoubleLeft20Regular,
  ChevronDoubleRight20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  ClipboardTaskListLtr20Regular,
  Dismiss20Regular,
  Home20Regular,
  Lightbulb20Regular,
  List20Regular,
  MoreHorizontal20Regular,
  PanelRight20Regular,
  Person20Regular,
  Power20Regular,
  Search20Regular,
  Sparkle20Regular,
  Warning20Filled
} from '@fluentui/react-icons'
import type { Account, AgentCapability, AgentTaskResponse, McemResponse, Opportunity } from '../../../../packages/common/index.js'
import { createDataClient, stageOwner, type RevampDataClient } from './data-client.js'

type Shell = 'desktop' | 'web'
type CenterTab = 'msx' | 'guidance'
type Blade = 'accounts' | 'opportunities' | 'milestones' | 'actions'
type SearchResult =
  | { type: 'account'; account: Account }
  | { type: 'opportunity'; account: Account; opportunity: Opportunity }

const capabilities: { id: AgentCapability; label: string }[] = [
  { id: 'account-pulse', label: 'Account Pulse' },
  { id: 'mcem-coach', label: 'MCEM Coach' },
  { id: 'pursuit-executive', label: 'Pursuit' },
  { id: 'risk-solution-play', label: 'Risk & Play' }
]

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function stageStatus(result: McemResponse): 'advance' | 'aligned' | 'gap' {
  if (result.evidenceBasedStage > result.recordedStage) return 'advance'
  if (result.evidenceBasedStage === result.recordedStage) return 'aligned'
  return 'gap'
}

function BladeHeader({ title, subtitle, collapsed, refreshing, onRefresh, onToggle, onClose }: { title: string; subtitle?: string; collapsed: boolean; refreshing: boolean; onRefresh(): void; onToggle(): void; onClose?: () => void }) {
  return <header className="blade-header">
    {!collapsed && <div><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div>}
    <div className="blade-header-actions">
      {!collapsed && <Button appearance="subtle" className="icon-button" disabled={refreshing} icon={<ArrowClockwise20Regular />} onClick={onRefresh} aria-label={`Refresh ${title}`} title={`Refresh ${title}`} />}
      <Button
        appearance="subtle"
        className="icon-button desktop-only"
        icon={collapsed ? <ChevronDoubleRight20Regular /> : <ChevronDoubleLeft20Regular />}
        onClick={onToggle}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title} blade header`}
        title={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
      />
      {onClose && !collapsed && <Button appearance="subtle" className="icon-button" icon={<Dismiss20Regular />} onClick={onClose} aria-label={`Close ${title}`} title={`Close ${title}`} />}
    </div>
  </header>
}

function App({ shell, client }: { shell: Shell; client: RevampDataClient }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [account, setAccount] = useState<Account | null>(null)
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null)
  const [result, setResult] = useState<McemResponse | null>(null)
  const [centerTab, setCenterTab] = useState<CenterTab>('msx')
  const [capability, setCapability] = useState<AgentCapability>('account-pulse')
  const [agentResult, setAgentResult] = useState<AgentTaskResponse | null>(null)
  const [collapsed, setCollapsed] = useState<Set<Blade>>(new Set())
  const [actionsOpen, setActionsOpen] = useState(true)
  const [mobileBlade, setMobileBlade] = useState<Blade | 'center'>('accounts')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpportunities, setSearchOpportunities] = useState<Opportunity[]>([])
  const [searchLoading, setSearchLoading] = useState(true)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    void client.listAccounts().then(async (items) => {
      setAccounts(items)
      setLoading(false)
      const portfolio = await Promise.all(items.map((item) => client.listOpportunities(item.id)))
      setSearchOpportunities(portfolio.flat())
    }).catch(handleError).finally(() => {
      setLoading(false)
      setSearchLoading(false)
    })
  }, [client])

  function handleError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : 'The request could not be completed.')
  }

  function toggleBlade(blade: Blade) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(blade)) next.delete(blade)
      else next.add(blade)
      return next
    })
  }

  async function selectAccount(nextAccount: Account) {
    setError('')
    setAccount(nextAccount)
    setOpportunity(null)
    setResult(null)
    setAgentResult(null)
    setLoading(true)
    setMobileBlade('opportunities')
    try {
      setOpportunities(await client.listOpportunities(nextAccount.id))
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
    }
  }

  async function selectOpportunity(nextOpportunity: Opportunity, nextAccount = account) {
    if (!nextAccount) return
    setError('')
    if (account?.id !== nextAccount.id) {
      setAccount(nextAccount)
      setOpportunities(searchOpportunities.filter((item) => item.accountId === nextAccount.id))
    }
    setOpportunity(nextOpportunity)
    setResult(null)
    setAgentResult(null)
    setActionsOpen(true)
    setCenterTab('msx')
    setLoading(true)
    setMobileBlade('milestones')
    try {
      setResult(await client.runMcemCoach(nextAccount.id, nextOpportunity.id))
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
    }
  }

  async function loadGuidance(nextCapability = capability) {
    if (!account || !opportunity) return
    setCapability(nextCapability)
    setCenterTab('guidance')
    setAgentResult(null)
    setLoading(true)
    setMobileBlade('center')
    try {
      setAgentResult(await client.runAgentTask(nextCapability, account.id, opportunity.id))
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
    }
  }

  async function refreshAccounts() {
    setError('')
    setLoading(true)
    setSearchLoading(true)
    try {
      const items = await client.listAccounts()
      const portfolio = await Promise.all(items.map((item) => client.listOpportunities(item.id)))
      setAccounts(items)
      setSearchOpportunities(portfolio.flat())
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
      setSearchLoading(false)
    }
  }

  async function refreshOpportunities() {
    if (!account) return
    setError('')
    setLoading(true)
    try {
      const items = await client.listOpportunities(account.id)
      setOpportunities(items)
      setSearchOpportunities((current) => [...current.filter((item) => item.accountId !== account.id), ...items])
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
    }
  }

  async function refreshOpportunityContext() {
    if (!account || !opportunity) return
    setError('')
    setLoading(true)
    try {
      setResult(await client.runMcemCoach(account.id, opportunity.id))
      if (centerTab === 'guidance') setAgentResult(await client.runAgentTask(capability, account.id, opportunity.id))
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
    }
  }

  function closeOpportunities() {
    setAccount(null)
    setOpportunities([])
    setOpportunity(null)
    setResult(null)
    setAgentResult(null)
    setActionsOpen(false)
    setMobileBlade('accounts')
  }

  function closeMilestones() {
    setOpportunity(null)
    setResult(null)
    setAgentResult(null)
    setActionsOpen(false)
    setMobileBlade('opportunities')
  }

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const searchResults: SearchResult[] = normalizedSearch
    ? [
        ...accounts
          .filter((item) => item.name.toLocaleLowerCase().includes(normalizedSearch))
          .map((item): SearchResult => ({ type: 'account', account: item })),
        ...searchOpportunities
          .filter((item) => item.name.toLocaleLowerCase().includes(normalizedSearch))
          .map((item): SearchResult | null => {
            const owningAccount = accounts.find((candidate) => candidate.id === item.accountId)
            return owningAccount ? { type: 'opportunity', account: owningAccount, opportunity: item } : null
          })
          .filter((item): item is SearchResult => item !== null)
      ].slice(0, 8)
    : []

  function chooseSearchResult(item: SearchResult) {
    setSearchQuery('')
    if (item.type === 'account') void selectAccount(item.account)
    else void selectOpportunity(item.opportunity, item.account)
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (searchResults[0]) chooseSearchResult(searchResults[0])
  }

  async function exitApplication() {
    setError('')
    setExiting(true)
    try {
      await client.exitApplication()
    } catch (cause) {
      setExiting(false)
      handleError(cause)
    }
  }

  const status = result ? stageStatus(result) : null
  const modeLabel = client.mode === 'web-live'
    ? 'WEB · CONNECTED DATA'
    : shell === 'web' ? 'STATIC WEB · SAMPLE DATA' : 'DESKTOP · CONNECTED DATA'

  return <div className="app-shell">
    <header className="command-bar">
      <div className="brand-mark" aria-hidden="true">T</div>
      <div className="brand"><strong>TLC</strong><span>Account Team Intelligence</span></div>
      <form className="global-search" role="search" onSubmit={submitSearch}>
        <Search20Regular />
        <input
          type="search"
          aria-label="Search accounts and opportunities"
          aria-controls="global-search-results"
          aria-expanded={normalizedSearch.length > 0}
          autoComplete="off"
          placeholder="Search accounts and opportunities"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        {normalizedSearch && <div className="search-results" id="global-search-results" role="listbox" aria-label="Search results">
          {searchResults.map((item) => <button
            key={item.type === 'account' ? `account-${item.account.id}` : `opportunity-${item.opportunity.id}`}
            type="button"
            role="option"
            onClick={() => chooseSearchResult(item)}
          >
            {item.type === 'account' ? <Building20Regular /> : <List20Regular />}
            <span>
              <strong>{item.type === 'account' ? item.account.name : item.opportunity.name}</strong>
              <small>{item.type === 'account' ? `Account · ${item.account.segment}` : `Opportunity · ${item.account.name}`}</small>
            </span>
          </button>)}
          {!searchLoading && searchResults.length === 0 && <p role="status">No accounts or opportunities found.</p>}
          {searchLoading && <p role="status">Searching portfolio…</p>}
        </div>}
      </form>
      <div className="command-actions">
        <span className="mode-badge">{modeLabel}</span>
        <button className="profile-button" title="Signed-in user" aria-label="Signed-in user"><Person20Regular /></button>
        <Button appearance="subtle" icon={<Power20Regular />} disabled={exiting} onClick={() => void exitApplication()} aria-label="Exit application" title="Exit application">
          <span className="exit-label">{exiting ? 'Exiting' : 'Exit'}</span>
        </Button>
      </div>
    </header>

    <main className="workspace">
      <nav className="icon-rail" aria-label="Primary navigation">
        <button className="rail-button active" title="Home" aria-label="Home"><Home20Regular /></button>
        <button className="rail-button" title="Accounts" aria-label="Accounts"><Building20Regular /></button>
        <button className="rail-button" title="Opportunities" aria-label="Opportunities"><List20Regular /></button>
        <button className="rail-button" title="Guidance" aria-label="Guidance"><Sparkle20Regular /></button>
      </nav>

      <section className={`blade account-blade ${collapsed.has('accounts') ? 'collapsed' : ''} ${mobileBlade === 'accounts' ? 'mobile-active' : ''}`} aria-label="Accounts blade">
        <BladeHeader title="Accounts" subtitle={`${accounts.length} customer accounts`} collapsed={collapsed.has('accounts')} refreshing={loading || searchLoading} onRefresh={() => void refreshAccounts()} onToggle={() => toggleBlade('accounts')} />
        {!collapsed.has('accounts') && <div className="blade-body">
          <p className="blade-intro">Choose an account to open its active opportunities.</p>
          <div className="account-list">
            {accounts.map((item) => <button key={item.id} className={`account-button ${account?.id === item.id ? 'selected' : ''}`} onClick={() => void selectAccount(item)}>
              <span className="account-avatar">{item.name.split(' ').map((word) => word[0]).join('')}</span>
              <span><strong>{item.name}</strong><small>{item.segment}</small></span>
              <ChevronRight20Regular />
            </button>)}
          </div>
        </div>}
        {collapsed.has('accounts') && <button className="collapsed-symbol" onClick={() => toggleBlade('accounts')} aria-label="Expand Accounts"><Building20Regular /></button>}
      </section>

      {account && <section className={`blade opportunity-blade ${collapsed.has('opportunities') ? 'collapsed' : ''} ${mobileBlade === 'opportunities' ? 'mobile-active' : ''}`} aria-label="Opportunities blade">
        <BladeHeader title="Opportunities" subtitle={account.name} collapsed={collapsed.has('opportunities')} refreshing={loading} onRefresh={() => void refreshOpportunities()} onToggle={() => toggleBlade('opportunities')} onClose={closeOpportunities} />
        {!collapsed.has('opportunities') && <div className="blade-body opportunity-list">
          {opportunities.map((item) => <Tooltip
            key={item.id}
            content={<div className="opportunity-tooltip-content"><b>{item.name}</b><span>Stage owner: {stageOwner(item.recordedStage)}</span><span>Recorded stage: {item.recordedStage}</span><span>Value: {formatMoney(item.value, item.currency)}</span><span>Close: {item.closeDate}</span></div>}
            positioning="after"
            relationship="description"
          >
            <button className={`opportunity-button ${opportunity?.id === item.id ? 'selected' : ''}`} onClick={() => void selectOpportunity(item)}>
              <span className="opportunity-main"><strong>{item.name}</strong><small>Stage {item.recordedStage} · {formatMoney(item.value, item.currency)}</small></span>
              <ChevronRight20Regular />
            </button>
          </Tooltip>)}
        </div>}
        {collapsed.has('opportunities') && <button className="collapsed-symbol" onClick={() => toggleBlade('opportunities')} aria-label="Expand Opportunities"><List20Regular /></button>}
      </section>}

      {opportunity && <section className={`blade milestone-blade ${collapsed.has('milestones') ? 'collapsed' : ''} ${mobileBlade === 'milestones' ? 'mobile-active' : ''}`} aria-label="Milestones blade">
        <BladeHeader title="Milestones" subtitle={opportunity.name} collapsed={collapsed.has('milestones')} refreshing={loading} onRefresh={() => void refreshOpportunityContext()} onToggle={() => toggleBlade('milestones')} onClose={closeMilestones} />
        {!collapsed.has('milestones') && <div className="blade-body milestone-list">
          <div className="record-note">Derived from grounded next actions</div>
          {result?.recommendations.map((item, index) => <button key={item.id} className="milestone-item" onClick={() => setMobileBlade('center')}>
            <span className={`milestone-status ${item.confidence}`}>{index + 1}</span>
            <span><strong>{item.action}</strong><small>{item.ownerRole} · {item.confidence} confidence</small></span>
          </button>)}
          {!result && <div className="empty-state compact">Loading milestones…</div>}
        </div>}
        {collapsed.has('milestones') && <button className="collapsed-symbol" onClick={() => toggleBlade('milestones')} aria-label="Expand Milestones"><ClipboardTaskListLtr20Regular /></button>}
      </section>}

      <section className={`center-pane ${mobileBlade === 'center' ? 'mobile-active' : ''}`} aria-label="Opportunity workbench">
        {!opportunity && <div className="landing-state">
          <span className="landing-icon">{account ? <Building20Regular /> : <Apps20Regular />}</span>
          <p className="eyebrow">{account ? 'ACCOUNT SELECTED' : 'MY ACCOUNT PORTFOLIO'}</p>
          <h1>{account?.name ?? 'Select a customer account'}</h1>
          <p>{account ? 'Choose an active opportunity to review its grounded MSX evidence and multi-agent guidance.' : 'Open an account blade, inspect its opportunities, then review grounded MSX evidence and multi-agent guidance.'}</p>
          <div className="landing-accounts">
            {account
              ? opportunities.map((item) => <button key={item.id} onClick={() => void selectOpportunity(item)}><List20Regular /><span><strong>{item.name}</strong><small>Stage {item.recordedStage} · {formatMoney(item.value, item.currency)}</small></span><ChevronRight20Regular /></button>)
              : accounts.map((item) => <button key={item.id} onClick={() => void selectAccount(item)}><Building20Regular /><span><strong>{item.name}</strong><small>{item.segment}</small></span><ChevronRight20Regular /></button>)}
          </div>
        </div>}

        {opportunity && <>
          <header className="workbench-header">
            <button className="icon-button mobile-only" onClick={() => setMobileBlade('milestones')} title="Back to milestones" aria-label="Back to milestones"><ChevronLeft20Regular /></button>
            <div><p className="eyebrow">{account?.name}</p><h1>{opportunity.name}</h1><span>Stage {opportunity.recordedStage} · {formatMoney(opportunity.value, opportunity.currency)} · closes {opportunity.closeDate}</span></div>
            <button className="icon-button" title="More opportunity actions" aria-label="More opportunity actions"><MoreHorizontal20Regular /></button>
          </header>
          <div className="center-tabs" role="tablist" aria-label="Opportunity view">
            <button role="tab" aria-selected={centerTab === 'msx'} onClick={() => setCenterTab('msx')}>MSX</button>
            <button role="tab" aria-selected={centerTab === 'guidance'} onClick={() => void loadGuidance()}>Multi-Agent Guidance</button>
          </div>
          {loading && <div className="loading-state">Loading grounded context…</div>}
          {error && <div className="error-state">{error}</div>}
          {!loading && result && centerTab === 'msx' && <div className="workbench-content">
            <section className={`stage-band ${status ?? ''}`}>
              <div><span>Recorded in MSX</span><strong>Stage {result.recordedStage}</strong></div>
              <ChevronRight20Regular />
              <div><span>Evidence supports</span><strong>Stage {result.evidenceBasedStage}</strong></div>
              <p>{status === 'advance' ? <CheckmarkCircle20Filled /> : <Warning20Filled />}{result.summary}</p>
            </section>
            <div className="section-heading"><div><p className="eyebrow">EXIT CRITERIA</p><h2>Evidence review</h2></div><span>{result.criteria.filter((item) => item.status === 'met').length}/{result.criteria.length} met</span></div>
            <div className="criteria-table">
              {result.criteria.map((item) => <article key={item.id} className="criterion-row"><span className={`criterion-dot ${item.status}`}>{item.status === 'met' ? <CheckmarkCircle20Filled /> : <Warning20Filled />}</span><div><strong>{item.label}</strong><p>{item.rationale}</p></div><span className={`status-label ${item.status}`}>{item.status}</span></article>)}
            </div>
          </div>}
          {!loading && centerTab === 'guidance' && <div className="workbench-content guidance-view">
            <div className="agent-tabs" role="tablist" aria-label="Agent role">
              {capabilities.map((item) => <button key={item.id} role="tab" aria-selected={capability === item.id} onClick={() => void loadGuidance(item.id)}>{item.label}</button>)}
            </div>
            {agentResult ? <article className="agent-response"><p className="eyebrow">{capabilities.find((item) => item.id === agentResult.capability)?.label}</p>{agentResult.content.split('\n').filter(Boolean).map((line, index) => <p key={`${line}-${index}`}>{line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '• ')}</p>)}</article> : <div className="empty-state">Choose an agent role to generate grounded guidance.</div>}
          </div>}
        </>}
      </section>

      {opportunity && actionsOpen && <aside className={`blade action-blade ${collapsed.has('actions') ? 'collapsed' : ''} ${mobileBlade === 'actions' ? 'mobile-active' : ''}`} aria-label="Next best actions blade">
        <BladeHeader title="Next best actions" subtitle="Role based" collapsed={collapsed.has('actions')} refreshing={loading} onRefresh={() => void refreshOpportunityContext()} onToggle={() => toggleBlade('actions')} onClose={() => { setActionsOpen(false); setMobileBlade('center') }} />
        {!collapsed.has('actions') && <div className="blade-body action-list">
          {result?.recommendations.map((item, index) => <article key={item.id} className="action-item">
            <div className="action-meta"><span>{index + 1}</span><b>{item.ownerRole}</b></div>
            <h3>{item.action}</h3><p>{item.rationale}</p><small>{item.confidence} confidence · {item.evidenceIds.length} citations</small>
          </article>)}
        </div>}
        {collapsed.has('actions') && <button className="collapsed-symbol" onClick={() => toggleBlade('actions')} aria-label="Expand Next best actions"><PanelRight20Regular /></button>}
      </aside>}
    </main>

    {opportunity && <nav className="mobile-nav" aria-label="Mobile workspace navigation">
      <button className={mobileBlade === 'accounts' ? 'active' : ''} onClick={() => setMobileBlade('accounts')}><Building20Regular /><span>Accounts</span></button>
      <button className={mobileBlade === 'opportunities' ? 'active' : ''} onClick={() => setMobileBlade('opportunities')}><List20Regular /><span>Opportunities</span></button>
      <button className={mobileBlade === 'milestones' ? 'active' : ''} onClick={() => setMobileBlade('milestones')}><ClipboardTaskListLtr20Regular /><span>Milestones</span></button>
      <button className={mobileBlade === 'center' ? 'active' : ''} onClick={() => setMobileBlade('center')}><Lightbulb20Regular /><span>Analysis</span></button>
      <button className={mobileBlade === 'actions' ? 'active' : ''} onClick={() => { setActionsOpen(true); setMobileBlade('actions') }}><PanelRight20Regular /><span>Actions</span></button>
    </nav>}
  </div>
}

export function RevampApp() {
  const shell = document.documentElement.dataset['shell'] === 'desktop' ? 'desktop' : 'web'
  const theme = document.documentElement.dataset['theme'] === 'dark' ? webDarkTheme : webLightTheme
  const [client] = useState(() => createDataClient(shell))
  return <FluentProvider className="fluent-provider" theme={theme}>
    <div className="fluent-root">
      <App shell={shell} client={client} />
    </div>
  </FluentProvider>
}