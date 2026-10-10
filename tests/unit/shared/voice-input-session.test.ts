import { afterEach, describe, expect, it, vi } from 'vitest'
import { voiceContractVersion, type VoiceSourceEvent } from '../../../packages/common/contracts/voice.js'
import { VoiceInputSession, initialVoiceState, type VoiceProvider, type VoiceState } from '../../../apps/shared/voice-input.js'

function harness(synchronous = false) {
    let event: (event: VoiceSourceEvent) => void = () => { throw new Error('No session started') }
    let state: VoiceState = initialVoiceState
    const stop = vi.fn()
    const dispose = vi.fn()
    const commit = vi.fn()
    const provider: VoiceProvider = {
        getAvailability: () => ({ available: true, processing: 'on-device', engine: 'browser-offline' }),
        start: vi.fn((options) => {
            event = options.onEvent
            if (synchronous) {
                event({ contractVersion: voiceContractVersion, type: 'started' })
                event({ contractVersion: voiceContractVersion, type: 'segment', segment: { id: '0', sequence: 1, text: 'grid', isFinal: true } })
                event({ contractVersion: voiceContractVersion, type: 'ended' })
            }
            return { stop, dispose }
        })
    }
    const session = new VoiceInputSession(provider, (next) => { state = next }, commit)
    return {
        session, provider, stop, dispose, commit, state: () => state,
        event: () => event,
        started: () => event({ contractVersion: voiceContractVersion, type: 'started' }),
        text: (id: string, sequence: number, text: string, isFinal = true) => event({
            contractVersion: voiceContractVersion, type: 'segment', segment: { id, sequence, text, isFinal }
        }),
        ended: () => event({ contractVersion: voiceContractVersion, type: 'ended' })
    }
}

