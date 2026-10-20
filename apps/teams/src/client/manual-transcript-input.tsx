import { useEffect, useRef, useState } from 'react'
import {
  manualMeetingTranscriptRequestSchema, manualMeetingTranscriptVersion, transcriptMaximumCharacters, type MeetingType
} from '../../../../packages/common/contracts/meeting.js'
import { readTranscriptFile, transcriptFileAccept } from '../../../shared/transcript-file.js'
import type { TeamsApiClient } from './data-client.js'
import { meetingCaptureError, meetingResultSchema, type MeetingResult } from './meeting-capture.js'

export function ManualTranscriptInput({ client, opportunityId, meetingType, onReady, onDraftChange }: {
  client: TeamsApiClient; opportunityId: string; meetingType: MeetingType
  onReady(result: MeetingResult): void; onDraftChange(): void
}) {
  const [content, setContent] = useState('')
  const [source, setSource] = useState<'paste' | 'upload'>('paste')
  const [format, setFormat] = useState<'vtt' | 'text'>()
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const version = useRef(0)
  const controller = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    version.current++
    controller.current?.abort()
    setBusy(false); setError('')
    return () => { version.current++; controller.current?.abort() }
  }, [client, opportunityId, meetingType])

  async function loadFile(file: File) {
    const request = ++version.current
    controller.current?.abort()
    onDraftChange()
    setBusy(true); setError(''); setContent(''); setFileName(''); setFormat(undefined)
    try {
      const loaded = await readTranscriptFile(file)
      if (version.current !== request) return
      setContent(loaded.content); setFormat(loaded.format); setSource('upload'); setFileName(file.name)
    } catch (cause) { if (version.current === request) setError(meetingCaptureError(cause)) }
    finally { if (version.current === request) setBusy(false) }
  }

  async function extract() {
    const input = manualMeetingTranscriptRequestSchema.safeParse({
      contractVersion: manualMeetingTranscriptVersion, opportunityId, meetingType, source, content,
      ...(format ? { format } : {})
    })
    if (!input.success) { setError(input.error.issues[0]?.message ?? 'Check the transcript input.'); return }
    const request = ++version.current
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    onDraftChange()
    setBusy(true); setError('')
    try {
      const result = await client.request('meetings/manual', meetingResultSchema, input.data, active.signal)
      if (version.current === request && !active.signal.aborted) onReady(result)
    } catch (cause) { if (version.current === request && !active.signal.aborted) setError(meetingCaptureError(cause)) }
    finally { if (version.current === request && !active.signal.aborted) setBusy(false) }
  }

  return <section aria-label="Paste or upload transcript">
    <p>Paste a transcript or choose a UTF-8 WebVTT (.vtt) / text (.txt) file you are authorized to use. Manual input does not verify a Graph meeting or speaker identity.</p>
    <label className="field">Transcript file<input type="file" accept={transcriptFileAccept} disabled={busy} onChange={(event) => {
      const file = event.target.files?.[0]
      if (file) void loadFile(file)
      event.target.value = ''
    }} /></label>
    {fileName && <p className="muted">Loaded file: {fileName}</p>}
    <label className="field">Transcript text<textarea rows={8} value={content} disabled={busy} maxLength={transcriptMaximumCharacters}
      placeholder="Paste a Teams WebVTT transcript or Speaker: text lines..."
      onChange={(event) => {
        version.current++; controller.current?.abort()
        onDraftChange()
        setContent(event.target.value); setSource('paste'); setFormat(undefined); setFileName(''); setError('')
      }} /></label>
    <p className="muted">Up to 150,000 characters, 500 KiB and 2,000 segments. Extraction creates private suggestions only; source changes require separate review and approval.</p>
    <button type="button" className="primary" disabled={busy || content.trim().length < 11} onClick={() => { void extract() }}>
      {busy ? 'Reading transcript...' : 'Extract & Review'}
    </button>
    {busy && <p role="status">Reading the supplied transcript. No source changes are being applied.</p>}
    {error && <p role="alert" className="error-banner">{error}</p>}
  </section>
}
