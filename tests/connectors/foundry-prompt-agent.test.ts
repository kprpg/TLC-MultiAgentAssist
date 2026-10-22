import { beforeEach, describe, expect, it, vi } from 'vitest'

const { responsesCreate, getOpenAIClient, AIProjectClient } = vi.hoisted(() => {
  const responsesCreate = vi.fn()
  const getOpenAIClient = vi.fn(() => ({ responses: { create: responsesCreate } }))
  const AIProjectClient = vi.fn(function () {
    return { getOpenAIClient }
  })
  return { responsesCreate, getOpenAIClient, AIProjectClient }
})

vi.mock('@azure/ai-projects', () => ({ AIProjectClient }))

import { createFoundryOpenAIClient, FoundryPromptAgent } from '../../packages/connectors/foundry/index.js'

describe('FoundryPromptAgent', () => {
  beforeEach(() => {
    responsesCreate.mockReset()
    getOpenAIClient.mockClear()
    AIProjectClient.mockClear()
  })

  it('binds the prompt agent through the Responses agent field', async () => {
    responsesCreate.mockResolvedValue({ output_text: '  grounded synthesis  ' })
    const credential = { getToken: vi.fn() }
    const agent = new FoundryPromptAgent<{ opportunityId: string }>({
      projectEndpoint: 'https://example.services.ai.azure.com/api/projects/tlc',
      agentName: 'tlc-mcem-coach',
      requestTimeoutMs: 60_000,
      credential
    })

    await expect(agent.invoke({ opportunityId: 'opp-1' })).resolves.toBe('grounded synthesis')
    expect(responsesCreate).toHaveBeenCalledWith(
      { input: '{"opportunityId":"opp-1"}' },
      expect.objectContaining({
        body: {
          agent_reference: {
            name: 'tlc-mcem-coach',
            type: 'agent_reference'
          }
        },
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('allows all workflow agents to reuse one authenticated OpenAI client', () => {
    const credential = { getToken: vi.fn() }
    const openAIClient = createFoundryOpenAIClient('https://example.services.ai.azure.com/api/projects/tlc', credential)

    for (const agentName of ['account-pulse', 'mcem-coach', 'pursuit-executive', 'risk-solution-play']) {
      new FoundryPromptAgent({
        projectEndpoint: 'https://example.services.ai.azure.com/api/projects/tlc',
        agentName,
        requestTimeoutMs: 60_000,
        credential,
        openAIClient
      })
    }

    expect(AIProjectClient).toHaveBeenCalledTimes(1)
    expect(getOpenAIClient).toHaveBeenCalledTimes(1)
  })

  describe('streaming', () => {
    const credential = { getToken: vi.fn() }
    const options = {
      projectEndpoint: 'https://example.services.ai.azure.com/api/projects/tlc',
      agentName: 'tlc-mcem-coach',
      requestTimeoutMs: 60_000,
      credential
    }
    async function* events(...items: unknown[]) { for (const item of items) yield item }

    it('streams text deltas, reports counters without content, and limits output when configured', async () => {
      responsesCreate.mockResolvedValue(events(
        { type: 'response.created' },
        { type: 'response.output_text.delta', delta: 'Hello ' },
        { type: 'response.output_text.delta', delta: 'world' },
        { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 4, output_tokens_details: { reasoning_tokens: 2 } } } }
      ))
      const reported: unknown[] = []
      const agent = new FoundryPromptAgent<{ id: string }>({ ...options, maxOutputTokens: 2048, performanceReporter: (event) => reported.push(event) })
      const deltas: string[] = []

      await expect(agent.stream({ id: '1' }, { onDelta: (text) => deltas.push(text) })).resolves.toBe('Hello world')
      expect(deltas).toEqual(['Hello ', 'world'])
      expect(responsesCreate).toHaveBeenCalledWith(
        { input: '{"id":"1"}', stream: true, max_output_tokens: 2048 },
        expect.objectContaining({ body: { agent_reference: { name: 'tlc-mcem-coach', type: 'agent_reference' } } })
      )
      expect(reported).toEqual([expect.objectContaining({
        operation: 'agent.foundry.stream', outcome: 'success',
        metrics: expect.objectContaining({ attempt: 1, outputChars: 11, inputTokens: 10, outputTokens: 4, reasoningTokens: 2 })
      })])
      expect(JSON.stringify(reported)).not.toContain('Hello')
    })

    it('aborts and retries once when no text arrives before the first-token timeout', async () => {
      vi.useFakeTimers()
      try {
        responsesCreate
          .mockImplementationOnce((_body: unknown, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')))
          }))
          .mockResolvedValueOnce(events({ type: 'response.output_text.delta', delta: 'ok' }))
        const agent = new FoundryPromptAgent({ ...options, firstTokenTimeoutMs: 5_000 })
        const result = agent.stream({}, { onDelta: () => undefined })
        await vi.advanceTimersByTimeAsync(5_000)
        await expect(result).resolves.toBe('ok')
        expect(responsesCreate).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not retry a caller cancellation', async () => {
      const controller = new AbortController()
      responsesCreate.mockImplementation((_body: unknown, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      }))
      const agent = new FoundryPromptAgent({ ...options })
      const result = agent.stream({}, { onDelta: () => undefined, signal: controller.signal })
      controller.abort()
      await expect(result).rejects.toThrow('aborted')
      expect(responsesCreate).toHaveBeenCalledTimes(1)
    })

    it('falls back to the blocking call when the service rejects streaming', async () => {
      responsesCreate
        .mockRejectedValueOnce(Object.assign(new Error('bad request'), { status: 400 }))
        .mockResolvedValueOnce({ output_text: ' full answer ' })
      const agent = new FoundryPromptAgent({ ...options })
      const deltas: string[] = []
      await expect(agent.stream({}, { onDelta: (text) => deltas.push(text) })).resolves.toBe('full answer')
      expect(deltas).toEqual(['full answer'])
    })
  })
})
