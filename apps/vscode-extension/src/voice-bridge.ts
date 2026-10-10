import { SharedVoiceInputHost } from '../../../packages/orchestrator/voice-input.js'
import { errorResponse, parseBridgeParams, requestEnvelopeSchema, successResponse, type ResponseEnvelope } from './message-contracts.js'

export async function routeVoiceBridgeMessage(host: SharedVoiceInputHost, raw: unknown): Promise<ResponseEnvelope> {
    const parsed = requestEnvelopeSchema.safeParse(raw)
    if (!parsed.success || parsed.data.method !== 'voiceInput') {
        return errorResponse(parsed.success ? parsed.data.id : 'unknown', 'The voice request envelope was rejected.', 'invalid_envelope')
    }
    try {
        return successResponse(parsed.data.id, await host.invoke(parseBridgeParams('voiceInput', parsed.data.params)))
    } catch (error) {
        return errorResponse(parsed.data.id, error instanceof Error ? error.message.slice(0, 400) : 'Voice input failed.', 'voice_failed')
    }
}
