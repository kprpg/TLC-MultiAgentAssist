import { describe, expect, it } from 'vitest'
import { voiceContractVersion, voiceRequestSchema, voiceResponseSchema, voiceSourceEventSchema } from '../../packages/common/contracts/voice.js'

const sessionId = '11111111-1111-4111-8111-111111111111'
const request = { contractVersion: voiceContractVersion, operation: 'start', sessionId, locale: 'en-US', consent: true, hints: ['Grid operations'] }

describe('voice contract v1', () => {
    it('requires a version, explicit consent, bounded hints and a correlated session', () => {
        expect(voiceRequestSchema.parse(request)).toEqual(request)
        for (const invalid of [
            { ...request, contractVersion: '2.0' }, { ...request, consent: false },
            { ...request, sessionId: 'invalid' }, { ...request, locale: 'fr-FR' },
            { ...request, hints: Array(65).fill('Grid') },
            { ...request, hints: ['x'.repeat(201)] },
            { ...request, inputFile: 'private.wav' }
        ]) expect(voiceRequestSchema.safeParse(invalid).success).toBe(false)
    })

    it('strictly validates events and bounded responses without allowing raw audio or credentials', () => {
        expect(voiceSourceEventSchema.safeParse({
            contractVersion: voiceContractVersion, type: 'segment',
            segment: { id: '1', sequence: 1, text: 'grid', isFinal: true }
        }).success).toBe(true)
        expect(voiceSourceEventSchema.safeParse({ contractVersion: voiceContractVersion, type: 'started', token: 'secret' }).success).toBe(false)
        const response = {
            contractVersion: voiceContractVersion, kind: 'session', sessionId, status: 'listening',
            segments: [{ id: '1', sequence: 1, text: 'grid', isFinal: true }], message: ''
        }
        expect(voiceResponseSchema.safeParse(response).success).toBe(true)
        expect(voiceResponseSchema.safeParse({ ...response, audio: 'untrusted' }).success).toBe(false)
        expect(voiceResponseSchema.safeParse({ ...response, segments: [{ ...response.segments[0], text: 'x'.repeat(2001) }] }).success).toBe(false)
    })
})
