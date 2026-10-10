# Voice search

Voice fills the **Search accounts and opportunities** field in Desktop, Web, and
the local Windows VS Code extension. It does not invoke an agent, write records,
or automatically select a result.

## Use it

1. Click **Start voice search** (the microphone), or press **Ctrl+Alt+M** while the
   TLC window/webview has focus.
2. On first use in that view, review the offline-processing disclosure and click
   **Start listening**. A shortcut also requires this initial explicit consent.
3. Say a short English account/opportunity name. Speech appears in a separate
   preview; the search query is unchanged while listening.
4. Click **Stop voice search**, or press **Ctrl+Alt+M** again. Finalized speech is
   inserted at the caret or replaces the selection captured at activation.
5. Review or edit the text, then press **Enter** or select a result normally.

**Escape** or **Cancel voice input** discards uninserted speech. Typing, pasting,
changing the input selection, leaving the search form, switching tabs/scopes,
hiding the view, or leaving the foreground cancels capture. A microphone button
never submits the form. Enter cannot select a result while dictation is active.

Normal search behavior stays unchanged. In VS Code, leaving the form clears the
query as before; Desktop/Web retain it. Desktop/Web do not capture when their
search bar is hidden at narrow widths.

## Prerequisites

| Surface | Speech engine | Requirements |
|---|---|---|
| Desktop | Windows offline `System.Speech` | Windows, Windows PowerShell, English (United States) speech recognition language, accessible microphone |
| VS Code | Same Windows engine in the local UI host | Local Windows VS Code/Insiders; same language/microphone prerequisites |
| Web | Vosk WebAssembly in a dedicated worker | HTTPS or localhost; microphone permission; Web Audio/WebAssembly/Worker support; bundled English model |

Remote VS Code windows deliberately disable voice rather than capture from an
SSH/container/remote extension-host machine. Other extension features still
work. Voice is not implemented in the optional legacy Desktop renderer.

If Windows reports missing language support, install **English (United States)**
speech recognition in Windows language settings. For microphone denial, check
Windows **Privacy & security > Microphone**, including desktop-app access, and
browser site permissions where applicable. Corporate policy can block Windows
PowerShell or microphone access; the UI reports failure and leaves typing usable.

## Privacy and limits

- Recognition is local. No audio is sent to Azure, Google, or another speech
  service, and TLC does not save microphone recordings.
- Audio/model/transcript work uses memory and is released on completion/cancel.
  During browser model warm-up, at most 10 seconds of audio is buffered.
- Portfolio names may be supplied as bounded local recognition vocabulary hints.
  They never leave the local speech engine. Typed matching/ranking stays unchanged.
- Voice works in sample and live data modes independently of enterprise sign-in.
  Loading Web application/model assets from the app's own origin is not a cloud
  speech call. The model is included in the built application.
- Sessions stop after 30 seconds or 10 seconds without recognized speech. Speech
  is bounded to 2,000 characters and 64 segments; the final-result flush is at
  most one second. Overflow/unconfirmed trailing speech is disclosed, not silently
  treated as confirmed. Ordinary typing is not capped by the voice limits.
- Speech recognition can make mistakes, especially names and accents. Always
  review the text; never dictate secrets or rely on confidence alone.

## Build and test

The first `npm run voice:model` downloads the approximately 39 MiB English model
from the public Vosk browser model distribution and verifies its pinned SHA-256.
Subsequent builds reuse the verified local copy. No microphone audio is involved
in this build step. Desktop/Web builds include the model and isolated worker.

The application page retains its no-`unsafe-eval` policy. Only the static
same-origin offline speech worker has the dynamic-code-generation policy required
by the pinned WASM library. Its network access is limited to the app's own origin.

Three sanitized 16 kHz PCM WAV recordings are versioned in
[the voice fixtures](../../tests/fixtures/voice-input/recordings). They were
synthesized with Windows voices, not recorded from a person.

```powershell
# Recreate sanitized recordings; no microphone or cloud speech calls.
powershell.exe -NoProfile -NonInteractive -File .\scripts\create-voice-test-recordings.ps1

# Native production-engine audio tests are opt-in.
$env:TLC_RUN_VOICE_AUDIO_TESTS = '1'
npm test -- tests\unit\connectors\windows-voice.test.ts

# All three UI journeys, including the actual installed VS Code host when present.
npm run test:smoke:revamp
```

Real VS Code tests use an isolated profile/extension directory and substitute only
the audio input with a prerecorded WAV. They do not install into or change your
normal VS Code profile. Override `TLC_VSCODE_EXECUTABLE` to test a different
installed VS Code executable.

See [the retrieved design and implementation notes](../research/Voice-Input-Research-and-Implementation-Plan.md)
for architecture, acceptance criteria, and qualification evidence.
