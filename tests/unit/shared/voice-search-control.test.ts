import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VoiceSearchControl } from '../../../apps/shared/voice-search-control.js'
import { initialVoiceState } from '../../../apps/shared/voice-input.js'
import type { VoiceDictation } from '../../../apps/shared/use-voice-dictation.js'

function control(active = false, consentOpen = false): VoiceDictation {
    return {
        active, consentOpen, checking: false,
        state: active ? { phase: 'listening', preview: 'grid', message: 'Listening.' } : initialVoiceState,
        toggle: vi.fn(async () => undefined), begin: vi.fn(), cancel: vi.fn(), dismiss: vi.fn(),
        change: vi.fn(), selected: vi.fn(), blurred: vi.fn()
    }
}

describe('shared voice search control', () => {
    it('is a non-submit microphone button with an explicit equivalent shortcut', () => {
        const html = renderToStaticMarkup(createElement(VoiceSearchControl, { voice: control() }))
        expect(html).toContain('type="button"')
        expect(html).toContain('aria-label="Start voice search"')
        expect(html).toContain('aria-keyshortcuts="Control+Alt+M"')
        expect(html).toContain('aria-pressed="false"')
    })

    it('renders accessible capture status and separate preview without per-word live announcements', () => {
        const html = renderToStaticMarkup(createElement(VoiceSearchControl, { voice: control(true) }))
        expect(html).toContain('aria-label="Stop voice search"')
        expect(html).toContain('aria-pressed="true"')
        expect(html).toContain('role="status">Listening.')
        expect(html).toContain('aria-label="Voice transcript preview">grid')
        expect(html).not.toContain('aria-live="assertive"')
    })

    it('discloses local processing and requires an explicit start gesture', () => {
        const html = renderToStaticMarkup(createElement(VoiceSearchControl, { voice: control(false, true) }))
        expect(html).toContain('role="dialog"')
        expect(html).toContain('processed on this device')
        expect(html).toContain('Start listening')
        expect(html).not.toContain('type="submit"')
    })
})
