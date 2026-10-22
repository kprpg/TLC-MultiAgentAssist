import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import * as c from '../../../../packages/common/contracts/index.js'
import type { TeamsApiClient } from './data-client.js'
import type { WorkingSelection } from './accounts.js'
import { usePresentationSession } from '../../../shared/presentation-hooks.js'

type RecordAction = (operation: string, input: Record<string, unknown>) => Promise<void>

export function OpportunityCommentsEditor({ opportunity, onAction, onDraftChange, label = 'Opportunity notes' }: {
  opportunity: c.Opportunity; onAction: RecordAction; onDraftChange(): void; label?: string
}) {
  const [comments, setComments] = useState(opportunity.comments ?? '')
  const sourceComments = useRef(opportunity.comments ?? '')
  useEffect(() => {
    const previous = sourceComments.current
    const next = opportunity.comments ?? ''
    sourceComments.current = next
    setComments((current) => current === previous ? next : current)
  }, [opportunity.id, opportunity.comments])
  return <>
    <label className="field">{label}<textarea data-draft-opportunity-id={opportunity.id} data-draft-field="comments" aria-label={label} value={comments} maxLength={30_000} onChange={(event) => {
      setComments(event.target.value); onDraftChange()
    }} /></label>
    <button type="button" onClick={() => { void onAction('updateOpportunity', { opportunityId: opportunity.id, update: { comments } }) }}>Review opportunity update</button>
  </>
}

function MilestoneActivities({ client, milestone }: { client: TeamsApiClient; milestone: c.Milestone }) {
  const [activities, setActivities] = useState<c.MilestoneActivity[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  usePresentationSession(client, [`activities:${milestone.opportunityId}:${milestone.id}`], {
    onError: (cause) => setError(String(cause)),
    onReset: () => { setActivities([]); setError('Source access changed.') },
    onChanged: async () => {
      if (client.cacheSession.cache.has(`activities:${milestone.opportunityId}:${milestone.id}`)) {
        setActivities(await client.operation('listMilestoneActivities', { opportunityId: milestone.opportunityId, milestoneId: milestone.id }, z.array(c.milestoneActivitySchema)))
      }
    }
  })
  useEffect(() => {
    const controller = new AbortController()
    client.operation('listMilestoneActivities', { opportunityId: milestone.opportunityId, milestoneId: milestone.id }, z.array(c.milestoneActivitySchema), controller.signal)
      .then((items) => { if (!controller.signal.aborted) { setActivities(items); setLoading(false) } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setError(String(cause)); setLoading(false) } })
    return () => controller.abort()
  }, [client, milestone.id, milestone.opportunityId])
  return <div>{loading && <p role="status">Loading milestone activities...</p>}
    {error && <p role="alert">{error}</p>}
    <ul>{activities.map((item) => <li key={item.id}>{item.subject} - {item.status}{item.owner ? ` - ${item.owner}` : ''}</li>)}</ul>
    {!loading && !error && !activities.length && <p>No activities are visible for this milestone.</p>}
  </div>
}

