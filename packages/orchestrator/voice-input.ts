import {
    voiceContractVersion, voiceLimits, voiceRequestSchema, voiceResponseSchema,
    voiceSourceEventSchema, type VoiceCaptureDriver, type VoiceCaptureHandle,
    type VoiceErrorCode, type VoiceResponse, type VoiceSession, type VoiceSourceEvent
} from '../common/contracts/voice.js'

export class SharedVoiceInputHost {
    private session: VoiceSession | undefined
    private capture: VoiceCaptureHandle | undefined
    private watchdog: ReturnType<typeof setTimeout> | undefined
    private finalization: ReturnType<typeof setTimeout> | undefined
    private generation = 0
    private lastSequence = -1

    constructor(private readonly driver: VoiceCaptureDriver, private readonly canStart: () => boolean = () => true) { }

    async invoke(rawRequest: unknown): Promise<VoiceResponse> {
        const request = voiceRequestSchema.parse(rawRequest)
        if (request.operation === 'availability') {
            return voiceResponseSchema.parse({
                contractVersion: voiceContractVersion, kind: 'availability',
                availability: await this.driver.getAvailability()
            })
        }
        if (request.operation === 'start') {
            if (this.session && ['arming', 'listening', 'finalizing'].includes(this.session.status)) {
                throw new Error('A voice session is already active.')
            }
            const generation = ++this.generation
            this.lastSequence = -1
            this.session = {
                contractVersion: voiceContractVersion, kind: 'session',
                sessionId: request.sessionId, status: 'arming', segments: [], message: ''
            }
            const availability = await this.driver.getAvailability()
            if (generation !== this.generation) throw new Error('Voice activation was cancelled.')
            if (this.session.status !== 'arming') return voiceResponseSchema.parse(this.session)
            if (!availability.available) {
                this.fail('provider-error', availability.message)
                return voiceResponseSchema.parse(this.session)
            }
            if (!this.canStart()) {
                this.fail('cancelled', 'Voice capture requires the active visible TLC window.')
                return voiceResponseSchema.parse(this.session)
            }
            this.watchdog = setTimeout(() => this.cancel(), voiceLimits.maxAudioMs + 30_000)
            try {
                const capture = this.driver.start(request, (event) => {
                    if (generation === this.generation) this.receive(event)
                })
                if (generation === this.generation && ['arming', 'listening', 'finalizing'].includes(this.session.status)) {
                    this.capture = capture
                } else capture.dispose()
            } catch {
                this.receive({
                    contractVersion: voiceContractVersion, type: 'error',
                    code: 'provider-error', message: 'The offline speech engine could not start.'
                })
            }
        } else {
            if (!this.session || this.session.sessionId !== request.sessionId) {
                throw new Error('The voice session is not available.')
            }
            if (request.operation === 'stop') this.stop()
            if (request.operation === 'cancel') this.cancel()
        }
        return voiceResponseSchema.parse(this.session)
    }

    private receive(rawEvent: VoiceSourceEvent): void {
        const session = this.session
        if (!session || !['arming', 'listening', 'finalizing'].includes(session.status)) return
        const parsed = voiceSourceEventSchema.safeParse(rawEvent)
        if (!parsed.success) {
            this.fail('provider-error', 'The speech engine returned an invalid event.')
            return
        }
        const event = parsed.data
        if (event.type === 'started' && session.status === 'arming') session.status = 'listening'
        if (event.type === 'segment') {
            const segment = event.segment
            if (segment.sequence <= this.lastSequence) return
            this.lastSequence = segment.sequence
            const previous = session.segments.find((item) => item.id === segment.id)
            if (previous?.isFinal) return
            const segments = previous
                ? session.segments.map((item) => item.id === segment.id ? segment : item)
                : [...session.segments, segment]
            if (segments.length > voiceLimits.maxSegments ||
                segments.map((item) => item.text).join(' ').length > voiceLimits.maxTranscriptChars) {
                session.message = 'Voice input limit reached. The latest speech was not accepted.'
                this.stop()
            } else session.segments = segments
        }
        if (event.type === 'ended') {
            session.status = 'ended'
            this.release()
        }
        if (event.type === 'error') this.fail(event.code, event.message)
    }

    private fail(code: VoiceErrorCode, message: string): void {
        if (this.session) {
            this.session.status = 'error'
            this.session.errorCode = code
            this.session.message = message
            this.session.segments = []
        }
        this.release()
    }

    private stop(): void {
        if (!this.session || !['arming', 'listening'].includes(this.session.status)) return
        this.session.status = 'finalizing'
        this.finalization = setTimeout(() => {
            if (this.session?.status === 'finalizing') {
                this.session.status = 'ended'
                this.session.message ||= 'Unconfirmed trailing speech was not inserted.'
                this.release()
            }
        }, voiceLimits.finalizationMs)
        this.capture?.stop()
    }

    cancel(): void {
        ++this.generation
        if (this.session && ['arming', 'listening', 'finalizing'].includes(this.session.status)) {
            this.session.status = 'cancelled'
            this.session.message = 'Voice input was cancelled.'
        }
        if (this.session) this.session.segments = []
        this.release()
    }

    dispose(): void {
        this.cancel()
        this.session = undefined
    }

    private release(): void {
        clearTimeout(this.watchdog)
        clearTimeout(this.finalization)
        this.watchdog = undefined
        this.finalization = undefined
        const capture = this.capture
        this.capture = undefined
        capture?.dispose()
    }
}

export function createBrowserOnlyVoiceHost(): SharedVoiceInputHost {
    return new SharedVoiceInputHost({
        getAvailability: () => ({
            available: false, reason: 'unsupported-platform',
            message: 'Web voice capture runs on the browser device, never on the server.'
        }),
        start: () => { throw new Error('Server microphone capture is forbidden.') }
    })
}
