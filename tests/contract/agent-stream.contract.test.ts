import { describe, expect, it, vi } from 'vitest'
import { createApplicationOperations } from '../../packages/orchestrator/operations.js'
import { agentTaskPromptMaxLength, agentTaskRequestSchema, agentTaskStreamEventSchema, agentTaskStreamVersion, contractVersion, scopeAwareAgentTaskRequestSchema, workflowContractVersion, type AgentTaskStreamEvent } from '../../packages/common/contracts/index.js'
import { prewarmAgentDependencies } from '../../packages/orchestrator/prewarm.js'
import { bridgeParamSchemas } from '../../apps/vscode-extension/src/message-contracts.js'
import { buildAgentFollowUpPrompt } from '../../apps/shared/agent-follow-up.js'

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

  it('accepts bounded follow-up context identically across request boundaries without changing the wire shape', () => {
    const prompt = buildAgentFollowUpPrompt('## Summary\n\n' + 'Evidence [O.C1]. '.repeat(400), 'Convert this into an email.')
    expect(prompt.length).toBeGreaterThan(4_000)
    const input = { ...request, prompt }
    expect(agentTaskRequestSchema.parse(input)).toEqual(input)
    const bridgeInput = { capability: input.capability, accountId: input.accountId, opportunityId: input.opportunityId, prompt }
    expect(bridgeParamSchemas.runAgentTask.parse(bridgeInput)).toEqual(bridgeInput)
    expect(scopeAwareAgentTaskRequestSchema.parse({
      contractVersion: workflowContractVersion, capability: request.capability,
      scope: { kind: 'opportunity', accountId: request.accountId, opportunityId: request.opportunityId }, prompt
    }).prompt).toBe(prompt)
    expect(agentTaskRequestSchema.parse({ ...request, prompt: 'x'.repeat(agentTaskPromptMaxLength) }).prompt).toHaveLength(agentTaskPromptMaxLength)
    for (const schema of [agentTaskRequestSchema, bridgeParamSchemas.runAgentTask]) {
      expect(schema.safeParse({ ...(schema === agentTaskRequestSchema ? request : bridgeInput), prompt: 'x'.repeat(agentTaskPromptMaxLength + 1) }).success).toBe(false)
    }
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
