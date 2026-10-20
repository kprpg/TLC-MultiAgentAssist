import { useEffect, useRef, useState } from 'react'
import * as c from '../../../../packages/common/contracts/index.js'
import { suggestedPrompts } from '../../../shared/prompt-catalog.js'
import { formatResponseMarkdown } from '../../../shared/response-markdown.js'
import { AgentResultView } from './result-view.js'
import type { TeamsApiClient } from './data-client.js'
import type { WorkingSelection } from './accounts.js'

export function GuidanceWorkspace({ client, selection }: { client: TeamsApiClient; selection: WorkingSelection }) {
  const [capability, setCapability] = useState<c.AgentCapability>('account-pulse')
  const [prompt, setPrompt] = useState(suggestedPrompts['account-pulse'][0] ?? '')
  const [result, setResult] = useState<c.AgentTaskResponse | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recipients, setRecipients] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  async function run() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setResult(null)
    try {
      const response = await client.operation('runAgentTask', {
        contractVersion: c.contractVersion, capability, accountId: selection.account.id, opportunityId: selection.opportunity.id, prompt
      }, c.agentTaskResponseSchema, controller.signal)
      if (!controller.signal.aborted) setResult(response)
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  async function exportResult(email: boolean) {
    if (!result) return
    setError('')
    try {
      const common = {
        contractVersion: c.contractVersion, responseTitle: `TLC guidance - ${selection.opportunity.name}`,
        responseMarkdown: formatResponseMarkdown(result.content)
      }
      if (email) {
        const draft = c.emailComposeRequestSchema.parse({
          ...common, recipients: recipients.split(/[;,]/).map((item) => item.trim()).filter(Boolean), subject: common.responseTitle
        })
        await client.download('documents/email', { opportunityId: selection.opportunity.id, draft }, 'TLC-reviewed-draft.eml')
      } else {
        const document = c.exportResponseRequestSchema.parse({ ...common, generatedAt: result.generatedAt })
        await client.download('documents/export', { opportunityId: selection.opportunity.id, document }, 'TLC-response.docx')
      }
    } catch (cause) { setError(String(cause)) }
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
    {error && <p role="alert" className="error-banner">{error}</p>}
    {result && <><AgentResultView result={result} /><div className="toolbar">
      <button type="button" onClick={() => { void exportResult(false) }}>Export Word</button>
      <label className="field">Email draft recipients<input type="text" value={recipients} placeholder="reviewer@example.com" onChange={(event) => setRecipients(event.target.value)} /></label>
      <button type="button" disabled={!recipients.trim()} onClick={() => { void exportResult(true) }}>Download unsent email draft</button>
    </div></>}
  </div>
}
