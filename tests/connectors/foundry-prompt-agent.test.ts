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
})
