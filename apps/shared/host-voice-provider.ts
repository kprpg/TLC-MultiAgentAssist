import {
    voiceContractVersion, voiceResponseSchema, type VoiceRequest
} from '../../packages/common/contracts/voice.js'
import type { VoiceProvider } from './voice-input.js'

export function createHostVoiceProvider(invoke: (request: VoiceRequest) => Promise<unknown>): VoiceProvider {
    return {
        async getAvailability() {
            const response = voiceResponseSchema.parse(await invoke({ contractVersion: voiceContractVersion, operation: 'availability' }))
            if (response.kind !== 'availability') throw new Error('The voice availability response is invalid.')
            return response.availability
        },
        start({ sessionId, hints, onEvent }) {
            let disposed = false
            let terminal = false
            let started = false
            let lastSequence = -1
            let poll: ReturnType<typeof setTimeout> | undefined
            const sendError = (message: string) => {
                if (!disposed && !terminal) {
                    terminal = true
                    onEvent({ contractVersion: voiceContractVersion, type: 'error', code: 'provider-error', message })
                }
            }
            const read = async (operation: 'start' | 'read' | 'stop') => {
                try {
                    const request: VoiceRequest = operation === 'start'
                        ? { contractVersion: voiceContractVersion, sessionId, operation, locale: 'en-US', consent: true, hints }
                        : { contractVersion: voiceContractVersion, sessionId, operation }
                    const response = voiceResponseSchema.parse(await invoke(request))
                    if (disposed || terminal) return
                    if (response.kind !== 'session' || response.sessionId !== sessionId) {
                        throw new Error('The voice session response is invalid.')
                    }
                    if (!started && response.status !== 'arming' && response.status !== 'cancelled' && response.status !== 'error') {
                        started = true
                        onEvent({ contractVersion: voiceContractVersion, type: 'started' })
                    }
                    for (const segment of [...response.segments].sort((a, b) => a.sequence - b.sequence)) {
                        if (segment.sequence > lastSequence) {
                            lastSequence = segment.sequence
                            onEvent({ contractVersion: voiceContractVersion, type: 'segment', segment })
                        }
                    }
                    if (response.status === 'error' || response.status === 'cancelled') {
                        terminal = true
                        onEvent({
                            contractVersion: voiceContractVersion, type: 'error',
                            code: response.errorCode ?? 'cancelled',
                            message: response.message || 'Voice input was cancelled.'
                        })
                    } else if (response.status === 'ended') {
                        terminal = true
                        onEvent({ contractVersion: voiceContractVersion, type: 'ended' })
                    } else if (!disposed && !terminal && operation !== 'stop') {
                        poll = setTimeout(() => { void read('read') }, 80)
                    }
                } catch {
                    sendError('The voice host request failed. Check the local offline speech engine.')
                }
            }
            void read('start')
            return {
                stop: () => { if (!disposed && !terminal) void read('stop') },
                dispose() {
                    if (disposed) return
                    disposed = true
                    clearTimeout(poll)
                    void invoke({ contractVersion: voiceContractVersion, operation: 'cancel', sessionId }).catch(() => {
                        console.error('Voice host cancellation acknowledgement failed.')
                    })
                }
            }
        }
    }
}
