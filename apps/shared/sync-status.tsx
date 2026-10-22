import { useState, useSyncExternalStore } from 'react'
import { mutationReviewFields, type MutationSyncClient } from './mutation-sync.js'
import type { MutationReview } from '../../packages/common/contracts/cache-sync.js'
import type { PresentationClient } from './presentation-hooks.js'
import type { ReactiveSessionData } from './use-session-data.js'
import { useSessionState } from './use-session-data.js'
import './sync-status.css'

export function SourceSyncStatus({ client, showReads = true }: { client: PresentationClient; showReads?: boolean }) {
  return <div className="source-sync-region" role="region" aria-label="Source synchronization">
    {showReads && client.cacheSession && <CacheStatus cache={client.cacheSession} />}
    {client.mutationSession && <MutationStatus sync={client.mutationSession} />}
  </div>
}

export function CacheStatus({ cache }: { cache: ReactiveSessionData }) {
  const state = useSessionState(cache)
  return state.error ? <p role="status" className="sync-warning">Source refresh failed. Confirmed cached data may be stale. {state.error}</p>
    : state.refreshing ? <span role="status" className="sync-status">Refreshing source data...</span>
      : state.stale ? <span role="status" className="sync-status">Cached source data is stale.</span>
        : state.validatedAt === undefined ? null : <span className="sync-status">Last checked {new Date(state.validatedAt).toLocaleTimeString()}</span>
}

export function MutationStatus({ sync }: { sync: MutationSyncClient }) {
  const state = useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot)
  const [error, setError] = useState('')
  const unresolved = state.jobs.filter((job) => ['effect-unknown', 'conflict', 'failed-before-send'].includes(job.state))
  if (!state.pending && !unresolved.length && !state.notice) return null
  return <details className="sync-status" open={unresolved.length > 0}>
    <summary>{state.pending ? `Saving ${state.pending} confirmed change${state.pending === 1 ? '' : 's'} in the background`
      : unresolved.length ? 'Source changes need attention' : 'Acknowledged save mode'}</summary>
    {state.notice && <p>{state.notice}</p>}
    {state.initializationFailed && <button type="button" onClick={() => {
      setError('')
      void sync.retryInitialization().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Synchronization is unavailable.'))
    }}>Retry synchronization</button>}
    {error && <p role="alert">{error}</p>}
    {state.jobs.filter((job) => !['confirmed', 'reconciled-current-state'].includes(job.state)).map((job) =>
      <div key={job.id}>
        <strong>{job.operation.replace(/([A-Z])/g, ' $1')}</strong>: {job.state}
        {job.error && <p role="alert">{job.error}</p>}
        {['failed-before-send', 'conflict'].includes(job.state)
          && ['updateOpportunity', 'updateMilestone', 'transitionOpportunityStage'].includes(job.operation)
          && <button type="button" onClick={() => {
            setError('')
            void sync.reviewCurrent(job.id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Current source values could not be reviewed.'))
          }}>Review current source values</button>}
        {job.review && <CurrentSourceReview key={job.review.id} review={job.review} sync={sync} replacedId={job.id} onError={setError} />}
        {job.state === 'effect-unknown' && <button type="button" onClick={() => {
          setError('')
          void sync.reconcile(job.id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Reconciliation failed.'))
        }}>Check current source state</button>}
      </div>)}
  </details>
}

function CurrentSourceReview({ review, sync, replacedId, onError }: {
  review: MutationReview; sync: MutationSyncClient; replacedId: string; onError(message: string): void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fields = mutationReviewFields(review)
  const display = (value: unknown) => value === undefined || value === null || value === '' ? '(not set)' : String(value)
  return <section aria-label="Review updated source values" className="sync-review">
    <p>Your draft has been retained. Compare the current source with the proposed change before confirming it again.</p>
    {!fields.length ? <p role="alert">The source review did not include valid current values. Refresh the record instead.</p>
      : <table><thead><tr><th>Field</th><th>Current source</th><th>Your proposed change</th></tr></thead>
        <tbody>{fields.map((field) => <tr key={field.label}><th>{field.label}</th><td>{display(field.current)}</td><td>{display(field.proposed)}</td></tr>)}</tbody></table>}
    <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed the current values and want to apply this exact change.</label>
    <button type="button" disabled={!fields.length || !confirmed || submitting} onClick={() => {
      setSubmitting(true); onError('')
      void sync.submitReviewed(review, 'Reviewed current source values and explicitly confirmed the retained draft.').then(({ completion }) => {
        sync.dismiss(replacedId)
        void completion.catch((cause: unknown) => onError(cause instanceof Error ? cause.message : 'Source outcome requires reconciliation.'))
      }).catch((cause: unknown) => onError(cause instanceof Error ? cause.message : 'This exact source change could not be admitted.'))
        .finally(() => setSubmitting(false))
    }}>{submitting ? 'Submitting...' : 'Confirm reviewed change'}</button>
  </section>
}
