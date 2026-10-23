import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TlcDesktopApi } from '../../../apps/desktop/electron/preload/index.js'
import { contractVersion, type AgentTaskStreamEvent } from '../../../packages/common/contracts/index.js'

const electron = vi.hoisted(() => ({
    invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
    on: vi.fn<(channel: string, listener: (event: unknown, message: { streamId?: string; event?: unknown }) => void) => void>(),
    removeListener: vi.fn(),
    expose: vi.fn<(name: string, api: TlcDesktopApi) => void>()
}))
vi.mock('electron', () => ({
    ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener },
    contextBridge: { exposeInMainWorld: electron.expose }
}))
import '../../../apps/desktop/electron/preload/index.js'

const request = { contractVersion, capability: 'account-pulse' as const, accountId: 'account', opportunityId: 'opportunity', prompt: 'Review the evidence.' }
const terminal: AgentTaskStreamEvent = {
    type: 'complete',
    response: {
        contractVersion, correlationId: '11111111-1111-4111-8111-111111111111', capability: 'account-pulse',
        agentVersion: 'test', generatedAt: '2026-10-22T12:00:00.000Z', mode: 'sample', state: 'complete', content: '## Summary\n\nGrounded answer.',
        sourceHealth: [{ source: 'msx', state: 'sample', detail: 'Sanitized.', checkedAt: '2026-10-22T12:00:00.000Z' }]
    }
}

function api() {
    const exposed = electron.expose.mock.calls.find(([name]) => name === 'tlc')?.[1]
    if (!exposed) throw new Error('The Desktop bridge was not exposed.')
    return exposed
}

beforeEach(() => {
    electron.invoke.mockReset()
    electron.on.mockClear()
    electron.removeListener.mockClear()
})

describe('Desktop stream terminal acknowledgement', () => {
    it('delivers the final response when the invoke reply arrives before queued events', async () => {
        electron.invoke.mockResolvedValue(terminal)
        const received = vi.fn()
        await api().runAgentTaskStream(request, received).done
        expect(received.mock.calls).toEqual([[terminal]])
        expect(electron.removeListener).toHaveBeenCalledOnce()
    })

    it('does not deliver the final response twice when the event arrives before its acknowledgement', async () => {
        let reply: ((value: unknown) => void) | undefined
        electron.invoke.mockImplementation(() => new Promise((resolve) => { reply = resolve }))
        const received = vi.fn()
        const stream = api().runAgentTaskStream(request, received)
        const listener = electron.on.mock.calls[0]?.[1]
        const streamId = electron.invoke.mock.calls[0]?.[2]
        if (!listener || typeof streamId !== 'string' || !reply) throw new Error('The stream was not started.')
        listener({}, { streamId: 'another-stream', event: terminal })
        listener({}, { streamId, event: { type: 'delta', text: 'Grounded ' } })
        listener({}, { streamId, event: terminal })
        reply(terminal)
        await stream.done
        expect(received.mock.calls).toEqual([[{ type: 'delta', text: 'Grounded ' }], [terminal]])
        expect(electron.removeListener).toHaveBeenCalledOnce()
    })

    it('delivers cancelled terminal events through the acknowledgement path', async () => {
        const cancelled = { type: 'error', code: 'cancelled', message: 'The request was cancelled.' }
        electron.invoke.mockResolvedValue(cancelled)
        const received = vi.fn()
        await api().runAgentTaskStream(request, received).done
        expect(received).toHaveBeenCalledWith(cancelled)
    })

    it('propagates failed invocations and rejects missing or nonterminal acknowledgements', async () => {
        electron.invoke.mockRejectedValueOnce(new Error('Access denied.'))
        await expect(api().runAgentTaskStream(request, vi.fn()).done).rejects.toThrow('Access denied.')
        for (const value of [undefined, { type: 'delta', text: 'Incomplete' }]) {
            electron.invoke.mockResolvedValueOnce(value)
            await expect(api().runAgentTaskStream(request, vi.fn()).done).rejects.toThrow()
        }
        expect(electron.removeListener).toHaveBeenCalledTimes(3)
    })
})
