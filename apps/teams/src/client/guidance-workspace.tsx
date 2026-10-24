import { useEffect, useRef, useState } from 'react'
import * as c from '../../../../packages/common/contracts/index.js'
import { suggestedPrompts } from '../../../shared/prompt-catalog.js'
import { formatResponseMarkdown } from '../../../shared/response-markdown.js'
import { progressToResponse, type AgentStreamProgress } from '../../../shared/agent-stream.js'
import { AgentResultView } from './result-view.js'
import { ResponseActions } from './response-actions.js'
import type { TeamsApiClient } from './data-client.js'
import type { WorkingSelection } from './accounts.js'
import type { AgentInvoke } from '../../../shared/use-agent-run.js'
import type { CustomerEmailAction } from '../../../shared/customer-email.js'

export function GuidanceWorkspace({ client, selection }: { client: TeamsApiClient; selection: WorkingSelection }) {
  const [capability, setCapability] = useState<c.AgentCapability>('account-pulse')
  const [prompt, setPrompt] = useState(suggestedPrompts['account-pulse'][0] ?? '')
  const [result, setResult] = useState<c.AgentTaskResponse | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<AgentStreamProgress['phase'] | null>(null)
  const request = useRef<AbortController | null>(null)
  const invoke: AgentInvoke = (capability, accountId, opportunityId, prompt, onProgress, signal) =>
    client.runAgentTaskStream({ contractVersion: c.contractVersion, capability, accountId, opportunityId, prompt }, onProgress, signal)
  const emailAction: CustomerEmailAction = {
    kind: 'recipients',
    compose: async (draft, recipients) => {
      const input = c.emailComposeRequestSchema.parse({
        contractVersion: c.contractVersion, recipients, subject: draft.subject, responseTitle: draft.subject, responseMarkdown: draft.markdown
      })
      await client.download('documents/email', { opportunityId: selection.opportunity.id, draft: input }, 'TLC-customer-email-draft.eml')
      return 'downloaded'
    }
  }
  useEffect(() => () => request.current?.abort(), [])
  async function run() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setResult(null); setPhase(null)
    try {
      const response = await client.runAgentTaskStream({
        contractVersion: c.contractVersion, capability, accountId: selection.account.id, opportunityId: selection.opportunity.id, prompt
      }, (progress) => {
        if (controller.signal.aborted) return
        setPhase(progress.phase); setResult(progressToResponse(progress, capability))
      }, controller.signal)
      if (!controller.signal.aborted) setResult(response)
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    finally { if (!controller.signal.aborted) { setBusy(false); setPhase(null) } }
  }
  return <div>
    <label className="field">Guidance capability<select value={capability} onChange={(event) => {
      request.current?.abort(); setBusy(false)
      const next = c.agentCapabilitySchema.parse(event.target.value)
      setCapability(next); setPrompt(suggestedPrompts[next][0] ?? ''); setResult(null)
    }}>{Object.keys(suggestedPrompts).map((item) => <option key={item} value={item}>{item.replaceAll('-', ' ')}</option>)}</select></label>
    <div className="starter-prompts">{suggestedPrompts[capability].slice(0, 4).map((item) => <button type="button" key={item} onClick={() => setPrompt(item)}>{item}</button>)}</div>
    <label className="field">Ask TLC<textarea aria-label="Ask TLC" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={1000} /></label>
    <button type="button" className="primary" disabled={busy || prompt.trim().length < 3} onClick={() => { void run() }}>{busy ? 'Grounding response...' : 'Run guidance'}</button>
    {busy && <button type="button" onClick={() => request.current?.abort()}>Cancel</button>}
    {busy && <p role="status">{phase === 'streaming' ? 'Receiving the AI response. The evidence-based draft is replaced as it arrives.'
      : phase === 'draft' ? 'Showing the evidence-based draft from current MSX evidence while the AI response is prepared. No source records will be changed.'
      : 'Checking current MSX evidence, milestones and MCEM guidance before preparing the response. No source records will be changed.'}</p>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    {result && <AgentResultView result={result} busy={busy} emailAction={emailAction}
      followUp={{ capability: result.capability, accountId: selection.account.id, opportunityId: selection.opportunity.id, invoke }}
      actions={busy ? null : <ResponseActions client={client} opportunityId={selection.opportunity.id}
      title={`TLC guidance - ${selection.opportunity.name}`} markdown={formatResponseMarkdown(result.content)} generatedAt={result.generatedAt} />} />}
  </div>
}
