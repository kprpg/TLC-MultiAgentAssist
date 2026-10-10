import { createPortal } from 'react-dom'
import type { VoiceDictation } from './use-voice-dictation.js'
import './voice-search.css'

export function VoiceSearchControl({ voice }: { voice: VoiceDictation }) {
    const active = voice.active
    const panel = active || voice.consentOpen
    return <span className="voice-search-control">
        <button
            className="voice-search-button"
            type="button"
            aria-label={active ? 'Stop voice search' : 'Start voice search'}
            title={`${active ? 'Stop' : 'Start'} voice search (Ctrl+Alt+M)`}
            aria-keyshortcuts="Control+Alt+M"
            aria-pressed={active}
            disabled={voice.checking}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void voice.toggle()}
        >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                {active ? <rect x="6" y="6" width="12" height="12" /> : <>
                    <rect x="9" y="3" width="6" height="12" rx="3" />
                    <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
                </>}
            </svg>
        </button>
        {panel && <div className="voice-search-panel" role={voice.consentOpen ? 'dialog' : undefined} aria-label="Voice search">
            {voice.consentOpen ? <>
                <strong>Offline voice search</strong>
                <p>Speech is processed on this device. Audio is not uploaded or saved. Review the inserted text before selecting a result.</p>
                <button type="button" onClick={voice.begin}>Start listening</button>
                <button type="button" onClick={voice.cancel}>Cancel</button>
            </> : <>
                <p role="status">{voice.state.message}</p>
                {voice.state.preview && <p className="voice-search-preview" aria-label="Voice transcript preview">{voice.state.preview}</p>}
                <button type="button" onClick={voice.cancel}>Cancel voice input</button>
            </>}
        </div>}
        {!panel && voice.state.message && typeof document !== 'undefined' && createPortal(
            <aside className="voice-search-notice" role={voice.state.phase === 'error' ? 'alert' : 'status'} aria-label="Voice search status">
                <span>{voice.state.message}</span>
                <button type="button" aria-label="Dismiss voice search status" onClick={voice.dismiss}>Dismiss</button>
            </aside>, document.body
        )}
    </span>
}
