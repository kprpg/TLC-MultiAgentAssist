import { useEffect, useState } from 'react'
import { z } from 'zod'
import { workflowDefinitionSchema, workflowRunSchema, workflowContractVersion, type WorkflowDefinition, type WorkflowRun, type ScopeRef } from '../../../../packages/common/contracts/workflows.js'
import type { TeamsApiClient } from './data-client.js'

export function WorkflowsWorkspace({ client, scope = { kind: 'portfolio' } }: { client: TeamsApiClient; scope?: ScopeRef }) {
  const scopeKey = JSON.stringify(scope)
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([])
  const [workflowId, setWorkflowId] = useState('')
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [output, setOutput] = useState<unknown>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setOutput(null); setRun(null); setWorkflowId('')
    client.operation('workflows.list', { contractVersion: workflowContractVersion, scope: scope.kind }, z.array(workflowDefinitionSchema), controller.signal)
      .then(setDefinitions).catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client, scopeKey])
  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status)) return
    const controller = new AbortController()
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await client.operation('workflows.get', { contractVersion: workflowContractVersion, runId: run.runId },
          z.object({ run: workflowRunSchema, output: z.unknown().optional() }), controller.signal)
        if (controller.signal.aborted) return
        setRun(result.run)
        if (result.output) setOutput(result.output)
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
    try {
      setError(''); setOutput(null)
      setRun(await client.operation('workflows.start', {
        contractVersion: workflowContractVersion, workflowId, scope,
        input: { asOf: new Date().toISOString().slice(0, 10) }
      }, workflowRunSchema))
    } catch (cause) { setError(String(cause)) }
  }
  async function cancel() {
    if (!run) return
    try { setRun(await client.operation('workflows.cancel', { contractVersion: workflowContractVersion, runId: run.runId }, workflowRunSchema)) }
    catch (cause) { setError(String(cause)) }
  }
  return <section className="panel"><h1>Shared workflows</h1>
    <p>Run the same grounded workflow definitions used by Desktop, Web and VS Code.</p>
    <label className="field">Workflow<select aria-label="Workflow" value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>
      <option value="">Choose a workflow</option>{definitions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </select></label>
    <div className="toolbar"><button type="button" className="primary" disabled={!workflowId || !!run && ['queued', 'running'].includes(run.status)} onClick={() => { void start() }}>Run workflow</button>
      {run && ['queued', 'running'].includes(run.status) && <button type="button" onClick={() => { void cancel() }}>Cancel run</button>}
    </div>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {run && <p data-testid="workflow-status" role="status">{run.status}{run.state ? ` - ${run.state}` : ''}</p>}
    {output !== null && <details open><summary>Workflow result, evidence and source health</summary><pre>{JSON.stringify(output, null, 2)}</pre></details>}
  </section>
}
