import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowResult } from '../../../apps/teams/src/client/workflow-result.js'
import { initialWorkflowOutputSchema } from '../../../packages/common/contracts/workflow-output.js'

describe('readable Teams Play output', () => {
  it.each([
    { kind: 'exception-list', exceptions: [{ id: 'item', title: 'Review risk', priority: 'P0', detail: 'Verify source evidence', evidenceIds: ['call'] }] },
    { kind: 'metric-strip', metrics: [{ label: 'Eligible opportunities', value: 3 }] },
    { kind: 'record-table', columns: ['Name'], rows: [{ Name: 'Example opportunity' }] },
    { kind: 'timeline', events: [{ at: '2026-10-18T00:00:00.000Z', label: 'Review due' }] },
    { kind: 'action-list', actions: [{ id: 'item', label: 'Review source state', priority: 'P1' }] }
  ])('renders $kind with source health and actionable evidence rather than a JSON dump', (card) => {
    const output = initialWorkflowOutputSchema.parse({
      contractVersion: '1.0', workflowId: 'WF-001', generatedAt: '2026-10-18T00:00:00.000Z', scope: { kind: 'portfolio' },
      card: { ...card, title: 'Readable Play result', evidenceIds: ['call'] },
      queueItems: [{ id: 'item', workflowId: 'WF-001', priority: 'P1', title: 'Review follow-up', accountId: 'a', opportunityId: 'o', evidenceIds: ['call'], status: 'new' }],
      lineage: [{ connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'call' }],
      sourceHealth: [{ source: 'dataverse-mcp', state: 'partial', detail: 'Source results are incomplete', checkedAt: '2026-10-18T00:00:00.000Z' }]
    })
    const html = renderToStaticMarkup(createElement(WorkflowResult, { output, onFocus: vi.fn(), onGuidance: vi.fn() }))
    for (const text of ['Readable Play result', 'Review follow-up', 'Source results are incomplete', 'call', 'Open opportunity', 'Prepare guidance']) expect(html).toContain(text)
    expect(html).not.toContain('<pre>')
  })
})
