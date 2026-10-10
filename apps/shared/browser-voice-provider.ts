import type { Model, KaldiRecognizer } from 'vosk-browser'
import { voiceContractVersion, voiceLimits, type VoiceSourceEvent } from '../../packages/common/contracts/voice.js'
import type { VoiceProvider } from './voice-input.js'

export function createBrowserVoiceProvider(): VoiceProvider {
    return {
        getAvailability: () => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' &&
            typeof AudioContext !== 'undefined' && typeof Worker !== 'undefined'
            ? { available: true, processing: 'on-device', engine: 'browser-offline' }
            : {
                available: false, reason: 'unsupported-platform',
                message: 'Voice search needs a secure HTTPS or localhost browser with microphone, Web Audio, and WebAssembly support.'
            },
        start({ hints, onEvent }) {
            let disposed = false
            let stopping = false
            let stream: MediaStream | undefined
            let recognizer: KaldiRecognizer | undefined
            let hintRecognizer: KaldiRecognizer | undefined
            let recognizedHint = ''
            let lastFinalHint = ''
            const ordinaryFinals: string[] = []
            let finalizeRecognizers: (() => void) | undefined
            let finalization: ReturnType<typeof setTimeout> | undefined
            let processor: ScriptProcessorNode | undefined
            let source: MediaStreamAudioSourceNode | undefined
            let model: Model | undefined
            let modelTimeout: ReturnType<typeof setTimeout> | undefined
            let closing = false
            const stoppedTracks = new Set<MediaStreamTrack>()
            let sequence = 0
            let segment = 0
            let bufferedSamples = 0
            const warmingAudio: Float32Array[] = []
            const audio = new AudioContext()
            const resumed = audio.resume()
            const modelUrl = new URL('voice/vosk-model-small-en-us-0.15.tar.gz', new URL('.', document.baseURI))
            const emit = (event: VoiceSourceEvent) => { if (!disposed) onEvent(event) }
            const stopStream = (acquired: MediaStream) => acquired.getTracks().forEach((track) => {
                if (!stoppedTracks.has(track)) {
                    stoppedTracks.add(track)
                    track.stop()
                }
            })
            const releaseCapture = () => {
                if (stream) stopStream(stream)
                processor?.disconnect()
                if (processor) processor.onaudioprocess = null
                source?.disconnect()
                warmingAudio.length = 0
                bufferedSamples = 0
                if (!closing && audio.state !== 'closed') {
                    closing = true
                    void audio.close().catch(() => {
                        emit({ contractVersion: voiceContractVersion, type: 'error', code: 'provider-error', message: 'The audio context could not be released.' })
                    })
                }
            }
            const fail = (message: string, code: 'permission-denied' | 'provider-error' | 'device-lost' = 'provider-error') => {
                if (disposed) return
                releaseCapture()
                emit({ contractVersion: voiceContractVersion, type: 'error', code, message })
            }
            const ready = import('vosk-browser').then(({ Model }) => new Promise<void>((resolve, reject) => {
                if (disposed || stopping) { resolve(); return }
                model = new Model(modelUrl.toString(), -2)
                modelTimeout = setTimeout(() => reject(new Error('Offline model loading timed out.')), 20_000)
                model.on('load', (message) => {
                    clearTimeout(modelTimeout)
                    if (message.event === 'load' && message.result) resolve()
                    else reject(new Error('Offline model loading failed.'))
                })
                model.on('error', () => {
                    clearTimeout(modelTimeout)
                    reject(new Error('Offline model loading failed.'))
                    fail('The offline speech model became unavailable.')
                })
            }))
            const microphone = navigator.mediaDevices.getUserMedia({
                video: false, audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
            }).then((acquired) => {
                if (disposed || stopping) {
                    stopStream(acquired)
                    return acquired
                }
                stream = acquired
                acquired.getAudioTracks().forEach((track) => track.addEventListener('ended', () => {
                    if (!disposed && !stopping) fail('The microphone became unavailable.', 'device-lost')
                }))
                processor = audio.createScriptProcessor(4096, 1, 1)
                processor.onaudioprocess = (event) => {
                    if (disposed || stopping) return
                    const samples = event.inputBuffer.getChannelData(0)
                    try {
                        if (recognizer) {
                            hintRecognizer?.acceptWaveformFloat(samples, audio.sampleRate)
                            recognizer.acceptWaveformFloat(samples, audio.sampleRate)
                        }
                        else if (bufferedSamples + samples.length <= audio.sampleRate * voiceLimits.silenceMs / 1000) {
                            warmingAudio.push(new Float32Array(samples))
                            bufferedSamples += samples.length
                        } else fail('The offline model did not become ready within the bounded audio buffer.')
                    } catch { fail('The offline speech engine could not process microphone audio.') }
                }
                source = audio.createMediaStreamSource(acquired)
                source.connect(processor)
                processor.connect(audio.destination)
                emit({ contractVersion: voiceContractVersion, type: 'started' })
                return acquired
            })
            void Promise.all([microphone, ready, resumed]).then(([acquired]) => {
                if (disposed || stopping) { stopStream(acquired); return }
                if (!model) throw new Error('The offline speech model is unavailable.')
                const exactHint = (text: string) => {
                    const normalized = text.toLocaleLowerCase('en-US').trim()
                    return normalized && hints.some((hint) => hint.toLocaleLowerCase('en-US') === normalized) ? normalized : ''
                }
                const publishFinals = () => {
                    while (ordinaryFinals.length) {
                        const ordinary = ordinaryFinals.shift() ?? ''
                        const text = lastFinalHint || recognizedHint || ordinary
                        if (text) emit({
                            contractVersion: voiceContractVersion, type: 'segment',
                            segment: { id: String(segment++), sequence: ++sequence, text, isFinal: true }
                        })
                    }
                    lastFinalHint = ''
                    recognizedHint = ''
                }
                const vocabularyWords = new Set(hints.flatMap((hint) => hint.toLocaleLowerCase('en-US').split(/\s+/)))
                if (hints.length) {
                    hintRecognizer = new model.KaldiRecognizer(audio.sampleRate,
                        JSON.stringify([...hints.map((hint) => hint.toLocaleLowerCase('en-US')), '[unk]']))
                    hintRecognizer.on('partialresult', (message) => {
                        if (message.event === 'partialresult') {
                            recognizedHint = exactHint(message.result.partial)
                            if (recognizedHint) emit({
                                contractVersion: voiceContractVersion, type: 'segment',
                                segment: { id: String(segment), sequence: ++sequence, text: recognizedHint, isFinal: false }
                            })
                        }
                    })
                    hintRecognizer.on('result', (message) => {
                        if (message.event === 'result') {
                            const hint = exactHint(message.result.text)
                            if (hint) {
                                recognizedHint = hint
                                lastFinalHint = hint
                            }
                        }
                    })
                }
                recognizer = new model.KaldiRecognizer(audio.sampleRate)
                recognizer.on('error', () => fail('The offline speech recognizer became unavailable.'))
                recognizer.on('partialresult', (message) => {
                    if (message.event === 'partialresult' && message.result.partial) emit({
                        contractVersion: voiceContractVersion, type: 'segment',
                        segment: { id: String(segment), sequence: ++sequence, text: recognizedHint || message.result.partial, isFinal: false }
                    })
                })
                recognizer.on('result', (message) => {
                    if (message.event === 'result') {
                        if (message.result.text) ordinaryFinals.push(message.result.text)
                        const words = message.result.text.toLocaleLowerCase('en-US').split(/\s+/)
                        if (hintRecognizer && words.some((word) => vocabularyWords.has(word))) {
                            hintRecognizer.retrieveFinalResult()
                        } else {
                            recognizedHint = ''
                            publishFinals()
                        }
                    }
                })
                finalizeRecognizers = () => {
                    if (!recognizer) return
                    hintRecognizer?.retrieveFinalResult()
                    recognizer.retrieveFinalResult()
                    finalization = setTimeout(() => {
                        publishFinals()
                        emit({ contractVersion: voiceContractVersion, type: 'ended' })
                    }, voiceLimits.finalizationMs - 100)
                }
                for (const samples of warmingAudio) {
                    hintRecognizer?.acceptWaveformFloat(samples, audio.sampleRate)
                    recognizer.acceptWaveformFloat(samples, audio.sampleRate)
                }
                warmingAudio.length = 0
                bufferedSamples = 0
            }).catch((error: unknown) => {
                const denied = error instanceof DOMException && error.name === 'NotAllowedError'
                fail(denied ? 'Microphone access was denied. Allow the microphone in browser settings.' :
                    'Offline voice could not start. Check the microphone and installed application voice model.',
                denied ? 'permission-denied' : 'provider-error')
            })
            return {
                stop() {
                    if (disposed || stopping) return
                    stopping = true
                    releaseCapture()
                    if (recognizer) {
                        finalizeRecognizers?.()
                    }
                    else emit({ contractVersion: voiceContractVersion, type: 'ended' })
                },
                dispose() {
                    if (disposed) return
                    disposed = true
                    clearTimeout(modelTimeout)
                    clearTimeout(finalization)
                    releaseCapture()
                    recognizer?.remove()
                    hintRecognizer?.remove()
                    ordinaryFinals.length = 0
                    model?.terminate()
                }
            }
        }
    }
}
