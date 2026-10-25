import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { WorkingSessionDeliverables, WorkingSessionResult } from '../../../packages/common/contracts/working-session.js'
import {
  confidenceLabel, draftFromTopic, groupFiles, prepareRequestFor, topicFromDraft, topicRequestFor, workingSessionFailure,
  type TopicDraft, type WorkingSessionMilestone, type WorkingSessionOpportunity
} from './working-session-model.js'
import type { WorkingSessionClient } from './types.js'

type Step = 'choose' | 'topic' | 'running' | 'done'

/**
 * One launcher for Desktop, Web, the VS Code webview and Teams. It only presents and dispatches: topic deduction,
 * searching, downloading and file writing all happen behind the orchestrator operations.
 */
export function WorkingSessionLauncher({ client, opportunity, milestones, onNote, label = 'Working session', compact = false }: {
  client: WorkingSessionClient
  opportunity: WorkingSessionOpportunity
  milestones: readonly WorkingSessionMilestone[]
  onNote?: (message: string) => void
  label?: string
  /** Icon-only button for narrow headers; the accessible name is unchanged. */
  compact?: boolean
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('choose')
  const [milestoneId, setMilestoneId] = useState('')
  const [draft, setDraft] = useState<TopicDraft | undefined>(undefined)
  const [deliverables, setDeliverables] = useState<WorkingSessionDeliverables>({ decks: true, learn: true, iac: true })
  const [error, setError] = useState('')
  const [result, setResult] = useState<WorkingSessionResult | undefined>(undefined)
  const [actionNote, setActionNote] = useState('')

  useEffect(() => {
    setOpen(false); setStep('choose'); setDraft(undefined); setResult(undefined); setError(''); setActionNote(''); setMilestoneId('')
  }, [opportunity.id])
  useEffect(() => {
    setMilestoneId((current) => milestones.some((milestone) => milestone.id === current) ? current : milestones[0]?.id ?? '')
  }, [milestones])

  const milestone = milestones.find((item) => item.id === milestoneId)
  const chosen = Object.values(deliverables).some(Boolean)

  const suggest = useCallback(async () => {
    if (!milestone) return
    setError(''); setStep('running')
    try {
      const response = await client.deriveWorkingSessionTopic(topicRequestFor(opportunity, milestone))
      setDraft(draftFromTopic(response.topic)); setStep('topic')
    } catch (failure) {
      setError(workingSessionFailure(failure)); setStep('choose')
    }
  }, [client, opportunity, milestone])

  const prepare = useCallback(async () => {
    if (!milestone || !draft) return
    const checked = topicFromDraft(draft)
    if ('error' in checked) { setError(checked.error); return }
    setError(''); setStep('running')
    try {
      setResult(await client.prepareWorkingSession(prepareRequestFor(opportunity, milestone, checked.topic, deliverables))); setStep('done')
    } catch (failure) {
      setError(workingSessionFailure(failure)); setStep('topic')
    }
  }, [client, opportunity, milestone, draft, deliverables])

  const openOutput = useCallback(async () => {
    if (!result) return
    setActionNote('')
    try {
      if (result.delivery.kind === 'folder') await client.openWorkingSessionFolder?.(result.delivery.folderPath)
      else await client.downloadWorkingSession?.(result.delivery.downloadId, result.delivery.fileName)
    } catch (failure) {
      const message = workingSessionFailure(failure)
      setActionNote(message); onNote?.(message)
    }
  }, [client, result, onNote])

  const anchor = useRef<HTMLDivElement>(null)
  const edit = (field: keyof TopicDraft) => (event: { target: { value: string } }) => setDraft((current) => current ? { ...current, [field]: event.target.value } : current)
  const canOpen = result ? (result.delivery.kind === 'folder' ? Boolean(client.openWorkingSessionFolder) : Boolean(client.downloadWorkingSession)) : false

  const panel = (
    <div className="working-session-panel" role="dialog" aria-label="Prepare working session">
      <p className="working-session-lead">Gathers decks, Microsoft Learn pages and a draft Azure template for <strong>{opportunity.name}</strong>.</p>
      {error && <p className="working-session-error" role="alert">{error}</p>}

      {step === 'choose' && (<>
        {milestones.length === 0
          ? <p className="working-session-muted">This opportunity has no milestones yet. Add or join a milestone to prepare a working session.</p>
          : <label className="working-session-field">Milestone
            <select aria-label="Milestone" value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)}>
              {milestones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>}
        <p className="working-session-muted">The topic is deduced from the opportunity and milestone titles and comments. You can edit it before anything is prepared.</p>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => setOpen(false)}>Close</button>
          <button type="button" className="primary" disabled={!milestone} onClick={() => void suggest()}>Suggest topic</button>
        </div>
      </>)}

      {step === 'topic' && draft && (<>
        <p className="working-session-muted">{confidenceLabel(draft)}{draft.evidence.length ? `: ${draft.evidence.join('; ')}` : ''}</p>
        <label className="working-session-field">Topic<input aria-label="Topic" value={draft.topic} onChange={edit('topic')} /></label>
        <label className="working-session-field">Azure services (comma separated)<input aria-label="Azure services" value={draft.azureServices} onChange={edit('azureServices')} /></label>
        <details className="working-session-advanced">
          <summary>Search phrases and template</summary>
          <label className="working-session-field">Deck searches (one per line)<textarea aria-label="Deck searches" rows={3} value={draft.deckQueries} onChange={edit('deckQueries')} /></label>
          <label className="working-session-field">Learn searches (one per line)<textarea aria-label="Learn searches" rows={3} value={draft.learnQueries} onChange={edit('learnQueries')} /></label>
          <label className="working-session-field">Template description<textarea aria-label="Template description" rows={2} value={draft.iacScenario} onChange={edit('iacScenario')} /></label>
        </details>
        <fieldset className="working-session-deliverables">
          <legend>Prepare</legend>
          <label><input type="checkbox" checked={deliverables.decks} onChange={(event) => setDeliverables((current) => ({ ...current, decks: event.target.checked }))} /> PowerPoint decks</label>
          <label><input type="checkbox" checked={deliverables.learn} onChange={(event) => setDeliverables((current) => ({ ...current, learn: event.target.checked }))} /> Microsoft Learn document set</label>
          <label><input type="checkbox" checked={deliverables.iac} onChange={(event) => setDeliverables((current) => ({ ...current, iac: event.target.checked }))} /> Bicep / ARM templates</label>
        </fieldset>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => { setStep('choose'); setError('') }}>Back</button>
          <button type="button" className="primary" disabled={!chosen} onClick={() => void prepare()}>Prepare</button>
        </div>
      </>)}

      {step === 'running' && <p className="working-session-muted" role="status">Working... gathering decks, Learn pages and templates can take a minute.</p>}

      {step === 'done' && result && (<>
        <p role="status"><strong>{result.summary}</strong></p>
        <p className="working-session-muted">{result.delivery.kind === 'folder' ? `Saved to ${result.delivery.folderPath}` : `Ready to download as ${result.delivery.fileName}. It is kept for a few minutes.`}</p>
        {groupFiles(result.files).map((group) => (
          <section key={group.kind} className="working-session-group">
            <h5>{group.heading}</h5>
            <ul>{group.files.map((file) => <li key={file.path}>{file.title} <span className="working-session-muted">({file.sourceLabel})</span></li>)}</ul>
          </section>
        ))}
        {result.gaps.length > 0 && (
          <section className="working-session-group working-session-gaps" aria-label="Needs attention">
            <h5>Needs attention</h5>
            <ul>{result.gaps.map((gap, index) => <li key={`${gap.source}-${index}`}><strong>{gap.source}:</strong> {gap.message}</li>)}</ul>
          </section>
        )}
        {actionNote && <p className="working-session-error" role="alert">{actionNote}</p>}
        <div className="actions">
          <button type="button" className="secondary" onClick={() => { setStep('topic'); setResult(undefined) }}>Prepare again</button>
          <button type="button" className="secondary" onClick={() => setOpen(false)}>Close</button>
          {canOpen && <button type="button" className="primary" onClick={() => void openOutput()}>{result.delivery.kind === 'folder' ? 'Open folder' : 'Download zip'}</button>}
        </div>
      </>)}
    </div>
  )

  // Rendered in the Fluent provider (when present) so theme variables apply, outside any ancestor stacking context.
  const host = open ? anchor.current?.closest('.fui-FluentProvider') ?? document.body : undefined

  return (
    <div className="working-session-launcher" ref={anchor}>
      <button type="button" className={`secondary working-session-button${compact ? ' working-session-compact' : ''}`} aria-expanded={open} aria-haspopup="dialog" aria-label="Prepare working session"
        title="Prepare working session: decks, Microsoft Learn pages and Bicep/ARM templates for this milestone" onClick={() => setOpen((value) => !value)}>
        {compact
          ? <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 4.5A1.5 1.5 0 0 1 4.5 3h3.38a1.5 1.5 0 0 1 1.06.44L10.5 5h5A1.5 1.5 0 0 1 17 6.5V8h-1V6.5a.5.5 0 0 0-.5-.5h-5.2L8.23 4.44A.5.5 0 0 0 7.88 4H4.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5H9v1H4.5A1.5 1.5 0 0 1 3 13.5v-9Zm12 6v2h2v1h-2v2h-1v-2h-2v-1h2v-2h1Z" /></svg>
          : label}
      </button>
      {host && createPortal(panel, host)}
    </div>
  )
}
