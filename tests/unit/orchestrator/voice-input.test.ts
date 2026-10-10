import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedVoiceInputHost } from '../../../packages/orchestrator/voice-input.js'
import { voiceContractVersion, type VoiceAvailability, type VoiceCaptureDriver, type VoiceSourceEvent } from '../../../packages/common/contracts/voice.js'

const sessionId = '11111111-1111-4111-8111-111111111111'
const start = { contractVersion: voiceContractVersion, operation: 'start', sessionId, locale: 'en-US', consent: true, hints: [] }
const operation = (operation: 'read' | 'stop' | 'cancel') => ({ contractVersion: voiceContractVersion, operation, sessionId })

function harness(canStart = true) {
    let event: (event: VoiceSourceEvent) => void = () => { throw new Error('Capture not started') }
    const dispose = vi.fn()
    const stop = vi.fn()
    const driver: VoiceCaptureDriver = {
        getAvailability: () => ({ available: true, processing: 'on-device', engine: 'windows-offline' }),
        start: vi.fn((_request, onEvent) => {
            event = onEvent
            onEvent({ contractVersion: voiceContractVersion, type: 'started' })
            return { stop, dispose }
        })
    }
    const host = new SharedVoiceInputHost(driver, () => canStart)
    return { host, driver, dispose, stop, emit: (value: VoiceSourceEvent) => event(value) }
}

describe('shared voice input host', () => {
    afterEach(() => vi.useRealTimers())

    it('correlates reads, prevents concurrent capture and releases all terminal paths', async () => {
        const h = harness()
        expect(await h.host.invoke(start)).toMatchObject({ sessionId, status: 'listening' })
        await expect(h.host.invoke(start)).rejects.toThrow('already active')
        await expect(h.host.invoke({ ...operation('read'), sessionId: '22222222-2222-4222-8222-222222222222' })).rejects.toThrow('not available')
        await h.host.invoke(operation('cancel'))
        expect(h.dispose).toHaveBeenCalledTimes(1)
        expect(await h.host.invoke(operation('read'))).toMatchObject({ status: 'cancelled', segments: [] })
        h.host.dispose()
        expect(h.dispose).toHaveBeenCalledTimes(1)
    })

    it('cannot start after cancellation during asynchronous availability', async () => {
        let ready: (availability: VoiceAvailability) => void = () => { throw new Error('No probe') }
        const capture = vi.fn()
        const host = new SharedVoiceInputHost({
            getAvailability: () => new Promise((resolve) => { ready = resolve }),
            start: capture
        })
        const pending = host.invoke(start)
        await host.invoke(operation('cancel'))
        ready({ available: true, processing: 'on-device', engine: 'windows-offline' })
        await expect(pending).rejects.toThrow('cancelled')
        expect(capture).not.toHaveBeenCalled()
        host.dispose()
    })

    it('requires the active visible foreground host even with consent', async () => {
        const h = harness(false)
        expect(await h.host.invoke(start)).toMatchObject({ status: 'error', errorCode: 'cancelled' })
        expect(h.driver.start).not.toHaveBeenCalled()
        h.host.dispose()
    })

    it('bounds the final flush and drops late events', async () => {
        vi.useFakeTimers()
        const h = harness()
        await h.host.invoke(start)
        h.emit({ contractVersion: voiceContractVersion, type: 'segment', segment: { id: '0', sequence: 1, text: 'grid', isFinal: true } })
        await h.host.invoke(operation('stop'))
        vi.advanceTimersByTime(999)
        expect(h.dispose).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(h.dispose).toHaveBeenCalledTimes(1)
        h.emit({ contractVersion: voiceContractVersion, type: 'segment', segment: { id: '1', sequence: 2, text: 'stale', isFinal: true } })
        expect(await h.host.invoke(operation('read'))).toMatchObject({
            status: 'ended', segments: [{ id: '0', sequence: 1, text: 'grid', isFinal: true }]
        })
        h.host.dispose()
    })

    it('rejects a transcript overflow before accepting or returning it', async () => {
        const h = harness()
        await h.host.invoke(start)
        h.emit({ contractVersion: voiceContractVersion, type: 'segment', segment: { id: '0', sequence: 1, text: 'a'.repeat(2000), isFinal: true } })
        h.emit({ contractVersion: voiceContractVersion, type: 'segment', segment: { id: '1', sequence: 2, text: 'b', isFinal: true } })
        expect(h.stop).toHaveBeenCalledTimes(1)
        const response = await h.host.invoke(operation('read'))
        expect(response).toMatchObject({ status: 'finalizing', message: expect.stringContaining('not accepted') })
        if (response.kind !== 'session') throw new Error('Expected session response')
        expect(response.segments).toHaveLength(1)
        h.host.dispose()
    })
})
