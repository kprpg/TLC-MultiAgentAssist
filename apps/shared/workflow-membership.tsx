import { useEffect, useId, useState, type ReactNode } from 'react'
import './workflow-membership.css'

export interface MembershipView<T> {
  runId: string
  filter: 'all' | 'mine'
  state: 'ready' | 'pending' | 'unavailable' | 'legacy'
  message?: string | undefined
  totalItems: number
  visibleItems: number
  eligibility: Array<{ queueItemId: string; eligible: boolean; reason: string }>
  output?: T | undefined
}

export function useWorkflowMembership<T>(
  load: (runId: string, filter: 'all' | 'mine') => Promise<MembershipView<T>>,
  runId: string | undefined, rawOutput: T | undefined
) {
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ runId: string; filter: 'all' | 'mine'; rawOutput: T; view?: MembershipView<T>; error?: string }>()
  useEffect(() => {
    if (!runId || !rawOutput) return
    let current = true
    setResult({ runId, filter, rawOutput })
    load(runId, filter).then((view) => {
      if (current) {
        if (view.runId !== runId || view.filter !== filter) {
          console.error('[workflow-membership] response-scope-mismatch')
          setResult({ runId, filter, rawOutput, error: 'The result scope changed. Refresh membership and try again.' })
        } else setResult({ runId, filter, rawOutput, view })
      }
    }, () => {
      if (current) {
        console.error('[workflow-membership] view-read-failed')
        setResult({ runId, filter, rawOutput, error: 'Team membership could not be loaded. Refresh membership and try again.' })
      }
    })
    return () => { current = false }
  }, [load, runId, rawOutput, filter, revision])
  const matching = result?.runId === runId && result?.filter === filter && result?.rawOutput === rawOutput ? result : undefined
  const view = matching?.view
  const loading = Boolean(runId && rawOutput && !view && !matching?.error)
  const output = filter === 'all' ? view?.output ?? rawOutput : view?.output
  const reasonFor = (queueItemId: string) => {
    if (loading) return 'Checking your team membership.'
    if (matching?.error) return matching.error
    const eligibility = view?.eligibility.find((item) => item.queueItemId === queueItemId)
    return eligibility?.eligible ? '' : eligibility?.reason || 'Your team membership could not be verified. Refresh membership and try again.'
  }
  return {
    filter, setFilter, output, reasonFor, loading,
    message: matching?.error ?? view?.message,
    totalItems: view?.totalItems, visibleItems: view?.visibleItems,
    refresh: () => setRevision((value) => value + 1)
  }
}

export function WorkflowMembershipControls({ membership }: {
  membership: Pick<ReturnType<typeof useWorkflowMembership>, 'filter' | 'setFilter' | 'loading' | 'message' | 'totalItems' | 'visibleItems' | 'refresh'>
}) {
  return <div className="workflow-membership-controls">
    <label>Results <select aria-label="Filter Play results" value={membership.filter} onChange={(event) => {
      membership.setFilter(event.target.value === 'mine' ? 'mine' : 'all')
    }}>
      <option value="all">All visible items</option><option value="mine">My items</option>
    </select></label>
    <span role={membership.message ? 'alert' : 'status'}>{membership.loading ? 'Checking team membership...'
      : membership.message ?? (membership.totalItems !== undefined ? `${membership.visibleItems} of ${membership.totalItems} items` : '')}</span>
    <button type="button" onClick={membership.refresh} disabled={membership.loading}>Refresh membership</button>
    {membership.filter === 'mine' && !membership.loading && !membership.message && membership.visibleItems === 0
      && <p>No items match your team membership.</p>}
  </div>
}

export function MembershipAction({ reason, children }: { reason: string; children: ReactNode }) {
  const id = useId()
  return <span className="membership-action" tabIndex={reason ? 0 : undefined} aria-describedby={reason ? id : undefined}>
    {children}{reason && <span id={id} role="tooltip" className="membership-action-tooltip">{reason}</span>}
  </span>
}

export function WorkflowMembershipResults<T>({ load, runId, output, children }: {
  load: (runId: string, filter: 'all' | 'mine') => Promise<MembershipView<T>>
  runId: string | undefined
  output: T
  children(output: T, reasonFor: (queueItemId: string) => string): ReactNode
}) {
  const membership = useWorkflowMembership(load, runId, output)
  return <section className="workflow-membership-results">
    <WorkflowMembershipControls membership={membership} />
    {membership.output && children(membership.output, membership.reasonFor)}
  </section>
}
