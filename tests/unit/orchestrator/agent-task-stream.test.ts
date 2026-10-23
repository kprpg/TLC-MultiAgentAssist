import { describe, expect, it, vi } from 'vitest'
import { agentTaskStreamEventSchema, contractVersion, type AgentTaskStreamEvent, type PerformanceEvent } from '../../../packages/common/index.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { FixtureMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator, type AgentStreamHandlers } from '../../../packages/orchestrator/index.js'

const request = {
  contractVersion,
  capability: 'mcem-coach' as const,
  accountId: 'account-contoso',
  opportunityId: 'opp-grid-modernization',
  prompt: 'How do we move this opportunity to the next MCEM stage?'
}

async function collect(core: ThinSliceOrchestrator, signal?: AbortSignal): Promise<AgentTaskStreamEvent[]> {
  const events: AgentTaskStreamEvent[] = []
  await core.runAgentTaskStream(request, (event) => events.push(event), signal)
  return events
}

function orchestrator(agent: { invoke: () => Promise<string>; stream?: (context: unknown, handlers: AgentStreamHandlers) => Promise<string> }, reporter?: (event: PerformanceEvent) => void) {
  return new ThinSliceOrchestrator(new FixtureMsxConnector(), new FixtureMcemGuidanceConnector(), {
    'mcem-coach': { version: 'test', agent: agent as never }
  }, reporter)
}

describe('runAgentTaskStream', () => {
  it('emits the instant draft before any model text, then deltas, then the authoritative response', async () => {
    const core = orchestrator({
      invoke: async () => 'unused',
      stream: async (_context, handlers) => { handlers.onDelta('Grounded '); handlers.onDelta('answer'); return 'Grounded answer' }
    })
    const events = await collect(core)

    expect(events.map((event) => event.type)).toEqual(['context', 'delta', 'delta', 'complete'])
    for (const event of events) expect(() => agentTaskStreamEventSchema.parse(event)).not.toThrow()
    const [context, , , complete] = events
    expect(context).toMatchObject({ type: 'context', capability: 'mcem-coach', instantDraft: expect.stringContaining('## Summary') })
    expect(complete).toMatchObject({ type: 'complete', response: { capability: 'mcem-coach', agentVersion: 'test', content: expect.stringContaining('Grounded answer') } })
  })

  it('uses a blocking agent as a single final response after the instant draft', async () => {
    const events = await collect(orchestrator({ invoke: async () => 'Blocking answer.' }))
    expect(events.map((event) => event.type)).toEqual(['context', 'complete'])
  })

  it('falls back to the labelled deterministic draft when the model fails', async () => {
    const events = await collect(orchestrator({
      invoke: async () => 'unused',
      stream: async () => { throw new Error('Foundry timeout') }
    }))
    const complete = events.at(-1)
    expect(complete).toMatchObject({ type: 'complete', response: { state: 'partial', agentVersion: 'test+local-fallback' } })
    expect(JSON.stringify(complete)).toContain('AI enhancement is unavailable')
  })

  it('reports a terminal cancelled error and never invokes the model after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const stream = vi.fn()
    const events = await collect(orchestrator({ invoke: async () => 'unused', stream }), controller.signal)
    expect(events).toEqual([{ type: 'error', code: 'cancelled', message: 'The request was cancelled.' }])
    expect(stream).not.toHaveBeenCalled()
  })

  it('reports context failures as a terminal error without invoking the model', async () => {
    const invoke = vi.fn()
    const core = orchestrator({ invoke })
    const events: AgentTaskStreamEvent[] = []
    await core.runAgentTaskStream({ ...request, accountId: 'other-account' }, (event) => events.push(event))
    expect(events).toEqual([{ type: 'error', code: 'failed', message: expect.stringContaining('does not belong') }])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('keeps timing events content-free', async () => {
    const reported: PerformanceEvent[] = []
    await collect(orchestrator({ invoke: async () => 'Answer' }, (event) => reported.push(event)))
    expect(reported.map((event) => event.operation)).toEqual(expect.arrayContaining(['agent.invoke.mcem-coach', 'agent.task.mcem-coach']))
    for (const event of reported) expect(Object.keys(event).sort()).toEqual(['durationMs', 'operation', 'outcome'])
  })

  it('delivers the instant draft long before a slow model finishes', async () => {
    vi.useFakeTimers()
    try {
      const core = orchestrator({
        invoke: async () => 'unused',
        stream: (_context, handlers) => new Promise<string>((resolve) => { setTimeout(() => { handlers.onDelta('Late'); resolve('Late') }, 90_000) })
      })
      const types: string[] = []
      const run = core.runAgentTaskStream(request, (event) => types.push(event.type))
      await vi.advanceTimersByTimeAsync(1_000)
      expect(types).toEqual(['context'])
      await vi.advanceTimersByTimeAsync(90_000)
      await run
      expect(types).toEqual(['context', 'delta', 'complete'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let a failing consumer break the run', async () => {
    const core = orchestrator({ invoke: async () => 'Answer' })
    await expect(core.runAgentTaskStream(request, () => { throw new Error('consumer closed') })).resolves.toBeUndefined()
  })
})
