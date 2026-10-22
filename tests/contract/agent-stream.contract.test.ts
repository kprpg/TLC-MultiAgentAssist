import { describe, expect, it, vi } from 'vitest'
import { createApplicationOperations } from '../../packages/orchestrator/operations.js'
import { agentTaskStreamEventSchema, agentTaskStreamVersion, contractVersion, type AgentTaskStreamEvent } from '../../packages/common/contracts/index.js'
import { prewarmAgentDependencies } from '../../packages/orchestrator/prewarm.js'

const request = { contractVersion, capability: 'mcem-coach', accountId: 'a', opportunityId: 'o', prompt: 'Hello there' }
const sourceHealth = [{ source: 'msx', state: 'live', detail: 'Live.', checkedAt: '2026-01-01T00:00:00.000Z' }]

function operationsWith(runAgentTaskStream: (input: unknown, onEvent: (event: unknown) => void, signal?: AbortSignal) => Promise<void>) {
  const refreshSource = vi.fn()
  const operations = createApplicationOperations({ orchestrator: { runAgentTaskStream }, refreshSource } as never)
  return { operations, refreshSource }
}

describe('agent stream contract', () => {
  it('is strict and versioned', () => {
    expect(agentTaskStreamVersion).toBe('1.0')
    expect(() => agentTaskStreamEventSchema.parse({ type: 'delta', text: 'x', extra: true })).toThrow()
    expect(() => agentTaskStreamEventSchema.parse({ type: 'delta', text: '' })).toThrow()
    expect(() => agentTaskStreamEventSchema.parse({ type: 'error', code: 'other', message: 'x' })).toThrow()
    expect(() => agentTaskStreamEventSchema.parse({ type: 'context', streamVersion: '1.0', capability: 'mcem-coach', instantDraft: 'x', sourceHealth })).not.toThrow()
  })
})

describe('streamAgentTask operation (shared by Teams and other hosts)', () => {
  it('validates the request and every emitted event', async () => {
    const { operations, refreshSource } = operationsWith(async (_input, onEvent) => { onEvent({ type: 'delta', text: 'ok' }) })
    const seen: AgentTaskStreamEvent[] = []
    await operations.streamAgentTask(request, (event) => seen.push(event))
    expect(seen).toEqual([{ type: 'delta', text: 'ok' }])
    expect(refreshSource).toHaveBeenCalled()
  })

  it('rejects malformed requests and malformed events', async () => {
    const run = vi.fn(async (_input: unknown, onEvent: (event: unknown) => void) => { onEvent({ type: 'delta' }) })
    const { operations } = operationsWith(run)
    await expect(operations.streamAgentTask({ ...request, prompt: 'x' }, () => undefined)).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
    await expect(operations.streamAgentTask(request, () => undefined)).rejects.toThrow()
  })
})

describe('prewarmAgentDependencies', () => {
  it('acquires the Foundry token and loads guidance, ignoring failures', async () => {
    const getToken = vi.fn().mockRejectedValue(new Error('login required'))
    const getStageGuidance = vi.fn().mockResolvedValue({})
    await expect(prewarmAgentDependencies({ credential: { getToken }, scopes: ['https://ai.azure.com/.default'], guidance: { getStageGuidance } as never })).resolves.toBeUndefined()
    expect(getToken).toHaveBeenCalledWith(['https://ai.azure.com/.default'])
    expect(getStageGuidance).toHaveBeenCalledWith(1)
  })

  it('does nothing without dependencies', async () => {
    await expect(prewarmAgentDependencies({})).resolves.toBeUndefined()
  })
})
