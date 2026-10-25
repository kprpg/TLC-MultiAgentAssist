import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollWorkflow } from '../../../apps/shared/workflow-polling.js'

afterEach(() => vi.useRealTimers())

describe('workflow polling', () => {
    it('waits past the old 15-second UI limit using the advertised workflow deadline', async () => {
        vi.useFakeTimers()
        const started = Date.now()
        const read = vi.fn(async () => ({
            run: { status: Date.now() - started < 20_000 ? 'running' : 'completed' }
        }))
        const result = pollWorkflow(read, 60_000)

        await vi.advanceTimersByTimeAsync(20_100)

        expect((await result).run.status).toBe('completed')
        expect(vi.getTimerCount()).toBe(0)
    })

    it.each(['completed', 'failed', 'cancelled'])('stops polling when the run is %s', async (status) => {
        const read = vi.fn(async () => ({ run: { status } }))
        const update = vi.fn()

        expect(await pollWorkflow(read, 60_000, update)).toEqual({ run: { status } })
        expect(read).toHaveBeenCalledTimes(1)
        expect(update).toHaveBeenCalledWith({ run: { status } })
    })

    it('allows 15 seconds of grace, then bounds even a stalled transport request', async () => {
        vi.useFakeTimers()
        let release!: (value: { run: { status: string } }) => void
        const update = vi.fn()
        const result = pollWorkflow(() => new Promise((resolve) => { release = resolve }), 60_000, update)
        const rejected = expect(result).rejects.toThrow('The play timed out before completing.')

        await vi.advanceTimersByTimeAsync(74_999)
        expect(update).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        await rejected
        release({ run: { status: 'completed' } })
        await Promise.resolve()

        expect(update).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('never overlaps polls and releases the deadline timer after a transport failure', async () => {
        vi.useFakeTimers()
        const read = vi.fn(() => new Promise<{ run: { status: string } }>((_resolve, reject) => {
            setTimeout(() => reject(new Error('Bridge unavailable.')), 1_000)
        }))
        const result = pollWorkflow(read, 60_000)
        const rejected = expect(result).rejects.toThrow('Bridge unavailable.')

        await vi.advanceTimersByTimeAsync(1_000)
        await rejected

        expect(read).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it.each([0, -1, NaN, Infinity])('rejects an invalid workflow deadline: %s', async (timeoutMs) => {
        const read = vi.fn(async () => ({ run: { status: 'completed' } }))

        await expect(pollWorkflow(read, timeoutMs)).rejects.toThrow('Workflow timeout must be a positive integer.')
        expect(read).not.toHaveBeenCalled()
    })
})
