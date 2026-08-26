import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Dropdown,
  FluentProvider,
  MessageBar,
  Option,
  ProgressBar,
  Spinner,
  Tab,
  TabList,
  Textarea,
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
import { contractVersion, type Account, type AgentCapability, type AgentTaskResponse, type DesktopDataStatus, type McemResponse, type Opportunity } from '../../../../packages/common/index.js'
import { getDataModeLabel } from './data-mode-label.js'

const prompt = 'How do we move this opportunity to the next MCEM stage?'
const agentTasks: Record<AgentCapability, { label: string; prompt: string }> = {
  'account-pulse': { label: 'Account Pulse', prompt: 'What should the account team focus on this week?' },
  'mcem-coach': { label: 'MCEM Coach', prompt: 'How do we move this opportunity to the next MCEM stage?' },
  'pursuit-executive': { label: 'Pursuit & Executive', prompt: 'Create an executive-ready pursuit plan for this opportunity.' },
  'risk-solution-play': { label: 'Risk & Solution Play', prompt: 'Identify grounded risks and relevant solution-play actions.' }
}
const themeStorageKey = 'tlc-theme'
type ThemeMode = 'light' | 'dark'
type WorkbenchView = 'diagnostic' | 'foundry-agent'

export function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [accountId, setAccountId] = useState('')
  const [opportunityId, setOpportunityId] = useState('')
  const [result, setResult] = useState<McemResponse | null>(null)
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView>('diagnostic')
  const [capability, setCapability] = useState<AgentCapability>('account-pulse')
  const [taskPrompt, setTaskPrompt] = useState(agentTasks['account-pulse'].prompt)
  const [agentResult, setAgentResult] = useState<AgentTaskResponse | null>(null)
  const [agentStatus, setAgentStatus] = useState<'ready' | 'running' | 'error'>('ready')
  const [agentError, setAgentError] = useState('')
  const [dataStatus, setDataStatus] = useState<DesktopDataStatus | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'running' | 'error'>('loading')
  const [error, setError] = useState('')
  const analysisPaneRef = useRef<HTMLElement>(null)

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
    setAgentResult(null)
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

  async function runAgentTask() {
    if (!accountId || !opportunityId) return
    setAgentStatus('running')
    setAgentError('')
    try {
      const response = await window.tlc.runAgentTask({
        contractVersion,
        capability,
        accountId,
        opportunityId,
        prompt: taskPrompt
      })
      setAgentResult(response)
      setAgentStatus('ready')
    } catch (cause) {
      setAgentError(cause instanceof Error ? cause.message : 'The agent task could not be completed.')
      setAgentStatus('error')
    }
  }

  function selectWorkbenchView(nextView: WorkbenchView) {
    setWorkbenchView(nextView)
    analysisPaneRef.current?.scrollTo({ top: 0 })
  }

  const account = accounts.find((item) => item.id === accountId)
  const opportunity = opportunities.find((item) => item.id === opportunityId)
  const metCount = result?.criteria.filter((criterion) => criterion.status === 'met').length ?? 0
  const progress = result ? metCount / result.criteria.length : 0
  const isLive = dataStatus?.mode === 'live'
  const isStarting = dataStatus === null
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
        <Badge appearance="filled" color={isLive && authReady ? 'success' : 'warning'}>
          {getDataModeLabel(dataStatus)}
        </Badge>
        <div className="identity"><Person20Regular /><span>{dataStatus?.auth.displayName ?? (authReady ? 'Azure CLI connected' : 'Azure CLI sign-in required')}</span></div>
      </header>

      <div className={`sample-notice ${isLive && authReady ? 'live-notice' : ''}`}>
        <ShieldCheckmark20Regular />
        <span>{isStarting
          ? 'Connecting to the configured data source...'
          : isLive
          ? authReady
            ? `Live MSX is scoped to ${dataStatus.auth.displayName ?? 'the signed-in Microsoft corporate user'}. MCEM guidance is loaded from the local MCEM Overview PDF snapshot; no SharePoint request is made.`
            : dataStatus?.auth.detail ?? 'Run az login with your Microsoft CORP ID, then restart the app.'
          : 'This automated preview uses sanitized MSX fixtures and the local MCEM Overview PDF snapshot. No live MSX or SharePoint calls are made.'}</span>
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

        <section className="analysis-pane" ref={analysisPaneRef}>
          <div className="analysis-header">
            <div>
              <div className="eyebrow">{workbenchView === 'diagnostic' ? 'MCEM OPPORTUNITY DIAGNOSTIC' : 'FOUNDRY AGENT TASK'}</div>
              <h1>{opportunity?.name ?? 'Select an opportunity'}</h1>
              <p>{workbenchView === 'diagnostic' ? prompt : 'Ask a specialized account-team agent using grounded MSX and MCEM context.'}</p>
            </div>
            {workbenchView === 'diagnostic' && <Button
              className="icon-control refresh-analysis"
              icon={<ArrowSync20Regular />}
              appearance="subtle"
              aria-label="Refresh analysis"
              title="Refresh analysis"
              onClick={() => void runCoach()}
              disabled={status === 'running'}
            />}
          </div>

          {result && <TabList className="workbench-view-tabs" aria-label="Workbench view" selectedValue={workbenchView} onTabSelect={(_, data) => {
            selectWorkbenchView(data.value as WorkbenchView)
          }}>
            <Tab value="diagnostic">Diagnostic</Tab>
            <Tab value="foundry-agent">Foundry Agent</Tab>
          </TabList>}

          {status === 'error' && <MessageBar intent="error">{error}</MessageBar>}
          {(status === 'loading' || status === 'running') && <div className="loading-state"><Spinner label="Evaluating opportunity evidence" /></div>}

          {result && status !== 'loading' && workbenchView === 'diagnostic' && <div className="diagnostic-view">
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
          </div>}

          {result && status !== 'loading' && workbenchView === 'foundry-agent' &&
            <section className="agent-workbench" aria-labelledby="agent-workbench-title">
              <div className="agent-workbench-heading">
                <div><div className="eyebrow">FOUNDRY AGENT TASK</div><h2 id="agent-workbench-title">Ask the account team</h2></div>
                {agentResult && <Badge appearance="tint" color={agentResult.state === 'complete' ? 'success' : 'warning'}>{agentResult.state}</Badge>}
              </div>
              <TabList selectedValue={capability} onTabSelect={(_, data) => {
                const nextCapability = data.value as AgentCapability
                setCapability(nextCapability)
                setTaskPrompt(agentTasks[nextCapability].prompt)
                setAgentResult(null)
                setAgentError('')
              }}>
                {(Object.entries(agentTasks) as [AgentCapability, { label: string; prompt: string }][]).map(([value, task]) => (
                  <Tab key={value} value={value}>{task.label}</Tab>
                ))}
              </TabList>
              <div className="agent-task-input">
                <Textarea aria-label="Agent task" resize="vertical" value={taskPrompt} onChange={(_, data) => setTaskPrompt(data.value)} />
                <Button appearance="primary" onClick={() => void runAgentTask()} disabled={agentStatus === 'running' || taskPrompt.trim().length < 3}>
                  {agentStatus === 'running' ? 'Analyzing...' : `Run ${agentTasks[capability].label}`}
                </Button>
              </div>
              {agentStatus === 'error' && <MessageBar intent="error">{agentError}</MessageBar>}
              {agentStatus === 'running' && <Spinner label={`Running ${agentTasks[capability].label}`} />}
              {agentResult && agentStatus !== 'running' && <article className="agent-synthesis">
                <div className="agent-synthesis-meta">
                  <strong>{agentTasks[agentResult.capability].label}</strong>
                  <span>Agent {agentResult.agentVersion} · {agentResult.sourceHealth.map((source) => source.source.toUpperCase()).join(' + ')}</span>
                </div>
                <div className="agent-synthesis-content">{agentResult.content}</div>
              </article>}
            </section>
          }
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