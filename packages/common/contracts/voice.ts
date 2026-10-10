import { z } from 'zod'

export const voiceContractVersion = '1.0' as const
export const voiceLimits = {
    maxAudioMs: 30_000,
    silenceMs: 10_000,
    maxTranscriptChars: 2_000,
    maxSegments: 64,
    finalizationMs: 1_000
} as const

export const voiceAvailabilitySchema = z.discriminatedUnion('available', [
    z.object({
        available: z.literal(true),
        processing: z.literal('on-device'),
        engine: z.enum(['windows-offline', 'browser-offline'])
    }).strict(),
    z.object({
        available: z.literal(false),
        reason: z.enum(['unsupported-platform', 'remote-host', 'missing-language', 'not-configured']),
        message: z.string().min(1).max(400)
    }).strict()
])

export const voiceSegmentSchema = z.object({
    id: z.string().min(1).max(80),
    sequence: z.number().int().nonnegative(),
    text: z.string().max(voiceLimits.maxTranscriptChars),
    isFinal: z.boolean()
}).strict()

export const voiceErrorCodeSchema = z.enum([
    'permission-denied', 'no-speech', 'device-lost', 'provider-error', 'cancelled'
])

export const voiceSourceEventSchema = z.discriminatedUnion('type', [
    z.object({ contractVersion: z.literal(voiceContractVersion), type: z.literal('started') }).strict(),
    z.object({
        contractVersion: z.literal(voiceContractVersion),
        type: z.literal('segment'),
        segment: voiceSegmentSchema.extend({ text: z.string().max(16_384) }).strict()
    }).strict(),
    z.object({
        contractVersion: z.literal(voiceContractVersion),
        type: z.literal('ended')
    }).strict(),
    z.object({
        contractVersion: z.literal(voiceContractVersion),
        type: z.literal('error'),
        code: voiceErrorCodeSchema,
        message: z.string().min(1).max(400)
    }).strict()
])

const envelope = { contractVersion: z.literal(voiceContractVersion) }
export const voiceStartRequestSchema = z.object({
    ...envelope,
    operation: z.literal('start'),
    sessionId: z.string().uuid(),
    locale: z.literal('en-US'),
    consent: z.literal(true),
    hints: z.array(z.string().trim().min(1).max(200)).max(64).default([])
}).strict()

export const voiceRequestSchema = z.discriminatedUnion('operation', [
    z.object({ ...envelope, operation: z.literal('availability') }).strict(),
    voiceStartRequestSchema,
    z.object({
        ...envelope,
        operation: z.enum(['read', 'stop', 'cancel']),
        sessionId: z.string().uuid()
    }).strict()
])

export const voiceSessionSchema = z.object({
    ...envelope,
    kind: z.literal('session'),
    sessionId: z.string().uuid(),
    status: z.enum(['arming', 'listening', 'finalizing', 'ended', 'cancelled', 'error']),
    segments: z.array(voiceSegmentSchema).max(voiceLimits.maxSegments),
    message: z.string().max(400),
    errorCode: voiceErrorCodeSchema.optional()
}).strict()

export const voiceResponseSchema = z.discriminatedUnion('kind', [
    z.object({
        ...envelope,
        kind: z.literal('availability'),
        availability: voiceAvailabilitySchema
    }).strict(),
    voiceSessionSchema
])

export type VoiceAvailability = z.infer<typeof voiceAvailabilitySchema>
export type VoiceSegment = z.infer<typeof voiceSegmentSchema>
export type VoiceSourceEvent = z.infer<typeof voiceSourceEventSchema>
export type VoiceErrorCode = z.infer<typeof voiceErrorCodeSchema>
export type VoiceStartRequest = z.infer<typeof voiceStartRequestSchema>
export type VoiceRequest = z.input<typeof voiceRequestSchema>
export type VoiceSession = z.infer<typeof voiceSessionSchema>
export type VoiceResponse = z.infer<typeof voiceResponseSchema>

export interface VoiceCaptureHandle {
    stop(): void
    dispose(): void
}

export interface VoiceCaptureDriver {
    getAvailability(): Promise<VoiceAvailability> | VoiceAvailability
    start(request: VoiceStartRequest, onEvent: (event: VoiceSourceEvent) => void): VoiceCaptureHandle
}
