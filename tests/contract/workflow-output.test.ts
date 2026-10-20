import { describe, expect, it } from 'vitest'
import { initialWorkflowOutputSchema, workflowRunViewSchema } from '../../packages/common/contracts/workflow-output.js'
import { initialWorkflowOutputSchema as coreOutput } from '../../packages/orchestrator/workflows/cohort.js'
import { workflowRunViewSchema as coreView } from '../../packages/orchestrator/workflows/view-contracts.js'

describe('browser-safe workflow output authority', () => {
  const output = {
    contractVersion: '1.0', workflowId: 'WF-001', generatedAt: '2026-10-18T00:00:00.000Z', scope: { kind: 'portfolio' },
    card: { kind: 'action-list', title: 'Review actions', evidenceIds: ['call'], actions: [] }, queueItems: [],
    lineage: [{ connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'call' }],
    sourceHealth: [{ source: 'dataverse-mcp', state: 'sample', detail: 'Sanitized source', checkedAt: '2026-10-18T00:00:00.000Z' }]
  }
  it('reuses the exact existing schemas and unchanged version over the UI boundary', () => {
    expect(coreOutput).toBe(initialWorkflowOutputSchema)
    expect(coreView).toBe(workflowRunViewSchema)
    expect(initialWorkflowOutputSchema.parse(output)).toEqual(output)
  })
  it('rejects incompatible versions, unknown fields and invalid result cards', () => {
    for (const invalid of [
      { ...output, contractVersion: '2.0' },
      { ...output, unexpected: true },
      { ...output, card: { kind: 'made-up', title: 'Bad' } }
    ]) expect(initialWorkflowOutputSchema.safeParse(invalid).success).toBe(false)
  })
})