describe('voice input session', () => {
    afterEach(() => vi.useRealTimers())

    it.each([
        ['', 0, 0, 'grid'],
        ['before after', 7, 7, 'before gridafter'],
        ['before old after', 7, 10, 'before grid after']
    ])('inserts once into the captured caret/selection of %j', (value, start, end, expected) => {
        const h = harness()
        h.session.start({ value, start, end })
        h.started()
        h.text('0', 1, 'gr', false)
        h.text('0', 2, 'grid', false)
        expect(h.commit).not.toHaveBeenCalled()
        expect(h.state().preview).toBe('grid')
        h.text('0', 3, 'grid')
        h.ended()
        h.ended()
        expect(h.commit).toHaveBeenCalledExactlyOnceWith(expected, start + 4)
        expect(h.dispose).toHaveBeenCalledTimes(1)
    })

    it('rejects old sequences and duplicate finalized IDs without repeating words', () => {
        const h = harness()
        h.session.start({ value: '', start: 0, end: 0 })
        h.started()
        h.text('0', 2, 'grid')
        h.text('0', 3, 'grid')
        h.text('1', 1, 'stale')
        h.text('1', 4, 'operations')
        h.ended()
        expect(h.commit).toHaveBeenCalledExactlyOnceWith('grid operations', 15)
    })

    it('cancels without restoration writes and rejects callbacks from previous sessions', () => {
        const h = harness()
        h.session.start({ value: 'typed', start: 5, end: 5 })
        h.started()
        h.text('0', 1, 'uninserted')
        const old = h.event()
        h.session.cancel()
        h.session.cancel()
        old({ contractVersion: voiceContractVersion, type: 'ended' })
        expect(h.commit).not.toHaveBeenCalled()
        expect(h.dispose).toHaveBeenCalledTimes(1)
        h.session.start({ value: 'manual', start: 6, end: 6 })
        old({ contractVersion: voiceContractVersion, type: 'segment', segment: { id: 'old', sequence: 10, text: 'stale', isFinal: true } })
        h.ended()
        expect(h.commit).not.toHaveBeenCalled()
    })

    it('owns synchronous provider events and disposes the returned handle exactly once', () => {
        const h = harness(true)
        h.session.start({ value: '', start: 0, end: 0 })
        expect(h.commit).toHaveBeenCalledExactlyOnceWith('grid', 4)
        expect(h.dispose).toHaveBeenCalledTimes(1)
        expect(h.session.active).toBe(false)
    })

    it('does not create parallel capture owners on rapid activation', () => {
        const h = harness()
        h.session.start({ value: '', start: 0, end: 0 })
        h.session.start({ value: '', start: 0, end: 0 })
        expect(h.provider.start).toHaveBeenCalledTimes(1)
        h.session.cancel()
    })

    it('does not run inactivity while arming; renews exactly at the 10-second limit', () => {
        vi.useFakeTimers()
        const h = harness()
        h.session.start({ value: '', start: 0, end: 0 })
        vi.advanceTimersByTime(20_000)
        expect(h.stop).not.toHaveBeenCalled()
        h.started()
        vi.advanceTimersByTime(9_999)
        expect(h.stop).not.toHaveBeenCalled()
        h.text('0', 1, 'grid')
        vi.advanceTimersByTime(9_999)
        expect(h.stop).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(h.stop).toHaveBeenCalledTimes(1)
        h.session.cancel()
    })

    it('stops at exactly 30 seconds despite ongoing speech', () => {
        vi.useFakeTimers()
        const h = harness()
        h.session.start({ value: '', start: 0, end: 0 })
        h.started()
        for (let i = 0; i < 3; i++) {
            vi.advanceTimersByTime(9_000)
            h.text('0', i + 1, 'grid', false)
        }
        vi.advanceTimersByTime(2_999)
        expect(h.stop).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(h.stop).toHaveBeenCalledTimes(1)
        expect(h.state().message).toContain('30-second')
        h.session.cancel()
    })

    it('flushes for at most one second and never treats interim speech as final', () => {
        vi.useFakeTimers()
        const h = harness()
        h.session.start({ value: '', start: 0, end: 0 })
        h.started()
        h.text('0', 1, 'grid')
        h.text('1', 2, 'unfinished', false)
        h.session.stop()
        vi.advanceTimersByTime(999)
        expect(h.commit).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(h.commit).toHaveBeenCalledExactlyOnceWith('grid', 4)
        expect(h.state().message).toContain('Unconfirmed')
        h.text('1', 3, 'too late')
        expect(h.commit).toHaveBeenCalledTimes(1)
    })

    it('accepts exactly 2000 characters and rejects the first overflowing segment visibly', () => {
        const h = harness()
        h.session.start({ value: '', start: 0, end: 0 })
        h.started()
        h.text('0', 1, 'a'.repeat(2000))
        expect(h.stop).not.toHaveBeenCalled()
        h.text('1', 2, 'b')
        expect(h.stop).toHaveBeenCalledTimes(1)
        expect(h.state().message).toContain('not accepted')
        h.ended()
        expect(h.commit).toHaveBeenCalledExactlyOnceWith('a'.repeat(2000), 2000)
    })

    it('accepts exactly 64 segments without accepting the 65th', () => {
        const h = harness()
        h.session.start({ value: '', start: 0, end: 0 })
        h.started()
        for (let i = 0; i < 64; i++) h.text(String(i), i, 'a')
        expect(h.stop).not.toHaveBeenCalled()
        h.text('overflow', 64, 'b')
        expect(h.stop).toHaveBeenCalledTimes(1)
        h.ended()
        expect(h.commit).toHaveBeenCalledExactlyOnceWith(Array(64).fill('a').join(' '), 127)
    })

    it.each(['permission-denied', 'no-speech', 'device-lost', 'provider-error'] as const)('discards speech and releases capture on %s', (code) => {
        const h = harness()
        h.session.start({ value: 'typed', start: 5, end: 5 })
        h.text('0', 1, 'uninserted')
        h.event()({ contractVersion: voiceContractVersion, type: 'error', code, message: `Failure: ${code}` })
        expect(h.state().phase).toBe('error')
        expect(h.state().message).toContain(code)
        expect(h.commit).not.toHaveBeenCalled()
        expect(h.dispose).toHaveBeenCalledTimes(1)
    })
})
