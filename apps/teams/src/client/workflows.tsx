import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workflowDefinitionSchema, workflowRunSchema, workflowContractVersion, workflowGuidanceHandoffSchema, type WorkflowDefinition, type WorkflowRun, type ScopeRef, type WorkflowGuidanceHandoff } from '../../../../packages/common/contracts/workflows.js'
import { workflowRunViewSchema, type InitialWorkflowOutput } from '../../../../packages/common/contracts/workflow-output.js'
import { agentTaskResponseSchema, contractVersion, type AgentTaskResponse } from '../../../../packages/common/contracts/index.js'
import { workflowGuidanceCapability } from '../../../shared/workflow-guidance.js'
import { WorkflowResult } from './workflow-result.js'
import { AgentResultView } from './result-view.js'
import type { WorkingSelection } from './accounts.js'
import type { TeamsApiClient } from './data-client.js'

export function WorkflowsWorkspace({ client, scope: fixedScope, selection, onFocus, initialRunId }: {
  client: TeamsApiClient; scope?: ScopeRef; selection?: WorkingSelection | null
  onFocus(accountId: string, opportunityId: string): void
  initialRunId?: string
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
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setOutput(null); setRun(null); setWorkflowId(''); setError(''); setHandoff(undefined); setGuidance(undefined); setBusy(false)
    client.operation('workflows.list', { contractVersion: workflowContractVersion, scope: scope.kind }, z.array(workflowDefinitionSchema), controller.signal)
      .then((items) => { if (!controller.signal.aborted) setDefinitions(items) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => { controller.abort(); request.current?.abort() }
  }, [client, scopeKey])
  useEffect(() => {
    if (!initialRunId) return
    const parsed = z.string().uuid().safeParse(initialRunId)
    if (!parsed.success) { setError('The linked Play run reference is invalid.'); return }
    void openRun(parsed.data)
  }, [initialRunId, client])
  useEffect(() => {
    const controller = new AbortController()
    client.operation('workflows.history', { contractVersion: workflowContractVersion, scope, limit: 25 }, z.array(workflowRunSchema), controller.signal)
      .then((items) => { if (!controller.signal.aborted) setHistory(items) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client, scopeKey, run?.status])
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
    if (busy) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setOutput(null); setHandoff(undefined); setGuidance(undefined)
    try {
      const result = await client.operation('workflows.start', {
        contractVersion: workflowContractVersion, workflowId, scope,
        input: { asOf: new Date().toISOString().slice(0, 10) }
      }, workflowRunSchema, controller.signal)
      if (!controller.signal.aborted) setRun(result)
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
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
  const filtered = definitions.filter((entry) => `${entry.name} ${entry.category} ${entry.personaTargets.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <section className="plays-workspace" aria-label="Plays workspace">
    <div className="workspace-heading"><h1>Plays</h1><p>Shared workflows, grounded results and private follow-up.</p></div>
    <div className="plays-grid"><aside className="pane"><h2>Play catalog</h2>
      {!fixedScope && <label className="field">Play scope<select aria-label="Play scope" value={scopeKind} onChange={(event) => setScopeKind(event.target.value)}>
        <option value="portfolio">Portfolio</option>{selection && <><option value="account">Selected account</option><option value="opportunity">Selected opportunity</option></>}
      </select></label>}
      <label className="field">Search Plays<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="field">Workflow<select aria-label="Workflow" value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>
        <option value="">Choose a workflow</option>{definitions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      {[...new Set(filtered.map((entry) => entry.category))].map((category) => <section key={category} className="play-group"><h3>{category.replaceAll('-', ' ')}</h3>
        {filtered.filter((entry) => entry.category === category).map((entry) => <button type="button" key={entry.id} aria-pressed={workflowId === entry.id}
          className={workflowId === entry.id ? 'selected-play' : ''} onClick={() => setWorkflowId(entry.id)}><strong>{entry.name}</strong><small>{entry.personaTargets.join(', ')} - {entry.executionMode}</small></button>)}
      </section>)}
      {!filtered.length && <p>No Plays are available for this scope and filter.</p>}
    </aside><div className="pane">
      <div className="toolbar"><button type="button" className="primary" disabled={!workflowId || busy || !!run && ['queued', 'running'].includes(run.status)} onClick={() => { void start() }}>Run workflow</button>
        {run && ['queued', 'running'].includes(run.status) && <button type="button" onClick={() => { void cancel() }}>Cancel run</button>}
      </div>
      {error && <p role="alert" className="error-banner">{error}</p>}
      {run && <p data-testid="workflow-status" role="status">{run.status}{run.state ? ` - ${run.state}` : ''}</p>}
      {output && <WorkflowResult output={output} onFocus={onFocus} onGuidance={(id) => { void prepareGuidance(id) }} />}
      {handoff && <section className="panel"><h2>Review guidance handoff</h2><p>{handoff.context.cardTitle}</p><p>{handoff.prompt}</p>
        <button type="button" disabled={busy} onClick={() => { void runGuidance() }}>Run scoped guidance</button>
        {guidance && <AgentResultView result={guidance} />}
      </section>}
      <section aria-label="Play history" className="play-history"><h2>Recent runs</h2>
        {!history.length && <p>No runs in this source scope yet.</p>}
        {history.map((item) => <button type="button" key={item.runId} onClick={() => { void openRun(item.runId) }}>
          {definitions.find((entry) => entry.id === item.workflowId)?.name ?? item.workflowId} - {item.status}{item.state ? ` (${item.state})` : ''}
        </button>)}
      </section>
    </div></div>
  </section>
}
