import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserVoiceProvider } from '../../../apps/shared/browser-voice-provider.js'
import type { VoiceSourceEvent } from '../../../packages/common/contracts/voice.js'

type AudioInput = { inputBuffer: { getChannelData(channel: number): Float32Array } }
const recognizers: FakeRecognizer[] = []
const models: FakeModel[] = []
const contexts: FakeAudioContext[] = []

class FakeRecognizer {
    acceptWaveformFloat = vi.fn()
    retrieveFinalResult = vi.fn()
    remove = vi.fn()
    constructor() { recognizers.push(this) }
    on() { }
}
class FakeModel {
    readonly KaldiRecognizer = FakeRecognizer
    readonly listeners = new Map<string, (event: object) => void>()
    terminate = vi.fn()
    constructor() { models.push(this) }
    on(type: string, listener: (event: object) => void) { this.listeners.set(type, listener) }
    emit(type: string, event: object) { this.listeners.get(type)?.(event) }
}
class FakeAudioContext {
    sampleRate = 16_000
    state = 'running'
    destination = {}
    processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as ((event: AudioInput) => void) | null }
    source = { connect: vi.fn(), disconnect: vi.fn() }
    resume = vi.fn(async () => undefined)
    close = vi.fn(async () => { this.state = 'closed' })
    constructor() { contexts.push(this) }
    createScriptProcessor() { return this.processor }
    createMediaStreamSource() { return this.source }
}

vi.mock('vosk-browser', () => ({ Model: FakeModel }))

function environment() {
    const track = { stop: vi.fn(), addEventListener: vi.fn() }
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
    const getUserMedia = vi.fn(async () => stream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('Worker', class { })
    vi.stubGlobal('document', { baseURI: 'http://127.0.0.1/' })
    return { track, stream, getUserMedia }
}
async function settle() {
    await vi.dynamicImportSettled()
    await Promise.resolve()
    await Promise.resolve()
}

describe('browser offline capture resources', () => {
    afterEach(() => {
        recognizers.length = 0
        models.length = 0
        contexts.length = 0
        vi.unstubAllGlobals()
    })

    it('buffers bounded microphone audio while the model loads and never requests camera', async () => {
        const e = environment()
        const events: VoiceSourceEvent[] = []
        const handle = createBrowserVoiceProvider().start({ sessionId: 'voice', hints: [], onEvent: (event) => events.push(event) })
        await settle()
        expect(e.getUserMedia).toHaveBeenCalledWith({ video: false, audio: expect.objectContaining({ channelCount: 1 }) })
        expect(events).toContainEqual({ contractVersion: '1.0', type: 'started' })
        const context = contexts[0]!
        const samples = new Float32Array([0.1, 0.2])
        context.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } })
        models[0]!.emit('load', { event: 'load', result: true })
        await settle()
        expect(recognizers[0]!.acceptWaveformFloat).toHaveBeenCalledExactlyOnceWith(expect.any(Float32Array), 16_000)
        handle.dispose()
        handle.dispose()
        expect(e.track.stop).toHaveBeenCalledTimes(1)
        expect(context.close).toHaveBeenCalledTimes(1)
        expect(models[0]!.terminate).toHaveBeenCalledTimes(1)
        expect(recognizers[0]!.remove).toHaveBeenCalledTimes(1)
    })

    it('releases a late-granted microphone without starting a cancelled model/session', async () => {
        const e = environment()
        let acquire: (stream: typeof e.stream) => void = () => { throw new Error('No microphone request') }
        e.getUserMedia.mockImplementation(() => new Promise((resolve) => { acquire = resolve }))
        const onEvent = vi.fn()
        const handle = createBrowserVoiceProvider().start({ sessionId: 'voice', hints: [], onEvent })
        handle.dispose()
        acquire(e.stream)
        await settle()
        expect(e.track.stop).toHaveBeenCalledTimes(1)
        expect(models).toHaveLength(0)
        expect(onEvent).not.toHaveBeenCalled()
    })

    it('stops audio and reports model-load failure explicitly', async () => {
        const e = environment()
        const onEvent = vi.fn()
        const handle = createBrowserVoiceProvider().start({ sessionId: 'voice', hints: [], onEvent })
        await settle()
        models[0]!.emit('error', { event: 'error', error: 'unavailable' })
        await settle()
        expect(e.track.stop).toHaveBeenCalled()
        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', code: 'provider-error' }))
        handle.dispose()
    })
})
