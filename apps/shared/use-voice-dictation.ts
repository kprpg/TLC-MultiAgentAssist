import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { VoiceInputSession, initialVoiceState, type VoiceProvider, type VoiceSelection } from './voice-input.js'

export function useVoiceDictation(options: {
    input: RefObject<HTMLInputElement | null>
    form: RefObject<HTMLFormElement | null>
    value: string
    onChange(value: string): void
    provider: VoiceProvider
    hints: string[]
    contextKey: string
}) {
    const [state, setState] = useState(initialVoiceState)
    const [consentOpen, setConsentOpen] = useState(false)
    const [checking, setChecking] = useState(false)
    const current = useRef(options)
    current.current = options
    const generation = useRef(0)
    const consent = useRef(false)
    const selection = useRef<VoiceSelection | undefined>(undefined)
    const restoringSelection = useRef(false)
    const session = useMemo(() => new VoiceInputSession(options.provider, setState, (value, caret) => {
        current.current.onChange(value)
        restoringSelection.current = true
        requestAnimationFrame(() => {
            const input = current.current.input.current
            if (input && input.value === value) {
                input.focus()
                input.setSelectionRange(caret, caret)
            }
            restoringSelection.current = false
        })
    }), [options.provider])

    function cancel() {
        ++generation.current
        session.cancel()
        setConsentOpen(false)
        setChecking(false)
    }

    function visible() {
        const input = current.current.input.current
        return document.visibilityState === 'visible' && input !== null && input.getClientRects().length > 0
    }

    function begin() {
        setConsentOpen(false)
        if (!visible() || !selection.current || selection.current.value !== current.current.value) {
            setState({ phase: 'error', preview: '', message: 'Voice search target changed or is hidden. Activate the visible search again.' })
            return
        }
        consent.current = true
        restoringSelection.current = true
        current.current.input.current?.focus()
        queueMicrotask(() => { restoringSelection.current = false })
        session.start(selection.current, current.current.hints)
    }

    async function toggle() {
        if (session.active) { session.stop(); return }
        if (checking) return
        if (consentOpen) { cancel(); return }
        if (!visible()) {
            setState({ phase: 'error', preview: '', message: 'Voice search is unavailable while the search field is hidden.' })
            return
        }
        const input = current.current.input.current
        const value = current.current.value
        selection.current = { value, start: input?.selectionStart ?? value.length, end: input?.selectionEnd ?? value.length }
        const token = ++generation.current
        setChecking(true)
        try {
            const availability = await current.current.provider.getAvailability()
            if (token !== generation.current) return
            if (!availability.available) {
                setState({ phase: 'error', preview: '', message: availability.message })
            } else if (!consent.current) setConsentOpen(true)
            else begin()
        } catch {
            if (token === generation.current) setState({ phase: 'error', preview: '', message: 'The offline voice provider could not be checked.' })
        } finally {
            if (token === generation.current) setChecking(false)
        }
    }

    const actions = useRef({ toggle, cancel, consentOpen, checking })
    actions.current = { toggle, cancel, consentOpen, checking }
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if (event.repeat || event.isComposing || event.getModifierState('AltGraph')) return
            if (event.key === 'Escape' && (session.active || actions.current.consentOpen || actions.current.checking)) {
                event.preventDefault()
                event.stopPropagation()
                actions.current.cancel()
            } else if (event.key.toLowerCase() === 'm' && event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey &&
                document.visibilityState === 'visible' && document.hasFocus()) {
                event.preventDefault()
                event.stopPropagation()
                void actions.current.toggle()
            }
        }
        const leave = () => actions.current.cancel()
        const visibility = () => { if (document.visibilityState !== 'visible') leave() }
        const resized = () => { if (!visible()) leave() }
        window.addEventListener('keydown', keydown, true)
        window.addEventListener('blur', leave)
        window.addEventListener('pagehide', leave)
        window.addEventListener('resize', resized)
        document.addEventListener('visibilitychange', visibility)
        return () => {
            ++generation.current
            session.cancel()
            window.removeEventListener('keydown', keydown, true)
            window.removeEventListener('blur', leave)
            window.removeEventListener('pagehide', leave)
            window.removeEventListener('resize', resized)
            document.removeEventListener('visibilitychange', visibility)
        }
    }, [session])

    useEffect(() => { actions.current.cancel() }, [options.contextKey])
    useEffect(() => {
        if (session.active && session.originalValue !== options.value) actions.current.cancel()
    }, [session, options.value])

    return {
        state, consentOpen, checking,
        get active() { return session.active },
        toggle, begin, cancel,
        dismiss: () => setState(initialVoiceState),
        change(value: string) {
            cancel()
            current.current.onChange(value)
        },
        selected() {
            const input = current.current.input.current
            if (session.active && !restoringSelection.current &&
                (input?.selectionStart !== selection.current?.start || input?.selectionEnd !== selection.current?.end)) cancel()
        },
        blurred(relatedTarget: EventTarget | null) {
            if (!(relatedTarget instanceof Node) || !current.current.form.current?.contains(relatedTarget)) cancel()
        }
    }
}

export type VoiceDictation = ReturnType<typeof useVoiceDictation>
