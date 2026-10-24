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
  it('adds the registered-workflow output as a strict optional field without changing existing views', () => {
    const run = { contractVersion: '1.0', runId: '11111111-1111-4111-8111-111111111111', workflowId: 'WF-001', status: 'queued', scope: { kind: 'portfolio' }, connectorCalls: [], telemetry: { correlationId: '22222222-2222-4222-8222-222222222222', cacheHit: false } }
    expect(workflowRunViewSchema.parse({ run })).toEqual({ run })
    expect(workflowRunViewSchema.parse({ run, output })).toMatchObject({ output })
    const extensionOutput = { workflowId: 'WF-101', outputSchemaRef: 'wf-101.output.v1', data: { any: 'approved shape' } }
    expect(workflowRunViewSchema.parse({ run, extensionOutput }).extensionOutput).toEqual(extensionOutput)
    for (const invalid of [
      { ...extensionOutput, workflowId: 'renewal' }, { ...extensionOutput, outputSchemaRef: '' },
      { ...extensionOutput, data: 'not-an-object' }, { ...extensionOutput, extra: true }
    ]) expect(workflowRunViewSchema.safeParse({ run, extensionOutput: invalid }).success).toBe(false)
  })
})
