import { useEffect, useState } from 'react'
import { z } from 'zod'
import { acquisitionSchema, actionPreviewSchema } from '../../../../packages/common/contracts/collaboration.js'
import { meetingChangeSetProposalSchema, meetingTranscriptSummarySchema, type MeetingType } from '../../../../packages/common/contracts/meeting.js'
import type { TeamsApiClient, ReviewPreview } from './data-client.js'
import type { WorkingSelection } from './accounts.js'

const resultSchema = z.object({
  status: acquisitionSchema, proposals: z.array(meetingChangeSetProposalSchema),
  subscription: z.object({ state: z.enum(['active', 'unconfirmed', 'foreground-only']), detail: z.string() }).optional()
}).strict()
type MeetingResult = z.infer<typeof resultSchema>

export function MeetingsWorkspace({ client, selection, mode, reviewPreview }: {
  client: TeamsApiClient; selection: WorkingSelection | null; mode: 'sample' | 'live'; reviewPreview: ReviewPreview
}) {
  const [meetingId, setMeetingId] = useState('')
  const [meetingLink, setMeetingLink] = useState('')
  const [meetingType, setMeetingType] = useState<MeetingType>('customer')
  const [sources, setSources] = useState<Array<z.infer<typeof meetingTranscriptSummarySchema>>>([])
  const [result, setResult] = useState<MeetingResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setResult(null); setMeetingId(''); setError('')
    if (!selection || mode !== 'sample') return
    const controller = new AbortController()
    client.request('meetings/sources', z.array(meetingTranscriptSummarySchema), { opportunityId: selection.opportunity.id }, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setSources(items); setMeetingId(items[0]?.id ?? '')
        if (items[0]) setMeetingType(items[0].meetingType)
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client, selection?.opportunity.id, mode])
  useEffect(() => {
    if (!meetingId || !selection) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    async function acquire() {
      setBusy(true)
      try {
        const loaded = await client.request('meetings/acquire', resultSchema, {
          meetingId, opportunityId: selection!.opportunity.id, meetingType
        }, controller.signal)
        if (controller.signal.aborted) return
        setResult(loaded)
        setSelected(new Set(loaded.proposals.flatMap((proposal) => proposal.slots.filter((slot) => slot.checkedByDefault && !slot.blocked).map((slot) => slot.slotId))))
        if (loaded.status.state === 'waiting' && ++attempts < 10) timer = setTimeout(() => { void acquire() }, 2000)
      } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
      finally { if (!controller.signal.aborted) setBusy(false) }
    }
    void acquire()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [client, meetingId, meetingType, selection?.opportunity.id])
  async function resolve() {
    setError('')
    try {
      if (!meetingLink.startsWith('https://')) throw new Error('Paste the Teams meeting join link to verify its Graph identity.')
      const resolved = await client.request('meetings/resolve', z.object({ meetingId: z.string() }), { joinUrl: meetingLink })
      setMeetingId(resolved.meetingId)
    } catch (cause) { setError(String(cause)) }
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
    } catch (cause) { setError(String(cause)) }
  }
  return <section className="panel"><h1>Meeting preparation and follow-up</h1>
    {!selection ? <p>Choose an account and opportunity in Accounts first.</p> : <>
      <h2>{selection.opportunity.name}</h2>
      <p className="muted">Private working view. Being signed into Teams does not grant transcript or MSX access.</p>
      <label className="field">Meeting classification<select value={meetingType} onChange={(event) => setMeetingType(event.target.value === 'internal' ? 'internal' : 'customer')}>
        <option value="customer">Customer meeting</option><option value="internal">Internal meeting</option>
      </select></label>
      {mode === 'sample' ? <label className="field">Bundled sample transcript<select value={meetingId} onChange={(event) => setMeetingId(event.target.value)}>
        <option value="">Choose a bundled transcript</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.subject}</option>)}
      </select></label> : <div>
        <label className="field">Teams meeting join link<input type="url" value={meetingLink} onChange={(event) => setMeetingLink(event.target.value)} /></label>
        <button type="button" onClick={() => { void resolve() }}>Verify meeting and acquire transcript</button>
      </div>}
      {busy && <p role="status">Acquiring authorized transcript evidence...</p>}
      {result && <p role="status" className={result.status.state === 'ready' ? 'success-banner' : 'warning'}>{result.status.detail} ({result.status.attribution})</p>}
      {result?.subscription && <p className={result.subscription.state === 'active' ? 'muted' : 'warning'}>{result.subscription.detail}</p>}
      {result?.subscription?.state === 'active' && selection && <button type="button" onClick={() => {
        void client.request('meetings/unsubscribe', z.object({ state: z.enum(['active', 'unconfirmed', 'foreground-only']), detail: z.string() }), {
          meetingId, opportunityId: selection.opportunity.id, meetingType
        }).then((subscription) => setResult((current) => current ? { ...current, subscription } : current)).catch((cause: unknown) => setError(String(cause)))
      }}>Stop background transcript acquisition</button>}
      {result?.status.state === 'ready' && <div>
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
      </div>}
    </>}
    {error && <p role="alert" className="error-banner">{error}</p>}
  </section>
}
