import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentTaskResponse } from '../../../../packages/common/contracts/index.js'
import { formatResponseMarkdown } from '../../../shared/response-markdown.js'

export function AgentResultView({ result }: { result: AgentTaskResponse }) {
  return <section className="result-panel" aria-label="Grounded TLC response">
    <div className="section-heading"><h2>TLC guidance</h2><span className={`status-pill ${result.state}`}>{result.state}</span></div>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => {
      try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? url : '' } catch { return '' }
    }} components={{ a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span> }}>
      {formatResponseMarkdown(result.content)}
    </Markdown>
    <details className="source-details" open><summary>Evidence and source health</summary>
      {result.sourceHealth.map((source) => <div key={source.source} className="source-row">
        <strong>{source.source}</strong><span>{source.state}</span><span>{source.detail}</span><time dateTime={source.checkedAt}>{new Date(source.checkedAt).toLocaleString()}</time>
      </div>)}
    </details>
    <p className="muted">Generated {new Date(result.generatedAt).toLocaleString()}. Suggestions are not executed automatically.</p>
  </section>
}
