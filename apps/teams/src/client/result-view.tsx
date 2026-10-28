import type { ReactNode } from 'react'
import type { AgentTaskResponse } from '../../../../packages/common/contracts/index.js'
import { AgentResponse, type AgentFollowUpContext } from '../../../shared/agent-response.js'
import type { CustomerEmailAction } from '../../../shared/customer-email.js'

export function AgentResultView({ result, actions, busy = false, followUp, emailAction }: {
  result: AgentTaskResponse; actions?: ReactNode; busy?: boolean
  followUp?: AgentFollowUpContext; emailAction?: CustomerEmailAction
}) {
  return <section className="result-panel" aria-label="Grounded TLC response">
    <header className="section-heading result-heading"><div className="result-title"><h2>TLC guidance</h2><span className={`status-pill ${result.state}`}>{result.state}</span></div>{actions}</header>
    <AgentResponse key={result.correlationId} inference={result.inference} content={result.content} busy={busy || result.agentVersion === 'streaming'}
      followUp={followUp} emailAction={emailAction} urlTransform={(url) => {
      try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? url : '' } catch { return '' }
    }} onOpenEvidence={(url) => {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Only HTTPS evidence links can be opened.')
      window.open(url, '_blank', 'noopener,noreferrer')
    }} />
    <details className="source-details" open><summary>Evidence and source health</summary>
      {result.sourceHealth.map((source) => <div key={source.source} className="source-row">
        <strong>{source.source}</strong><span>{source.state}</span><span>{source.detail}</span><time dateTime={source.checkedAt}>{new Date(source.checkedAt).toLocaleString()}</time>
      </div>)}
    </details>
    <p className="muted">Generated {new Date(result.generatedAt).toLocaleString()}. Suggestions are not executed automatically.</p>
  </section>
}
