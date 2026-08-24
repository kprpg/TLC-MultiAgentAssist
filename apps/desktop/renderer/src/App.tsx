import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Dropdown,
  FluentProvider,
  MessageBar,
  Option,
  ProgressBar,
  Spinner,
  webDarkTheme,
  webLightTheme
} from '@fluentui/react-components'
import {
  ArrowSync20Regular,
  CheckmarkCircle20Filled,
  ChevronRight20Regular,
  DataUsage20Regular,
  DocumentSearch20Regular,
  Open20Regular,
  Person20Regular,
  ShieldCheckmark20Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
  Warning20Filled
} from '@fluentui/react-icons'
import { contractVersion, type Account, type AuthStatus, type DesktopDataStatus, type McemResponse, type Opportunity } from '../../../../packages/common/index.js'

const prompt = 'How do we move this opportunity to the next MCEM stage?'
const themeStorageKey = 'tlc-theme'
type ThemeMode = 'light' | 'dark'

export function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [accountId, setAccountId] = useState('')
  const [opportunityId, setOpportunityId] = useState('')
  const [result, setResult] = useState<McemResponse | null>(null)
  const [dataStatus, setDataStatus] = useState<DesktopDataStatus | null>(null)
  const [mcemAuth, setMcemAuth] = useState<AuthStatus | null>(null)
  const [mcemConnecting, setMcemConnecting] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'running' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    document.documentElement.dataset['theme'] = themeMode
    localStorage.setItem(themeStorageKey, themeMode)
  }, [themeMode])

  useEffect(() => {
    void Promise.all([window.tlc.getDataStatus(), window.tlc.listAccounts()]).then(([nextDataStatus, items]) => {
      setDataStatus(nextDataStatus)
      setAccounts(items)
      setAccountId(items[0]?.id ?? '')
      setStatus('ready')
    }).catch(async (cause: unknown) => {
      setDataStatus(await window.tlc.getDataStatus().catch(() => null))
      handleError(cause)
    })
  }, [])

  useEffect(() => {
    if (!accountId) {
      setOpportunities([])
      setOpportunityId('')
      return
    }
    let active = true
    setResult(null)
    setOpportunities([])
    setOpportunityId('')
    void window.tlc.listOpportunities(accountId).then((items) => {
      if (!active) return
      setOpportunities(items)
      setOpportunityId(items[0]?.id ?? '')
    }).catch(handleError)
    return () => {
      active = false
    }
  }, [accountId])

  useEffect(() => {
    if (opportunityId) void runCoach(opportunityId)
  }, [opportunityId])

  function handleError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : 'The request could not be completed.')
    setStatus('error')
  }

  async function runCoach(selectedOpportunityId = opportunityId) {
    if (!accountId || !selectedOpportunityId) return
    setStatus('running')
    setError('')
    try {
      const response = await window.tlc.runMcemCoach({
        contractVersion,
        accountId,
        opportunityId: selectedOpportunityId,
        prompt
      })
      setResult(response)
      setStatus('ready')
    } catch (cause) {
      handleError(cause)
    }
  }

  async function connectMcem() {
    setMcemConnecting(true)
    setError('')
    try {
      setMcemAuth(await window.tlc.connectMcem())
    } catch (cause) {
      handleError(cause)
    } finally {
      setMcemConnecting(false)
    }
  }

  const account = accounts.find((item) => item.id === accountId)
  const opportunity = opportunities.find((item) => item.id === opportunityId)
  const metCount = result?.criteria.filter((criterion) => criterion.status === 'met').length ?? 0
  const progress = result ? metCount / result.criteria.length : 0
  const isLive = dataStatus?.mode === 'live'
  const authReady = dataStatus?.auth.state === 'ready'

  return (
    <FluentProvider className="app-provider" theme={themeMode === 'dark' ? webDarkTheme : webLightTheme}>
      <div className="app-frame">
      <header className="topbar">
        <div className="brand-mark">TLC</div>
        <div className="brand-copy">
          <strong>Account Team Intelligence</strong>
          <span>MCEM Coach</span>
        </div>
        <div className="topbar-spacer" />
        <Button
          appearance="subtle"
          className="icon-control theme-toggle"
          icon={themeMode === 'dark' ? <WeatherSunny20Regular /> : <WeatherMoon20Regular />}
          aria-label={`Use ${themeMode === 'dark' ? 'light' : 'dark'} mode`}
          title={`Use ${themeMode === 'dark' ? 'light' : 'dark'} mode`}
          onClick={() => setThemeMode((current) => current === 'dark' ? 'light' : 'dark')}
        />
        <Badge appearance="filled" color={isLive && authReady ? 'success' : 'warning'}>{isLive ? 'LIVE MSX' : 'SAMPLE DATA'}</Badge>
        <div className="identity"><Person20Regular /><span>{dataStatus?.auth.displayName ?? (authReady ? 'Azure CLI connected' : 'Azure CLI sign-in required')}</span></div>
      </header>

      <div className={`sample-notice ${isLive && authReady ? 'live-notice' : ''}`}>
        <ShieldCheckmark20Regular />
        <span>{isLive
          ? authReady
            ? mcemAuth?.state === 'ready'
              ? mcemAuth.detail
              : mcemAuth?.detail
                ?? `Live MSX is scoped to ${dataStatus.auth.displayName ?? 'the signed-in Microsoft corporate user'}. MCEM guidance remains a versioned fixture until canonical content mapping is complete.`
            : dataStatus?.auth.detail ?? 'Run az login with your Microsoft CORP ID, then restart the app.'
          : 'This automated preview uses sanitized MSX fixtures. No live MSX calls are being made.'}</span>
        {isLive && authReady && mcemAuth?.state !== 'ready' && (
          <Button
            appearance="primary"
            size="small"
            icon={mcemConnecting ? <Spinner size="tiny" /> : <DocumentSearch20Regular />}
            disabled={mcemConnecting}
            onClick={() => void connectMcem()}
          >
            Connect MCEM
          </Button>
        )}
      </div>

      <main className="workspace">
        <aside className="context-rail">
          <div className="section-label">WORKING CONTEXT</div>
          <label>Account</label>
          <Dropdown className="context-dropdown" inlinePopup value={account?.name ?? ''} selectedOptions={accountId ? [accountId] : []} onOptionSelect={(_, data) => {
            if (data.optionValue) setAccountId(data.optionValue)
          }}>
            {accounts.map((item) => <Option key={item.id} value={item.id}>{item.name}</Option>)}
          </Dropdown>
          <label>Opportunity</label>
          <Dropdown className="context-dropdown" inlinePopup value={opportunity?.name ?? ''} selectedOptions={opportunityId ? [opportunityId] : []} onOptionSelect={(_, data) => {
            if (data.optionValue) setOpportunityId(data.optionValue)
          }}>
            {opportunities.map((item) => <Option key={item.id} value={item.id}>{item.name}</Option>)}
          </Dropdown>

          {opportunity && <div className="opportunity-facts">
            <div><span>Value</span><strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: opportunity.currency, maximumFractionDigits: 0 }).format(opportunity.value)}</strong></div>
            <div><span>Close date</span><strong>{new Date(`${opportunity.closeDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>
            <div><span>Recorded stage</span><strong>Stage {opportunity.recordedStage}</strong></div>
          </div>}

          <div className="source-block">
            <div className="section-label">SOURCE HEALTH</div>
            {(result?.sourceHealth ?? []).map((source) => <div className="source-row" key={source.source}>
              <DataUsage20Regular />
              <div><strong>{source.source.toUpperCase()}</strong><span>{source.detail}</span></div>
              <Badge color="warning" appearance="tint">{source.state}</Badge>
            </div>)}
          </div>
        </aside>

        <section className="analysis-pane">
          <div className="analysis-header">
            <div>
              <div className="eyebrow">MCEM OPPORTUNITY DIAGNOSTIC</div>
              <h1>{opportunity?.name ?? 'Select an opportunity'}</h1>
              <p>{prompt}</p>
            </div>
            <Button
              className="icon-control refresh-analysis"
              icon={<ArrowSync20Regular />}
              appearance="subtle"
              aria-label="Refresh analysis"
              title="Refresh analysis"
              onClick={() => void runCoach()}
              disabled={status === 'running'}
            />
          </div>

          {status === 'error' && <MessageBar intent="error">{error}</MessageBar>}
          {(status === 'loading' || status === 'running') && <div className="loading-state"><Spinner label="Evaluating opportunity evidence" /></div>}

          {result && status !== 'loading' && <>
            <div className="stage-comparison">
              <div><span>Recorded in MSX</span><strong>Stage {result.recordedStage}</strong><small>Solution Design</small></div>
              <ChevronRight20Regular />
              <div className="supported-stage"><span>Evidence supports</span><strong>Stage {result.evidenceBasedStage}</strong><small>Customer Agreement</small></div>
              <div className="stage-summary"><Warning20Filled /><span>{result.summary}</span></div>
            </div>

            <div className="criteria-heading">
              <div><h2>Exit criteria evidence</h2><span>{metCount} of {result.criteria.length} criteria met</span></div>
              <ProgressBar value={progress} thickness="large" />
            </div>

            <div className="criteria-list">
              {result.criteria.map((criterion) => <article className="criterion-row" key={criterion.id}>
                <div className={`criterion-icon ${criterion.status}`}>
                  {criterion.status === 'met' ? <CheckmarkCircle20Filled /> : <Warning20Filled />}
                </div>
                <div><strong>{criterion.label}</strong><p>{criterion.rationale}</p></div>
                <Badge appearance="tint" color={criterion.status === 'met' ? 'success' : criterion.status === 'partial' ? 'warning' : 'danger'}>{criterion.status}</Badge>
              </article>)}
            </div>

            <div className="evidence-strip">
              <DocumentSearch20Regular />
              <div><strong>{result.evidence.length} grounded sources</strong><span>Recommendations cite MSX context and versioned MCEM guidance.</span></div>
              {result.evidence.map((evidence) => <Button key={evidence.id} appearance="subtle" icon={<Open20Regular />} disabled={!evidence.url} onClick={() => {
                if (evidence.url) void window.tlc.openEvidence(evidence.url)
              }}>{evidence.source.toUpperCase()}</Button>)}
            </div>
          </>}
        </section>

        <aside className="actions-pane">
          <div className="actions-heading"><span className="section-label">NEXT BEST ACTIONS</span><Badge appearance="filled">{result?.recommendations.length ?? 0}</Badge></div>
          <p className="actions-intro">Resolve these gaps before treating the opportunity as Stage 3 ready.</p>
          <div className="action-list">
            {result?.recommendations.map((recommendation, index) => <article className="action-card" key={recommendation.id}>
              <div className="action-order">{index + 1}</div>
              <div className="action-content">
                <Badge appearance="tint">{recommendation.ownerRole}</Badge>
                <h3>{recommendation.action}</h3>
                <p>{recommendation.rationale}</p>
                <div className="confidence">{recommendation.confidence} confidence · {recommendation.evidenceIds.length} citations</div>
              </div>
            </article>)}
          </div>
          <div className="read-only-note"><ShieldCheckmark20Regular /><span>Read-only preview. TLC will not update MSX or contact customers.</span></div>
        </aside>
      </main>
      </div>
    </FluentProvider>
  )
}

function getInitialTheme(): ThemeMode {
  const savedTheme = localStorage.getItem(themeStorageKey)
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}