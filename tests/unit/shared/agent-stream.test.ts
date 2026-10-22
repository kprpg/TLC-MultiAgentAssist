import { describe, expect, it, vi } from 'vitest'
import { AgentStreamError, createAgentStreamAccumulator, progressToResponse, readNdjson, type AgentStreamProgress } from '../../../apps/shared/agent-stream.js'
import { contractVersion, type AgentTaskResponse, type AgentTaskStreamEvent } from '../../../packages/common/contracts/index.js'

const health = [{ source: 'msx' as const, state: 'live' as const, detail: 'Live.', checkedAt: '2026-01-01T00:00:00.000Z' }]
const response: AgentTaskResponse = {
  contractVersion, correlationId: '11111111-1111-4111-8111-111111111111', capability: 'account-pulse', agentVersion: 'v1',
  generatedAt: '2026-01-01T00:00:00.000Z', mode: 'live', state: 'complete', content: 'Final', sourceHealth: health
}
const events: AgentTaskStreamEvent[] = [
  { type: 'context', streamVersion: '1.0', capability: 'account-pulse', instantDraft: 'Draft', sourceHealth: health },
  { type: 'delta', text: 'Hel' }, { type: 'delta', text: 'lo' },
  { type: 'complete', response }
]

describe('agent stream accumulator', () => {
  it('reports draft then accumulated text and returns the authoritative response', () => {
    const progress: AgentStreamProgress[] = []
    const accumulator = createAgentStreamAccumulator((item) => progress.push(item))
    for (const event of events) accumulator.push(event)
    expect(progress.map((item) => [item.phase, item.content])).toEqual([['draft', 'Draft'], ['streaming', 'Hel'], ['streaming', 'Hello']])
    expect(accumulator.result()).toBe(response)
  })

  it('throws a typed error for terminal error events and when no response arrived', () => {
    const accumulator = createAgentStreamAccumulator()
    expect(() => accumulator.push({ type: 'error', code: 'cancelled', message: 'The request was cancelled.' })).toThrow(AgentStreamError)
    expect(() => createAgentStreamAccumulator().result()).toThrow(/ended before it completed/)
  })

  it('renders progress through the existing response shape', () => {
    expect(progressToResponse({ phase: 'draft', content: 'Draft', sourceHealth: health }, 'account-pulse'))
      .toMatchObject({ content: 'Draft', state: 'partial', capability: 'account-pulse', mode: 'live' })
  })
})

describe('readNdjson', () => {
  it('parses lines split across chunks and ignores heartbeat blanks', async () => {
    const encoder = new TextEncoder()
    const chunks = ['{"a":1}\n\n{"b"', ':2}\n', '{"c":3}']
    const body = new ReadableStream<Uint8Array>({
      start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close() }
    })
    const seen = vi.fn()
    await readNdjson(body, seen)
    expect(seen.mock.calls.map(([value]) => value)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('stops with a cancelled error when the signal aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const body = new ReadableStream<Uint8Array>({ start(stream) { stream.close() } })
    await expect(readNdjson(body, () => undefined, controller.signal)).rejects.toThrow(AgentStreamError)
  })
})
