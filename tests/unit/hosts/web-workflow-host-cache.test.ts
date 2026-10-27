import { describe, expect, it, vi } from 'vitest'
import { evictOldestWorkflowHost } from '../../../apps/web/src/runtime.js'

describe('Web workflow host cache', () => {
    it('disposes and removes the least recently used host at capacity', async () => {
        const oldestDispose = vi.fn().mockResolvedValue(undefined)
        const newestDispose = vi.fn().mockResolvedValue(undefined)
        const hosts = new Map([
            ['oldest', { lastUsed: 1, dispose: oldestDispose }],
            ['newest', { lastUsed: 2, dispose: newestDispose }]
        ])

        await evictOldestWorkflowHost(hosts, 2)

        expect([...hosts.keys()]).toEqual(['newest'])
        expect(oldestDispose).toHaveBeenCalledOnce()
        expect(newestDispose).not.toHaveBeenCalled()
    })

    it('does not evict below capacity', async () => {
        const dispose = vi.fn().mockResolvedValue(undefined)
        const hosts = new Map([['only', { lastUsed: 1, dispose }]])

        await evictOldestWorkflowHost(hosts, 2)

        expect([...hosts.keys()]).toEqual(['only'])
        expect(dispose).not.toHaveBeenCalled()
    })

    it('never disposes a host with active runs; it evicts the least recently used idle host instead', async () => {
        const busyDispose = vi.fn().mockResolvedValue(undefined)
        const idleDispose = vi.fn().mockResolvedValue(undefined)
        const hosts = new Map([
            ['busy-oldest', { lastUsed: 1, dispose: busyDispose, activeRunCount: () => 2 }],
            ['idle', { lastUsed: 2, dispose: idleDispose, activeRunCount: () => 0 }],
            ['newest', { lastUsed: 3, dispose: vi.fn().mockResolvedValue(undefined), activeRunCount: () => 0 }]
        ])

        await evictOldestWorkflowHost(hosts, 3)

        expect([...hosts.keys()]).toEqual(['busy-oldest', 'newest'])
        expect(idleDispose).toHaveBeenCalledOnce()
        expect(busyDispose).not.toHaveBeenCalled()
    })

    it('refuses admission with an explicit overload error when every cached host has active runs', async () => {
        const dispose = vi.fn().mockResolvedValue(undefined)
        const hosts = new Map([
            ['a', { lastUsed: 1, dispose, activeRunCount: () => 1 }],
            ['b', { lastUsed: 2, dispose, activeRunCount: () => 3 }]
        ])

        await expect(evictOldestWorkflowHost(hosts, 2)).rejects.toThrowError(
            expect.objectContaining({ name: 'WorkflowRuntimeError', code: 'capacity_exceeded' })
        )
        expect([...hosts.keys()]).toEqual(['a', 'b'])
        expect(dispose).not.toHaveBeenCalled()
    })
})