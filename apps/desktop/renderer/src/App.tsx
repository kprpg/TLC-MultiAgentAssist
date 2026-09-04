import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  FluentProvider,
  Input,
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
  ArrowDownload20Regular,
  CheckmarkCircle20Filled,
  ChevronRight20Regular,
  DataUsage20Regular,
  Dismiss20Regular,
  DocumentSearch20Regular,
  Mail20Regular,
  Open20Regular,
  PanelLeft20Regular,
  PanelRight20Regular,
  Person20Regular,
  ShieldCheckmark20Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
  Warning20Filled
} from '@fluentui/react-icons'
import { contractVersion, type Account, type AgentCapability, type AgentTaskResponse, type DesktopDataStatus, type McemResponse, type Opportunity } from '../../../../packages/common/index.js'
import { getDataModeLabel } from './data-mode-label.js'

const prompt = 'How do we move this opportunity to the next MCEM stage?'
const agentTasks: Record<AgentCapability, { label: string; prompts: readonly string[] }> = {
  'account-pulse': {
    label: 'Account Pulse',
    prompts: [
      'What should the account team focus on this week?',
      'Which opportunity signals need immediate attention?',
      'Summarize recent account activity and customer commitments.',
      'Rank the next best actions for this opportunity.'
    ]
  },
  'mcem-coach': {
    label: 'MCEM Coach',
    prompts: [
      'How do we move this opportunity to the next MCEM stage?',
      'Which exit criteria are missing or only partially supported?',
      'Compare the recorded stage with the evidence-based stage.',
      'Create an owner-based plan to close the MCEM gaps.'
    ]
  },
  'pursuit-executive': {
    label: 'Pursuit & Executive',
    prompts: [
      'Create an executive-ready brief for this opportunity.',
      'Build a 30/60 day pursuit plan with owners and milestones.',
      'Prepare talking points and a customer ask for the next meeting.',
      'Identify stakeholder gaps and recommend an engagement strategy.'
    ]
  },
  'risk-solution-play': {
    label: 'Risk & Solution Play',
    prompts: [
      'Identify the highest grounded risks and mitigation actions.',
      'Recommend a solution play based on the available evidence.',
      'Prepare likely objections, proof points, and a demo path.',
      'Which blockers could delay this opportunity and who should own them?'
    ]
  }
}
const themeStorageKey = 'tlc-theme'
const leftPaneStorageKey = 'tlc-left-pane-collapsed'
const rightPaneStorageKey = 'tlc-right-pane-collapsed'
const sourceNoticeDismissedStorageKey = 'tlc-source-notice-dismissed'
type ThemeMode = 'light' | 'dark'
type WorkbenchView = 'diagnostic' | 'foundry-agent'