export function MilestoneCard({ client, milestone, onAction }: { client: TeamsApiClient; milestone: c.Milestone; onAction: RecordAction }) {
  const [status, setStatus] = useState(milestone.status)
  const [subject, setSubject] = useState('')
  const [risk, setRisk] = useState(milestone.riskDetails ?? '')
  const [commitment, setCommitment] = useState(milestone.commitment ?? '')
  const [date, setDate] = useState(milestone.targetDate ?? '')
  const [comments, setComments] = useState(milestone.comments ?? '')
  const [showActivities, setShowActivities] = useState(false)
  const source = useRef(milestone)
  useEffect(() => {
    const previous = source.current
    source.current = milestone
    setStatus((value) => value === previous.status ? milestone.status : value)
    setRisk((value) => value === (previous.riskDetails ?? '') ? milestone.riskDetails ?? '' : value)
    setCommitment((value) => value === (previous.commitment ?? '') ? milestone.commitment ?? '' : value)
    setDate((value) => value === (previous.targetDate ?? '') ? milestone.targetDate ?? '' : value)
    setComments((value) => value === (previous.comments ?? '') ? milestone.comments ?? '' : value)
  }, [milestone])
  const changes = {
    ...(status !== milestone.status ? { status } : {}),
    ...(risk !== (milestone.riskDetails ?? '') ? { riskDetails: risk } : {}),
    ...(commitment && commitment !== milestone.commitment ? { customerCommitment: commitment } : {}),
    ...(date && date !== milestone.targetDate ? { targetDate: date } : {}),
    ...(comments !== (milestone.comments ?? '') ? { comments } : {})
  }
  return <article className="milestone-card" data-draft-opportunity-id={milestone.opportunityId} data-draft-milestone-id={milestone.id}>
    <div className="milestone-summary"><h3>{milestone.name}</h3><span className="status-pill">{milestone.status}</span></div>
    <p className="muted">{milestone.targetDate ? `Due ${milestone.targetDate}` : 'Target date not recorded'} - {milestone.commitment ?? 'Commitment not recorded'}</p>
    <details onToggle={(event) => setShowActivities(event.currentTarget.open)}><summary>Activities</summary>
      {showActivities && <MilestoneActivities client={client} milestone={milestone} />}
    </details>
    <details><summary>Reviewed milestone actions</summary>
      <label className="field">Status<select value={status} onChange={(event) => setStatus(event.target.value)}>
        {c.milestoneStatusSchema.options.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <button type="button" onClick={() => { void onAction('updateMilestone', { opportunityId: milestone.opportunityId, milestoneId: milestone.id, update: { status } }) }}>Review status update</button>
      <label className="field">Milestone risk details<textarea aria-label="Milestone risk details" value={risk} maxLength={30_000} onChange={(event) => setRisk(event.target.value)} /></label>
      <label className="field">Customer commitment<select value={commitment} onChange={(event) => setCommitment(event.target.value)}>
        <option value="">Choose a verified commitment</option>{c.customerCommitmentSchema.options.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label className="field">Milestone target date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label className="field">Milestone comments<textarea value={comments} maxLength={30_000} onChange={(event) => setComments(event.target.value)} /></label>
      <button type="button" disabled={!Object.keys(changes).length} onClick={() => { void onAction('updateMilestone', { opportunityId: milestone.opportunityId, milestoneId: milestone.id, update: changes }) }}>Review milestone fields</button>
      <button type="button" onClick={() => { void onAction(milestone.onMilestoneTeam ? 'leaveMilestoneTeam' : 'joinMilestoneTeam', { opportunityId: milestone.opportunityId, milestoneId: milestone.id }) }}>{milestone.onMilestoneTeam ? 'Review leaving milestone team' : 'Review joining milestone team'}</button>
      <label className="field">New task subject<input value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} /></label>
      <button type="button" disabled={!subject.trim()} onClick={() => { void onAction('createMilestoneActivity', { opportunityId: milestone.opportunityId, milestoneId: milestone.id, request: { subject } }) }}>Review new task</button>
    </details>
  </article>
}

export function StageChange({ selection, onAction }: { selection: WorkingSelection; onAction: RecordAction }) {
  const [target, setTarget] = useState(selection.opportunity.recordedStage > 1 ? selection.opportunity.recordedStage - 1 : 2)
  const [reason, setReason] = useState('')
  const previousStage = useRef({ id: selection.opportunity.id, stage: selection.opportunity.recordedStage })
  const choices = [selection.opportunity.recordedStage - 1, selection.opportunity.recordedStage + 1].filter((stage) => stage >= 1 && stage <= 5)
  useEffect(() => {
    if (previousStage.current.id !== selection.opportunity.id) {
      setTarget(selection.opportunity.recordedStage > 1 ? selection.opportunity.recordedStage - 1 : 2)
      setReason('')
    } else if (previousStage.current.stage !== selection.opportunity.recordedStage) setTarget(0)
    previousStage.current = { id: selection.opportunity.id, stage: selection.opportunity.recordedStage }
  }, [selection.opportunity.id, selection.opportunity.recordedStage])
  return <section className="stage-editor"><h3>Reviewed MCEM stage transition</h3>
    <p>Stage changes remain adjacent; unmet exit criteria and recycling require a business reason.</p>
    <label className="field">Target MCEM stage<select aria-label="Target MCEM stage" value={target} onChange={(event) => setTarget(Number(event.target.value))}>
      {!choices.includes(target) && <option value={0}>Choose a current adjacent stage</option>}
      {choices.map((stage) => <option key={stage} value={stage}>Stage {stage}</option>)}
    </select></label>
    <label className="field">Stage change reason<textarea aria-label="Stage change reason" value={reason} minLength={10} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
    <button type="button" disabled={reason.trim().length < 10 || !choices.includes(target)} onClick={() => { void onAction('transitionOpportunityStage', {
      contractVersion: c.contractVersion, accountId: selection.account.id, opportunityId: selection.opportunity.id, targetStage: target, reason
    }) }}>Review MCEM stage change</button>
  </section>
}
