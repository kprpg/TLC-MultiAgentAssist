import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workflowDefinitionSchema, workflowRunSchema, workflowContractVersion, workflowGuidanceHandoffSchema, type WorkflowDefinition, type WorkflowRun, type ScopeRef, type WorkflowGuidanceHandoff } from '../../../../packages/common/contracts/workflows.js'
import { workflowRunViewSchema, type InitialWorkflowOutput } from '../../../../packages/common/contracts/workflow-output.js'
import { agentTaskResponseSchema, contractVersion, type AgentTaskResponse } from '../../../../packages/common/contracts/index.js'
import { workflowGuidanceCapability } from '../../../shared/workflow-guidance.js'
import { WorkflowResult } from './workflow-result.js'
import { AgentResultView } from './result-view.js'
import type { WorkingSelection } from './accounts.js'
import { TeamsRequestError, type TeamsApiClient } from './data-client.js'
import { nativeConnectionStatusSchema } from '../../../../packages/common/contracts/local-connection.js'

export function WorkflowsWorkspace({ client, scope: fixedScope, selection, onFocus, initialRunId, authentication }: {
  client: TeamsApiClient; scope?: ScopeRef; selection?: WorkingSelection | null
  onFocus(accountId: string, opportunityId: string): void
  initialRunId?: string
  authentication?: 'local-azure-cli' | 'local-interactive'
}) {
  const [scopeKind, setScopeKind] = useState('portfolio')
  const scope: ScopeRef = fixedScope ?? (selection && scopeKind === 'opportunity'
    ? { kind: 'opportunity', accountId: selection.account.id, opportunityId: selection.opportunity.id }
    : selection && scopeKind === 'account' ? { kind: 'account', accountId: selection.account.id } : { kind: 'portfolio' })
  const scopeKey = JSON.stringify(scope)
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([])
  const [workflowId, setWorkflowId] = useState('')
  const [query, setQuery] = useState('')
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [output, setOutput] = useState<InitialWorkflowOutput | null>(null)
  const [history, setHistory] = useState<WorkflowRun[]>([])
  const [handoff, setHandoff] = useState<WorkflowGuidanceHandoff>()
  const [guidance, setGuidance] = useState<AgentTaskResponse>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [historyRevision, setHistoryRevision] = useState(0)
  const [mcpReady, setMcpReady] = useState(!authentication)
  const [mcpChecking, setMcpChecking] = useState(!!authentication)
  const [mcpRevision, setMcpRevision] = useState(0)
  const [mcpError, setMcpError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setOutput(null); setRun(null); setWorkflowId(''); setDefinitions([]); setError(''); setHandoff(undefined); setGuidance(undefined); setBusy(false); setStarting(false)
    setCatalogLoading(true); setCatalogError('')
    client.operation('workflows.list', { contractVersion: workflowContractVersion, scope: scope.kind }, z.array(workflowDefinitionSchema), controller.signal)
      .then((items) => { if (!controller.signal.aborted) { setDefinitions(items); setWorkflowId(items[0]?.id ?? '') } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setCatalogError(String(cause)) })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false) })
    return () => { controller.abort(); request.current?.abort() }
  }, [client, scopeKey, catalogRevision])
  useEffect(() => {
    if (!authentication) { setMcpReady(true); setMcpChecking(false); return }
    const controller = new AbortController()
    setMcpReady(false); setMcpChecking(true); setMcpError('')
    client.request('local/status', nativeConnectionStatusSchema, undefined, controller.signal)
      .then((status) => { if (!controller.signal.aborted) setMcpReady(status.resources.some((resource) => resource.resource === 'mcp' && resource.state === 'connected')) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setMcpError(String(cause)) })
      .finally(() => { if (!controller.signal.aborted) setMcpChecking(false) })
    return () => controller.abort()
  }, [client, authentication, mcpRevision])
  useEffect(() => {
    if (!initialRunId) return
    const parsed = z.string().uuid().safeParse(initialRunId)
    if (!parsed.success) { setError('The linked Play run reference is invalid.'); return }
    void openRun(parsed.data)
  }, [initialRunId, client])
  useEffect(() => {
    const controller = new AbortController()
    setHistory([]); setHistoryLoading(true); setHistoryError('')
    client.operation('workflows.history', { contractVersion: workflowContractVersion, scope, limit: 25 }, z.array(workflowRunSchema), controller.signal)
      .then((items) => { if (!controller.signal.aborted) setHistory(items) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setHistoryError(String(cause)) })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false) })
    return () => controller.abort()
  }, [client, scopeKey, run?.status, historyRevision])
  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status)) return
    const controller = new AbortController()
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await client.operation('workflows.get', { contractVersion: workflowContractVersion, runId: run.runId }, workflowRunViewSchema, controller.signal)
        if (controller.signal.aborted) return
        setRun(result.run); setOutput(result.output ?? null)
        if (['queued', 'running'].includes(result.run.status)) {
          if (++attempts >= 60) setError('Workflow polling paused. Open Activity or cancel the run; it has not been reported complete.')
          else timer = setTimeout(() => { void poll() }, 1000)
        }
        } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [client, run?.runId, run?.status])
  async function start() {
    if (busy || !workflowId || !mcpReady) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setStarting(true); setError(''); setRun(null); setOutput(null); setHandoff(undefined); setGuidance(undefined)
    try {
      const result = await client.operation('workflows.start', {
        contractVersion: workflowContractVersion, workflowId, scope,
        input: { asOf: new Date().toISOString().slice(0, 10) }
      }, workflowRunSchema, controller.signal)
      if (!controller.signal.aborted) setRun(result)
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof TeamsRequestError && cause.code === 'mcp_connection_required') setMcpReady(false)
        setError(String(cause))
      }
    }
    finally { if (!controller.signal.aborted) { setBusy(false); setStarting(false) } }
  }
  async function openRun(runId: string) {
    request.current?.abort()
    setBusy(false)
    const controller = new AbortController()
    request.current = controller
    try {
      setError(''); setHandoff(undefined); setGuidance(undefined)
      const result = await client.operation('workflows.get', { contractVersion: workflowContractVersion, runId }, workflowRunViewSchema, controller.signal)
      if (!controller.signal.aborted) { setRun(result.run); setOutput(result.output ?? null) }
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
  }
  async function prepareGuidance(queueItemId: string) {
    if (!run) return
    request.current?.abort()
    setBusy(false)
    const controller = new AbortController()
    request.current = controller
    try {
      setError(''); setGuidance(undefined); setHandoff(undefined)
      const prepared = await client.operation('workflows.guidance', {
        contractVersion: workflowContractVersion, runId: run.runId, queueItemId, capability: workflowGuidanceCapability(run.workflowId)
      }, workflowGuidanceHandoffSchema, controller.signal)
      if (!controller.signal.aborted) setHandoff(prepared)
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
  }
  async function runGuidance() {
    if (!handoff || busy) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      const result = await client.operation('runAgentTask', {
        contractVersion, capability: handoff.capability, accountId: handoff.scope.accountId,
        opportunityId: handoff.scope.opportunityId, prompt: handoff.prompt
      }, agentTaskResponseSchema, controller.signal)
      if (!controller.signal.aborted) setGuidance(result)
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  async function cancel() {
    if (!run) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const result = await client.operation('workflows.cancel', { contractVersion: workflowContractVersion, runId: run.runId }, workflowRunSchema, controller.signal)
      if (!controller.signal.aborted) setRun(result)
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
  }
  const filtered = definitions.filter((entry) => `${entry.id} ${entry.name} ${entry.category} ${entry.personaTargets.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <section className="plays-workspace" aria-label="Plays workspace">
    <div className="workspace-heading"><h1>Plays</h1><p>Shared workflows, grounded results and private follow-up.</p></div>
    <div className="plays-grid"><aside className="pane"><h2>Play catalog</h2>
      {!fixedScope && <label className="field">Play scope<select aria-label="Play scope" value={scopeKind} onChange={(event) => setScopeKind(event.target.value)}>
        <option value="portfolio">Portfolio</option>{selection && <><option value="account">Selected account</option><option value="opportunity">Selected opportunity</option></>}
      </select></label>}
      <label className="field">Search Plays<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="field">Workflow<select aria-label="Workflow" value={workflowId} disabled={catalogLoading || busy} onChange={(event) => setWorkflowId(event.target.value)}>
        <option value="">Choose a workflow</option>{definitions.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} - {entry.name}</option>)}
      </select></label>
      {catalogLoading && <p role="status">Loading Play catalog...</p>}
      {catalogError && <div role="alert" className="error-banner">{catalogError}<button type="button" onClick={() => setCatalogRevision((value) => value + 1)}>Retry Play catalog</button></div>}
      {[...new Set(filtered.map((entry) => entry.category))].map((category) => <section key={category} className="play-group"><h3>{category.replaceAll('-', ' ')}</h3>
        {filtered.filter((entry) => entry.category === category).map((entry) => <button type="button" key={entry.id} aria-pressed={workflowId === entry.id} disabled={busy}
          className={workflowId === entry.id ? 'selected-play' : ''} onClick={() => setWorkflowId(entry.id)}><strong>{entry.name}</strong><small>{entry.personaTargets.join(', ')} - {entry.executionMode}</small></button>)}
      </section>)}
      {!catalogLoading && !catalogError && !filtered.length && <p>No Plays are available for this scope and filter.</p>}
    </aside><div className="pane">
      {authentication && !mcpReady && <section aria-label="MCP connection" className="warning">
        {mcpChecking ? <p role="status">Checking the optional MCP connection...</p> : <>
          <h2>Connect MCP to run live Plays</h2>
          <p>MSX Portfolio access does not automatically enable MCP. No workflow has started. Explicitly connect the current owner, then check the connection again.</p>
          <code>{String.raw`.\scripts\teams-local-connection.ps1 -Action Connect -Resource mcp -WorkDirectory "$env:LOCALAPPDATA\TLC-Assist\Teams\${authentication === 'local-azure-cli' ? 'launcher-cli' : 'launcher-native'}"`}</code>
          <p>Standalone runtime: <code>node server.js --local-owner connect &lt;protected-owner-directory&gt; mcp</code>.</p>
          <p>Use your launcher's actual work directory if customized. No registration, tenant consent or source write is performed by this page; source admission and tool policy still apply.</p>
          {mcpError && <p role="alert">{mcpError}</p>}
          <button type="button" onClick={() => setMcpRevision((value) => value + 1)}>Check MCP connection</button>
        </>}
      </section>}
      <div className="toolbar"><button type="button" className="primary" disabled={!workflowId || catalogLoading || !mcpReady || busy || !!run && ['queued', 'running'].includes(run.status)} onClick={() => { void start() }}>{starting ? 'Starting workflow...' : 'Run workflow'}</button>
        {authentication && mcpReady && <button type="button" disabled={busy} onClick={() => setMcpRevision((value) => value + 1)}>Check MCP connection</button>}
        {run && ['queued', 'running'].includes(run.status) && <button type="button" onClick={() => { void cancel() }}>Cancel run</button>}
      </div>
      {error && <p role="alert" className="error-banner">{error}</p>}
      {starting && <p role="status">Starting workflow: verifying your current source scope. No completed result is available yet.</p>}
      {run && <p data-testid="workflow-status" role="status">{run.status}{run.state ? ` - ${run.state}` : ''}</p>}
      {run?.status === 'failed' && <p role="alert" className="error-banner">The workflow failed. Check Activity and source permissions before retrying. Reference: {run.telemetry.correlationId}.</p>}
      {output && <WorkflowResult output={output} onFocus={onFocus} onGuidance={(id) => { void prepareGuidance(id) }} />}
      {handoff && <section className="panel"><h2>Review guidance handoff</h2><p>{handoff.context.cardTitle}</p><p>{handoff.prompt}</p>
        <button type="button" disabled={busy} onClick={() => { void runGuidance() }}>Run scoped guidance</button>
        {guidance && <AgentResultView result={guidance} />}
      </section>}
      <section aria-label="Play history" className="play-history"><h2>Recent runs</h2>
        {historyLoading && <p role="status">Loading recent runs...</p>}
        {historyError && <div role="alert" className="error-banner">{historyError}<button type="button" onClick={() => setHistoryRevision((value) => value + 1)}>Retry recent runs</button></div>}
        {!historyLoading && !historyError && !history.length && <p>No runs in this source scope yet.</p>}
        {history.map((item) => <button type="button" key={item.runId} onClick={() => { void openRun(item.runId) }}>
          {definitions.find((entry) => entry.id === item.workflowId)?.name ?? item.workflowId} - {item.status}{item.state ? ` (${item.state})` : ''}
        </button>)}
      </section>
    </div></div>
  </section>
}
