import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { actionPreviewSchema } from '../../../../packages/common/contracts/collaboration.js'
import { meetingTranscriptSummarySchema, type MeetingType } from '../../../../packages/common/contracts/meeting.js'
import type { TeamsApiClient, ReviewPreview } from './data-client.js'
import type { WorkingSelection } from './accounts.js'
import { ManualTranscriptInput } from './manual-transcript-input.js'
import { meetingCaptureError, meetingResultSchema, type MeetingResult } from './meeting-capture.js'

export function MeetingsWorkspace({ client, selection, mode, reviewPreview, compact = false, graphAvailable = true }: {
  client: TeamsApiClient; selection: WorkingSelection | null; mode: 'sample' | 'live'; reviewPreview: ReviewPreview
  compact?: boolean; graphAvailable?: boolean
}) {
  const [task, setTask] = useState<'prep' | 'capture' | 'follow-up'>(compact ? 'prep' : 'follow-up')
  const [meetingId, setMeetingId] = useState('')
  const [meetingLink, setMeetingLink] = useState('')
  const [meetingType, setMeetingType] = useState<MeetingType>('customer')
  const [inputMode, setInputMode] = useState<'meeting' | 'manual'>(mode === 'live' && !graphAvailable ? 'manual' : 'meeting')
  const [sources, setSources] = useState<Array<z.infer<typeof meetingTranscriptSummarySchema>>>([])
  const [result, setResult] = useState<MeetingResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  const resolveController = useRef<AbortController | undefined>(undefined)
  function clearDraft() {
    resolveController.current?.abort()
    setResolving(false); setBusy(false); setResult(null); setSelected(new Set()); setReason(''); setError('')
  }
  function acceptResult(loaded: MeetingResult) {
    setResult(loaded)
    setSelected(new Set(loaded.proposals.flatMap((proposal) => proposal.slots.filter((slot) => slot.checkedByDefault && !slot.blocked).map((slot) => slot.slotId))))
  }
  useEffect(() => () => { resolveController.current?.abort() }, [client, selection?.opportunity.id, inputMode, meetingType])
  useEffect(() => {
    clearDraft(); setMeetingId(''); setMeetingLink(''); setSources([])
    if (!selection || mode !== 'sample' || inputMode !== 'meeting') return
    const controller = new AbortController()
    client.request('meetings/sources', z.array(meetingTranscriptSummarySchema), { opportunityId: selection.opportunity.id }, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setSources(items); setMeetingId(items[0]?.id ?? '')
        if (items[0]) setMeetingType(items[0].meetingType)
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(meetingCaptureError(cause)) })
    return () => controller.abort()
  }, [client, selection?.opportunity.id, mode, inputMode])
  useEffect(() => {
    if (!meetingId || !selection || inputMode !== 'meeting' || mode === 'live' && !graphAvailable) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    async function acquire() {
      setBusy(true)
      try {
        const loaded = await client.request('meetings/acquire', meetingResultSchema, {
          meetingId, opportunityId: selection!.opportunity.id, meetingType
        }, controller.signal)
        if (controller.signal.aborted) return
        acceptResult(loaded)
        if (loaded.status.state === 'waiting' && ++attempts < 10) timer = setTimeout(() => { void acquire() }, 2000)
      } catch (cause) { if (!controller.signal.aborted) setError(meetingCaptureError(cause)) }
      finally { if (!controller.signal.aborted) setBusy(false) }
    }
    void acquire()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [client, meetingId, meetingType, selection?.opportunity.id, inputMode, mode, graphAvailable])
  async function resolve() {
    if (resolving || busy) return
    clearDraft()
    setMeetingId('')
    const controller = new AbortController()
    resolveController.current = controller
    setResolving(true)
    try {
      if (!meetingLink.trim().startsWith('https://')) throw new Error('Paste the HTTPS Teams meeting join link to verify its Graph identity.')
      const resolved = await client.request('meetings/resolve', z.object({ meetingId: z.string().min(1) }).strict(), { joinUrl: meetingLink.trim() }, controller.signal)
      if (!controller.signal.aborted) setMeetingId(resolved.meetingId)
    } catch (cause) { if (!controller.signal.aborted) setError(meetingCaptureError(cause)) }
    finally { if (!controller.signal.aborted) setResolving(false) }
  }
  async function review() {
    if (!result) return
    setError('')
    try {
      for (const proposal of result.proposals) {
        const slots = proposal.slots.filter((slot) => selected.has(slot.slotId) && !slot.blocked)
        if (!slots.length) continue
        const preview = await client.request('meetings/preview-changes', actionPreviewSchema, {
          acquisitionId: result.status.id,
          approval: {
            changeSetId: proposal.changeSetId, opportunityId: proposal.opportunityId,
            approvedSlotIds: slots.map((slot) => slot.slotId), approvedNewMilestoneTempIds: [],
            selectedMilestoneIds: [...new Set(slots.flatMap((slot) => slot.targetRecordId ? [slot.targetRecordId] : []))], reason
          }
        })
        const receipt = await reviewPreview(preview)
        if (receipt.state !== 'confirmed') throw new Error('The source outcome is unconfirmed. Do not repeat it; open Activity.')
      }
      setSelected(new Set())
    } catch (cause) { setError(meetingCaptureError(cause)) }
  }
  return <section className={`panel meeting-workspace${compact ? ' meeting-panel' : ''}`}><h1>Meeting preparation and follow-up</h1>
    <nav className="detail-tabs" role="tablist" aria-label="Meeting tasks">
      {(['prep', 'capture', 'follow-up'] as const).map((item, index, items) => <button key={item} type="button" role="tab"
        id={`meeting-tab-${item}`} aria-controls={`meeting-${item}`} aria-selected={task === item} tabIndex={task === item ? 0 : -1}
        onClick={() => setTask(item)} onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? items[(index + 1) % items.length] : event.key === 'ArrowLeft' ? items[(index + items.length - 1) % items.length] : undefined
          if (next) { event.preventDefault(); setTask(next); document.getElementById(`meeting-tab-${next}`)?.focus() }
        }}>{item === 'prep' ? 'Prep' : item === 'capture' ? 'Capture' : 'Follow-up'}</button>)}
    </nav>
    {!selection ? <p>Choose an account and opportunity in Portfolio first.</p> : <>
      <h2>{selection.opportunity.name}</h2>
      <p className="muted">Private working view. Being signed into Teams does not grant transcript or MSX access.</p>
      <section id="meeting-prep" role="tabpanel" aria-labelledby="meeting-tab-prep" hidden={task !== 'prep'}>
        <h3>Meeting preparation</h3><p>{selection.account.name} - Recorded stage {selection.opportunity.recordedStage}</p>
        <p>Use the authorized transcript as evidence. Proposed changes remain private until reviewed.</p>
        <button type="button" onClick={() => setTask('capture')}>Open capture</button>
      </section>
      <section id="meeting-capture" role="tabpanel" aria-labelledby="meeting-tab-capture" hidden={task !== 'capture'}>
      <label className="field">Meeting classification<select aria-label="Meeting classification" value={meetingType} onChange={(event) => {
        clearDraft()
        setMeetingType(event.target.value === 'internal' ? 'internal' : 'customer')
      }}>
        <option value="customer">Customer meeting</option><option value="internal">Internal meeting</option>
      </select></label>
      <div className="detail-tabs" role="group" aria-label="Transcript input">
        <button type="button" aria-pressed={inputMode === 'meeting'} onClick={() => { clearDraft(); setMeetingId(''); setInputMode('meeting') }}>Teams meeting</button>
        <button type="button" aria-pressed={inputMode === 'manual'} onClick={() => { clearDraft(); setMeetingId(''); setInputMode('manual') }}>Paste / upload</button>
      </div>
      {inputMode === 'manual' ? <ManualTranscriptInput key={selection.opportunity.id} client={client} opportunityId={selection.opportunity.id}
        meetingType={meetingType} onDraftChange={clearDraft} onReady={(loaded) => { acceptResult(loaded); if (loaded.status.state === 'ready') setTask('follow-up') }} />
        : mode === 'sample' ? <label className="field">Bundled sample transcript<select value={meetingId} onChange={(event) => { clearDraft(); setMeetingId(event.target.value) }}>
        <option value="">Choose a bundled transcript</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.subject}</option>)}
      </select></label> : <div>
        {!graphAvailable && <p role="status" className="warning">Automatic meeting-link lookup is unavailable in this Azure CLI profile. Use Paste / upload with a transcript you are authorized to provide, or a separately approved Graph-enabled profile.</p>}
        <label className="field">Teams meeting join link<input type="url" value={meetingLink} disabled={!graphAvailable || resolving || busy} onChange={(event) => {
          clearDraft(); setMeetingId(''); setMeetingLink(event.target.value)
        }} /></label>
        <button type="button" disabled={!graphAvailable || resolving || busy || !meetingLink.trim()} onClick={() => { void resolve() }}>{resolving ? 'Verifying meeting...' : 'Verify meeting and acquire transcript'}</button>
      </div>}
      {busy && <p role="status">Acquiring authorized transcript evidence...</p>}
      {task === 'capture' && result && <p role="status" className={result.status.state === 'ready' ? 'success-banner' : 'warning'}>{result.status.detail} ({result.status.attribution})</p>}
      {result?.subscription && <p className={result.subscription.state === 'active' ? 'muted' : 'warning'}>{result.subscription.detail}</p>}
      {result?.subscription?.state === 'active' && selection && <button type="button" onClick={() => {
        void client.request('meetings/unsubscribe', z.object({ state: z.enum(['active', 'unconfirmed', 'foreground-only']), detail: z.string() }), {
          meetingId, opportunityId: selection.opportunity.id, meetingType
        }).then((subscription) => setResult((current) => current ? { ...current, subscription } : current)).catch((cause: unknown) => setError(meetingCaptureError(cause)))
      }}>Stop background transcript acquisition</button>}
      </section>
      {task !== 'capture' && result && <p role="status" className={result.status.state === 'ready' ? 'success-banner' : 'warning'}>{result.status.detail} ({result.status.attribution})</p>}
      <section id="meeting-follow-up" role="tabpanel" aria-labelledby="meeting-tab-follow-up" hidden={task !== 'follow-up'}>
      {result?.status.state === 'ready' ? <div>
        <h2>Proposed meeting changes</h2><p>Evidence is {result.status.attribution}. These suggestions have not been applied.</p>
        {result.proposals.map((proposal) => <section key={proposal.changeSetId}>
          {proposal.slots.map((slot) => <label key={slot.slotId} className="meeting-change">
            <input type="checkbox" checked={selected.has(slot.slotId)} disabled={slot.blocked} onChange={(event) => setSelected((current) => {
              const next = new Set(current); if (event.target.checked) next.add(slot.slotId); else next.delete(slot.slotId); return next
            })} />
            <span><strong>{slot.label}</strong><span>{slot.displayBefore ?? '(not recorded)'} → {slot.displayAfter}</span><small>{slot.blockedReason ?? slot.rationale}</small><small>Evidence: {slot.evidence.join(', ')}</small></span>
          </label>)}
          {!proposal.slots.length && <p>No supported field changes were grounded in this transcript.</p>}
          {proposal.newMilestones.length > 0 && <p>Recommended next steps: {proposal.newMilestones.map((item) => item.name).join('; ')}. New live milestone creation remains disabled.</p>}
        </section>)}
        <label className="field">Meeting change reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></label>
        <button type="button" className="primary" disabled={!selected.size || reason.trim().length < 3} onClick={() => { void review() }}>Review selected meeting changes</button>
      </div> : <p>No acquired transcript proposal is ready. Check Capture for source status.</p>}
      </section>
    </>}
    {error && <p role="alert" className="error-banner">{error}</p>}
  </section>
}
