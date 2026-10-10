import {
    voiceLimits, type VoiceAvailability, type VoiceSegment, type VoiceSourceEvent
} from '../../packages/common/contracts/voice.js'

export interface VoiceSessionHandle {
    stop(): void
    dispose(): void
}

export interface VoiceProvider {
    getAvailability(): Promise<VoiceAvailability> | VoiceAvailability
    start(options: {
        sessionId: string
        hints: string[]
        onEvent(event: VoiceSourceEvent): void
    }): VoiceSessionHandle
}

export interface VoiceSelection {
    value: string
    start: number
    end: number
}

export interface VoiceState {
    phase: 'idle' | 'arming' | 'listening' | 'finalizing' | 'error'
    preview: string
    message: string
}

export const initialVoiceState: VoiceState = { phase: 'idle', preview: '', message: '' }

export class VoiceInputSession {
    private state: VoiceState = initialVoiceState
    private selection: VoiceSelection | undefined
    private handle: VoiceSessionHandle | undefined
    private generation = 0
    private lastSequence = -1
    private segments = new Map<string, VoiceSegment>()
    private duration: ReturnType<typeof setTimeout> | undefined
    private silence: ReturnType<typeof setTimeout> | undefined
    private finalization: ReturnType<typeof setTimeout> | undefined

    constructor(
        private readonly provider: VoiceProvider,
        private readonly onState: (state: VoiceState) => void,
        private readonly onCommit: (value: string, caret: number) => void
    ) { }

    get active(): boolean {
        return ['arming', 'listening', 'finalizing'].includes(this.state.phase)
    }

    get originalValue(): string | undefined { return this.selection?.value }

    start(selection: VoiceSelection, hints: string[] = []): void {
        if (this.active) return
        if (selection.start < 0 || selection.end < selection.start || selection.end > selection.value.length) {
            this.notify({ phase: 'error', preview: '', message: 'The search selection is invalid.' })
            return
        }
        const generation = ++this.generation
        this.selection = selection
        this.lastSequence = -1
        this.segments.clear()
        this.notify({ phase: 'arming', preview: '', message: 'Preparing offline voice input...' })
        try {
            const handle = this.provider.start({
                sessionId: crypto.randomUUID(), hints,
                onEvent: (event) => {
                    if (generation === this.generation && this.active) this.receive(event)
                }
            })
            if (generation === this.generation && this.active) this.handle = handle
            else handle.dispose()
        } catch {
            this.fail('The offline speech provider could not start.')
        }
    }

    private receive(event: VoiceSourceEvent): void {
        if (event.type === 'started' && this.state.phase === 'arming') {
            this.notify({ ...this.state, phase: 'listening', message: 'Listening. Stop to review; Escape cancels.' })
            this.duration = setTimeout(() => this.stop('The 30-second voice limit was reached.'), voiceLimits.maxAudioMs)
            this.renewSilence()
        } else if (event.type === 'segment') {
            const segment = event.segment
            if (segment.sequence <= this.lastSequence) return
            this.lastSequence = segment.sequence
            if (this.segments.get(segment.id)?.isFinal) return
            const next = new Map(this.segments)
            next.set(segment.id, segment)
            const preview = [...next.values()].map((item) => item.text).join(' ')
            if (next.size > voiceLimits.maxSegments || preview.length > voiceLimits.maxTranscriptChars) {
                this.stop('Voice input limit reached. The latest speech was not accepted.')
                return
            }
            this.segments = next
            this.notify({ ...this.state, preview })
            if (this.state.phase === 'listening' && segment.text.trim()) this.renewSilence()
        } else if (event.type === 'ended') this.finish()
        else if (event.type === 'error') this.fail(event.message)
    }

    private renewSilence(): void {
        clearTimeout(this.silence)
        this.silence = setTimeout(() => this.stop('No speech was received for 10 seconds.'), voiceLimits.silenceMs)
    }

    stop(message = 'Finalizing voice input...'): void {
        if (!this.active || this.state.phase === 'finalizing') return
        clearTimeout(this.duration)
        clearTimeout(this.silence)
        this.notify({ ...this.state, phase: 'finalizing', message })
        this.finalization = setTimeout(() => this.finish(true), voiceLimits.finalizationMs)
        this.handle?.stop()
    }

    private finish(deadline = false): void {
        const selection = this.selection
        const transcript = [...this.segments.values()].filter((item) => item.isFinal).map((item) => item.text).join(' ').trim()
        const unconfirmed = [...this.segments.values()].some((item) => !item.isFinal && item.text.trim())
        let message = this.state.message
        if (!message || message.startsWith('Listening.') || message.startsWith('Preparing ') || message === 'Finalizing voice input...') {
            message = transcript ? 'Voice text inserted. Review it, then press Enter or select a result.' : 'No finalized speech was received. The search text is unchanged.'
        }
        if (unconfirmed || deadline) message += ' Unconfirmed trailing speech was not inserted.'
        this.release()
        this.selection = undefined
        this.notify({ phase: 'idle', preview: '', message })
        if (selection && transcript) {
            this.onCommit(
                selection.value.slice(0, selection.start) + transcript + selection.value.slice(selection.end),
                selection.start + transcript.length
            )
        }
    }

    cancel(message = 'Voice input cancelled. The search text is unchanged.'): void {
        const active = this.active
        this.release()
        this.selection = undefined
        this.segments.clear()
        if (active) this.notify({ phase: 'idle', preview: '', message })
    }

    private fail(message: string): void {
        this.release()
        this.selection = undefined
        this.segments.clear()
        this.notify({ phase: 'error', preview: '', message })
    }

    private release(): void {
        ++this.generation
        clearTimeout(this.duration)
        clearTimeout(this.silence)
        clearTimeout(this.finalization)
        const handle = this.handle
        this.handle = undefined
        this.segments.clear()
        handle?.dispose()
    }

    private notify(state: VoiceState): void {
        this.state = state
        this.onState(state)
    }
}
