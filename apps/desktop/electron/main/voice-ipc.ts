import type { SharedVoiceInputHost } from '../../../../packages/orchestrator/voice-input.js'

export const voiceIpcChannel = 'tlc:voice-input'
export function createVoiceIpcHandler(host: SharedVoiceInputHost) {
    return (request: unknown) => host.invoke(request)
}
