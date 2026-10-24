import { describe, expect, it, vi } from 'vitest'
import { createAgentStreamRouter } from '../../../apps/vscode-extension/src/host-router.js'
import type { ExtensionDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import type { StreamEventEnvelope } from '../../../apps/vscode-extension/src/message-contracts.js'
import { contractVersion, type AgentTaskResponse, type AgentTaskStreamEvent } from '../../../packages/common/contracts/index.js'

const params = { capability: 'account-pulse', accountId: 'a', opportunityId: 'o', prompt: 'Hello there' }
const response: AgentTaskResponse = {
  contractVersion, correlationId: '11111111-1111-4111-8111-111111111111', capability: 'account-pulse', agentVersion: 'v1',
  generatedAt: '2026-01-01T00:00:00.000Z', mode: 'sample', state: 'complete', content: 'Final',
  sourceHealth: [{ source: 'msx', state: 'sample', detail: 'Sample.', checkedAt: '2026-01-01T00:00:00.000Z' }]
}

function setup(provider: Partial<ExtensionDataProvider>) {
  const posted: StreamEventEnvelope[] = []
  const router = createAgentStreamRouter(() => provider as ExtensionDataProvider, (message) => posted.push(message))
  return { router, posted }
}

describe('VS Code agent stream router', () => {
  it('only claims stream envelopes', () => {
    const { router } = setup({})
    expect(router.handles({ kind: 'stream-request' })).toBe(true)
    expect(router.handles({ kind: 'stream-cancel' })).toBe(true)
    expect(router.handles({ kind: 'request' })).toBe(false)
    expect(router.handles(null)).toBe(false)
  })

  it('forwards provider events under the request id', async () => {
    const events: AgentTaskStreamEvent[] = [{ type: 'delta', text: 'Hi' }, { type: 'complete', response }]
    const runAgentTaskStream = vi.fn(async (_c, _a, _o, _p, onEvent: (event: AgentTaskStreamEvent) => void) => { events.forEach(onEvent) })
    const { router, posted } = setup({ runAgentTaskStream })
    await router.handle({ kind: 'stream-request', id: 's1', method: 'runAgentTaskStream', params })
    expect(posted).toEqual(events.map((event) => ({ kind: 'stream-event', id: 's1', event })))
    expect(runAgentTaskStream).toHaveBeenCalledWith('account-pulse', 'a', 'o', 'Hello there', expect.any(Function), expect.any(AbortSignal))
  })

  it('falls back to the blocking provider call and emits one complete event', async () => {
    const { router, posted } = setup({ runAgentTask: vi.fn(async () => response) })
    await router.handle({ kind: 'stream-request', id: 's2', method: 'runAgentTaskStream', params })
    expect(posted).toEqual([{ kind: 'stream-event', id: 's2', event: { type: 'complete', response } }])
  })

  it('aborts the run on cancel and reports a cancelled terminal event', async () => {
    const runAgentTaskStream = vi.fn((_c, _a, _o, _p, _onEvent, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const { router, posted } = setup({ runAgentTaskStream })
    const running = router.handle({ kind: 'stream-request', id: 's3', method: 'runAgentTaskStream', params })
    await router.handle({ kind: 'stream-cancel', id: 's3' })
    await running
    expect(posted).toEqual([{ kind: 'stream-event', id: 's3', event: { type: 'error', code: 'cancelled', message: 'aborted' } }])
  })

  it('rejects malformed envelopes with a terminal error and never calls the provider', async () => {
    const runAgentTaskStream = vi.fn()
    const { router, posted } = setup({ runAgentTaskStream })
    await router.handle({ kind: 'stream-request', id: 's4', method: 'runAgentTaskStream', params: { ...params, extra: true } })
    expect(posted).toEqual([{ kind: 'stream-event', id: 's4', event: { type: 'error', code: 'failed', message: 'The request envelope was rejected.' } }])
    expect(runAgentTaskStream).not.toHaveBeenCalled()
  })

  it('aborts every active run on dispose', async () => {
    let captured: AbortSignal | undefined
    const runAgentTaskStream = vi.fn((_c, _a, _o, _p, _onEvent, signal: AbortSignal) => new Promise<void>((resolve) => {
      captured = signal
      signal.addEventListener('abort', () => resolve())
    }))
    const { router } = setup({ runAgentTaskStream })
    const running = router.handle({ kind: 'stream-request', id: 's5', method: 'runAgentTaskStream', params })
    router.dispose()
    await running
    expect(captured?.aborted).toBe(true)
  })
})