export function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme)
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(() => getInitialPaneState(leftPaneStorageKey))
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(() => getInitialPaneState(rightPaneStorageKey))
  const [sourceNoticeDismissed, setSourceNoticeDismissed] = useState(() => localStorage.getItem(sourceNoticeDismissedStorageKey) === 'true')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [accountId, setAccountId] = useState('')
  const [opportunityId, setOpportunityId] = useState('')
  const [result, setResult] = useState<McemResponse | null>(null)
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView>('diagnostic')
  const [capability, setCapability] = useState<AgentCapability>('account-pulse')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [agentResult, setAgentResult] = useState<AgentTaskResponse | null>(null)
  const [agentStatus, setAgentStatus] = useState<'ready' | 'running' | 'error'>('ready')
  const [agentError, setAgentError] = useState('')
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [emailRecipients, setEmailRecipients] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [shareStatus, setShareStatus] = useState<'ready' | 'running' | 'success' | 'error'>('ready')
  const [shareMessage, setShareMessage] = useState('')
  const [dataStatus, setDataStatus] = useState<DesktopDataStatus | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'running' | 'error'>('loading')
  const [error, setError] = useState('')
  const analysisPaneRef = useRef<HTMLElement>(null)
  const coachRequestIdRef = useRef(0)

  useEffect(() => {
    document.documentElement.dataset['theme'] = themeMode
    localStorage.setItem(themeStorageKey, themeMode)
  }, [themeMode])

  useEffect(() => {
    localStorage.setItem(leftPaneStorageKey, String(leftPaneCollapsed))
  }, [leftPaneCollapsed])

  useEffect(() => {
    localStorage.setItem(rightPaneStorageKey, String(rightPaneCollapsed))
  }, [rightPaneCollapsed])

  useEffect(() => {
    localStorage.setItem(sourceNoticeDismissedStorageKey, String(sourceNoticeDismissed))
  }, [sourceNoticeDismissed])

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
    setResult(null)
    setAgentResult(null)
    if (opportunityId) void runCoach(opportunityId)
  }, [opportunityId])

  function handleError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : 'The request could not be completed.')
    setStatus('error')
  }

  async function runCoach(selectedOpportunityId = opportunityId) {
    if (!accountId || !selectedOpportunityId) return
    const requestId = ++coachRequestIdRef.current
    setStatus('running')
    setError('')
    try {
      const response = await window.tlc.runMcemCoach({
        contractVersion,
        accountId,
        opportunityId: selectedOpportunityId,
        prompt
      })
      if (requestId !== coachRequestIdRef.current) return
      setResult(response)
      setStatus('ready')
    } catch (cause) {
      if (requestId !== coachRequestIdRef.current) return
      handleError(cause)
    }
  }

  async function runAgentTask(selectedPrompt = taskPrompt) {
    if (!accountId || !opportunityId) return
    const submittedPrompt = selectedPrompt.trim()
    if (submittedPrompt.length < 3) return
    setTaskPrompt(selectedPrompt)
    setAgentStatus('running')
    setAgentError('')
    setShareStatus('ready')
    setShareMessage('')
    try {
      const response = await window.tlc.runAgentTask({
        contractVersion,
        capability,
        accountId,
        opportunityId,
        prompt: submittedPrompt
      })
      setAgentResult(response)
      setAgentStatus('ready')
    } catch (cause) {
      setAgentError(cause instanceof Error ? cause.message : 'The agent task could not be completed.')
      setAgentStatus('error')
    }
  }

  function openEmailDialog() {
    if (!agentResult) return
    setEmailSubject(`${agentTasks[agentResult.capability].label}: ${opportunity?.name ?? 'Agent response'}`)
    setShareStatus('ready')
    setShareMessage('')
    setEmailDialogOpen(true)
  }

  async function openEmailCompose() {
    if (!agentResult) return
    const recipients = emailRecipients.split(/[;,]/).map((recipient) => recipient.trim()).filter(Boolean)
    setShareStatus('running')
    setShareMessage('')
    try {
      await window.tlc.openEmailCompose({
        contractVersion,
        recipients,
        subject: emailSubject,
        responseTitle: agentTasks[agentResult.capability].label,
        responseMarkdown: agentResult.content
      })
      setEmailDialogOpen(false)
      setShareStatus('success')
      setShareMessage('Outlook message opened for review. Send it from Outlook when ready.')
    } catch (cause) {
      setShareStatus('error')
      setShareMessage(cause instanceof Error ? cause.message : 'The Outlook message could not be opened.')
    }
  }

  async function exportAgentResponse() {
    if (!agentResult) return
    setShareStatus('running')
    setShareMessage('')
    try {
      const response = await window.tlc.exportAgentResponse({
        contractVersion,
        responseTitle: `${agentTasks[agentResult.capability].label} - ${opportunity?.name ?? 'Agent response'}`,
        responseMarkdown: agentResult.content,
        generatedAt: agentResult.generatedAt
      })
      setShareStatus(response.state === 'saved' ? 'success' : 'ready')
      setShareMessage(response.state === 'saved' ? 'Word document saved.' : '')
    } catch (cause) {
      setShareStatus('error')
      setShareMessage(cause instanceof Error ? cause.message : 'The Word document could not be exported.')
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
      <div className={`app-frame${sourceNoticeDismissed ? ' source-notice-dismissed' : ''}`}>
      <header className="topbar">
        <Button
          appearance="subtle"
          className="icon-control pane-toggle edge-pane-toggle"
          icon={<PanelLeft20Regular />}
          aria-label="Toggle working context"
          aria-controls="working-context-pane"
          aria-expanded={!leftPaneCollapsed}
          title="Toggle working context"
          onClick={() => setLeftPaneCollapsed((current) => !current)}
        />
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
        <Button
          appearance="subtle"
          className="icon-control pane-toggle edge-pane-toggle"
          icon={<PanelRight20Regular />}
          aria-label="Toggle next best actions"
          aria-controls="next-best-actions-pane"
          aria-expanded={!rightPaneCollapsed}
          title="Toggle next best actions"
          onClick={() => setRightPaneCollapsed((current) => !current)}
        />
      </header>

      {!sourceNoticeDismissed && <div className={`sample-notice ${isLive && authReady ? 'live-notice' : ''}`}>
        <ShieldCheckmark20Regular />
        <span>{isStarting
          ? 'Connecting to the configured data source...'
          : isLive
          ? authReady
            ? `Live MSX is scoped to ${dataStatus.auth.displayName ?? 'the signed-in Microsoft corporate user'}. MCEM guidance is loaded from the local MCEM Overview PDF snapshot; no SharePoint request is made.`
            : dataStatus?.auth.detail ?? 'Run az login with your Microsoft CORP ID, then restart the app.'
          : 'This automated preview uses sanitized MSX fixtures and the local MCEM Overview PDF snapshot. No live MSX or SharePoint calls are made.'}</span>
        <Button
          appearance="subtle"
          className="icon-control source-notice-dismiss"
          icon={<Dismiss20Regular />}
          aria-label="Dismiss data source notice"
          title="Dismiss data source notice"
          onClick={() => setSourceNoticeDismissed(true)}
        />
      </div>}

      <main className={`workspace${leftPaneCollapsed ? ' left-pane-collapsed' : ''}${rightPaneCollapsed ? ' right-pane-collapsed' : ''}`}>
        {!leftPaneCollapsed && <aside className="context-rail" id="working-context-pane">
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
        </aside>}

        <section className="analysis-pane" ref={analysisPaneRef}>
          <div className="analysis-header">
            <div>
              <div className="eyebrow">{workbenchView === 'diagnostic' ? 'MCEM OPPORTUNITY DIAGNOSTIC' : `${agentTasks[capability].label.toUpperCase()} AGENT`}</div>
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
                <h2 id="agent-workbench-title">Ask the account team</h2>
                {agentResult && <Badge appearance="tint" color={agentResult.state === 'complete' ? 'success' : 'warning'}>{agentResult.state}</Badge>}
              </div>
              <TabList selectedValue={capability} onTabSelect={(_, data) => {
                const nextCapability = data.value as AgentCapability
                setCapability(nextCapability)
                setTaskPrompt('')
                setAgentResult(null)
                setAgentError('')
              }}>
                {(Object.entries(agentTasks) as [AgentCapability, { label: string; prompts: readonly string[] }][]).map(([value, task]) => (
                  <Tab key={value} value={value}>{task.label}</Tab>
                ))}
              </TabList>
              <div className="agent-prompt-suggestions" aria-label={`${agentTasks[capability].label} suggested prompts`}>
                {agentTasks[capability].prompts.map((suggestedPrompt) => (
                  <button
                    className="agent-prompt-card"
                    key={suggestedPrompt}
                    type="button"
                    onClick={() => void runAgentTask(suggestedPrompt)}
                    disabled={agentStatus === 'running'}
                  >
                    {suggestedPrompt}
                  </button>
                ))}
              </div>
              <div className="agent-task-input">
                <Textarea aria-label="Agent task" placeholder="Ask a different question..." resize="vertical" value={taskPrompt} onChange={(_, data) => setTaskPrompt(data.value)} />
                <Button appearance="primary" onClick={() => void runAgentTask()} disabled={agentStatus === 'running' || taskPrompt.trim().length < 3}>
                  {agentStatus === 'running' ? 'Analyzing...' : `Run ${agentTasks[capability].label}`}
                </Button>
              </div>
              {agentStatus === 'error' && <MessageBar intent="error">{agentError}</MessageBar>}
              {agentStatus === 'running' && <Spinner label={`Running ${agentTasks[capability].label}`} />}
              {agentResult && agentStatus !== 'running' && <article className="agent-synthesis">
                <div className="agent-synthesis-meta">
                  <div className="agent-synthesis-identity">
                    <strong>{agentTasks[agentResult.capability].label}</strong>
                    <span>Agent {agentResult.agentVersion} · {agentResult.sourceHealth.map((source) => source.source.toUpperCase()).join(' + ')}</span>
                  </div>
                  <div className="response-actions" aria-label="Response actions">
                    <Button icon={<Mail20Regular />} onClick={openEmailDialog} disabled={shareStatus === 'running'}>Send E-mail</Button>
                    <Button icon={<ArrowDownload20Regular />} onClick={() => void exportAgentResponse()} disabled={shareStatus === 'running'}>Export</Button>
                  </div>
                </div>
                {shareMessage && <MessageBar intent={shareStatus === 'error' ? 'error' : 'success'}>{shareMessage}</MessageBar>}
                <div className="agent-synthesis-content">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    skipHtml
                    components={{
                      a: ({ href, children }) => <a href={href} onClick={(event) => {
                        event.preventDefault()
                        if (href) void window.tlc.openEvidence(href)
                      }}>{children}</a>
                    }}
                  >
                    {agentResult.content}
                  </Markdown>
                </div>
              </article>}
              <Dialog open={emailDialogOpen} onOpenChange={(_, data) => setEmailDialogOpen(data.open)}>
                <DialogSurface>
                  <DialogBody>
                    <DialogTitle>Open Outlook message</DialogTitle>
                    <DialogContent className="email-draft-form">
                      <p>The message will open in Outlook using your signed-in account. Review it and press Send in Outlook.</p>
                      <Field label="Recipients" hint="Separate multiple addresses with commas or semicolons.">
                        <Input type="email" aria-label="Email recipients" value={emailRecipients} onChange={(_, data) => setEmailRecipients(data.value)} />
                      </Field>
                      <Field label="Subject">
                        <Input aria-label="Email subject" value={emailSubject} onChange={(_, data) => setEmailSubject(data.value)} />
                      </Field>
                      {shareStatus === 'error' && shareMessage && <MessageBar intent="error">{shareMessage}</MessageBar>}
                    </DialogContent>
                    <DialogActions>
                      <Button appearance="secondary" onClick={() => setEmailDialogOpen(false)}>Cancel</Button>
                      <Button appearance="primary" icon={<Mail20Regular />} onClick={() => void openEmailCompose()} disabled={shareStatus === 'running' || !emailRecipients.trim() || !emailSubject.trim()}>
                        {shareStatus === 'running' ? 'Opening...' : 'Open in Outlook'}
                      </Button>
                    </DialogActions>
                  </DialogBody>
                </DialogSurface>
              </Dialog>
            </section>
          }
        </section>

        {!rightPaneCollapsed && <aside className="actions-pane" id="next-best-actions-pane">
          <div className="actions-heading"><span className="section-label">NEXT BEST ACTIONS</span><Badge appearance="filled">{result?.recommendations.length ?? 0}</Badge></div>
          <p className="actions-intro">Resolve these gaps before treating the selected opportunity as Stage {result?.recordedStage ?? '—'} ready.</p>
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
        </aside>}
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

function getInitialPaneState(storageKey: string): boolean {
  return localStorage.getItem(storageKey) === 'true'
}