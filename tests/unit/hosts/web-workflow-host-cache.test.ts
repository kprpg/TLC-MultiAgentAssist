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
})