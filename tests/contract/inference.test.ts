import { describe, expect, it } from 'vitest'
import { agentTaskResponseSchema, contractVersion } from '../../packages/common/contracts/index.js'
import { inferenceExecutionSchema, inferenceResponseVersion } from '../../packages/common/contracts/inference.js'
const execution = {
  contractVersion: '1.0', correlationId: '00000000-0000-4000-8000-000000000001',
  requested: 'foundry', provider: 'foundry', state: 'complete'
}
describe('sample inference provenance contracts', () => {
  it('accepts unchanged live/legacy responses and independently versions the hybrid result', () => {
    const response = {
      contractVersion, correlationId: execution.correlationId, capability: 'account-pulse', agentVersion: 'active',
      generatedAt: '2026-01-01T00:00:00.000Z', mode: 'live', state: 'complete', content: 'Grounded result',
      sourceHealth: [{ source: 'msx', state: 'live', detail: 'Available', checkedAt: '2026-01-01T00:00:00.000Z' }]
    }
    expect(agentTaskResponseSchema.parse(response)).toEqual(response)
    expect(agentTaskResponseSchema.safeParse({ ...response, inference: execution }).success).toBe(false)
    expect(agentTaskResponseSchema.safeParse({ ...response, contractVersion: inferenceResponseVersion }).success).toBe(false)
    expect(agentTaskResponseSchema.parse({ ...response, contractVersion: inferenceResponseVersion, mode: 'sample', inference: execution })).toMatchObject({ mode: 'sample', inference: execution })
  })
  it('does not permit unlabeled or success-shaped fallback provenance', () => {
    expect(inferenceExecutionSchema.safeParse({ ...execution, state: 'fallback' }).success).toBe(false)
    expect(inferenceExecutionSchema.safeParse({ ...execution, state: 'fallback', provider: 'sample' }).success).toBe(false)
    expect(inferenceExecutionSchema.parse({ ...execution, state: 'fallback', provider: 'sample', reason: 'quota' })).toMatchObject({ reason: 'quota' })
    expect(inferenceExecutionSchema.safeParse({ ...execution, customerPrompt: 'not allowed' }).success).toBe(false)
  })
})
