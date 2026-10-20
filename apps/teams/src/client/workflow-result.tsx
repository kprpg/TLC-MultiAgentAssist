import type { InitialWorkflowOutput } from '../../../../packages/common/contracts/workflow-output.js'
import type { WorkflowResultCard } from '../../../../packages/common/contracts/workflows.js'

function ResultCard({ card }: { card: WorkflowResultCard }) {
  switch (card.kind) {
    case 'exception-list': return <ul className="record-list">{card.exceptions.map((item) => <li key={item.id}><strong>{item.priority}: {item.title}</strong><p>{item.detail}</p></li>)}</ul>
    case 'metric-strip': return <dl className="play-metrics">{card.metrics.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    case 'record-table': return <div className="record-table-wrap"><table className="portfolio-records"><thead><tr>{card.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>{card.rows.map((row, index) => <tr key={index}>{card.columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? 'Not recorded' : String(row[column])}</td>)}</tr>)}</tbody></table></div>
    case 'timeline': return <ol>{card.events.map((item, index) => <li key={index}><time>{new Date(item.at).toLocaleString()}</time> - {item.label}</li>)}</ol>
    case 'action-list': return <ul>{card.actions.map((item) => <li key={item.id}><strong>{item.priority}</strong> - {item.label}</li>)}</ul>
  }
}

export function WorkflowResult({ output, onFocus, onGuidance }: {
  output: InitialWorkflowOutput; onFocus(accountId: string, opportunityId: string): void; onGuidance(queueItemId: string): void
}) {
  return <section className="play-result" aria-label="Play result">
    <h2>{output.card.title}</h2>
    <p className="muted">Source checked {new Date(output.generatedAt).toLocaleString()}</p>
    <ResultCard card={output.card} />
    <h3>Next actions and queue</h3>
    {!output.queueItems.length && <p>No follow-up items were returned for this scope.</p>}
    <ul className="record-list">{output.queueItems.map((item) => <li key={item.id}>
      <strong>{item.priority}: {item.title}</strong>
      <span>{item.owner ?? 'Owner not recorded'}{item.dueDate ? ` - Due ${item.dueDate}` : ''}</span>
      {item.accountName && <span>{item.accountName}{item.opportunityName ? ` - ${item.opportunityName}` : ''}</span>}
      <small>Evidence: {item.evidenceIds.join(', ') || 'Not available'}</small>
      {item.accountId && item.opportunityId && <div className="toolbar">
        <button type="button" onClick={() => { if (item.accountId && item.opportunityId) onFocus(item.accountId, item.opportunityId) }}>Open opportunity</button>
        <button type="button" onClick={() => onGuidance(item.id)}>Prepare guidance</button>
      </div>}
    </li>)}</ul>
    <details open><summary>Evidence and source health</summary>
      {output.sourceHealth.map((source) => <div className="source-row" key={source.source}><strong>{source.source}</strong><span>{source.state}</span><span>{source.detail}</span><time>{new Date(source.checkedAt).toLocaleString()}</time></div>)}
      <p>Result evidence: {output.card.evidenceIds.join(', ') || 'Not available'}</p>
      <ul>{output.lineage.map((item, index) => <li key={index}>{item.connector} - {item.operation} - Evidence {item.toolCallId}</li>)}</ul>
    </details>
  </section>
}
