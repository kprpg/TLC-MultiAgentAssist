import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { TeamsApiClient } from './data-client.js'
import { LifecycleControls } from './lifecycle-controls.js'

const activitySchema = z.object({
  contractVersion: z.literal('1.0'),
  actions: z.array(z.object({ id: z.string(), operation: z.string(), state: z.string() })),
  notifications: z.array(z.object({ id: z.string(), title: z.string(), state: z.string() })),
  workflows: z.array(z.object({ runId: z.string(), workflowId: z.string(), status: z.string(), detail: z.string().optional() })).optional()
})
export function ActivityWorkspace({ client, onDisconnect }: { client: TeamsApiClient; onDisconnect(): void }) {
  const [activity, setActivity] = useState<z.infer<typeof activitySchema>>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    client.request('activity', activitySchema, undefined, controller.signal).then(setActivity)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client, revision])
  return <section className="panel"><h1>Your activity</h1>
    <LifecycleControls client={client} onChanged={(command) => {
      setError(''); setActivity(undefined); setRevision((value) => value + 1)
      if (command === 'retire') onDisconnect()
    }} />
    <p>Reviewed actions and private notifications. An unknown outcome is not a failed or rolled-back write.</p>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {activity && !activity.actions.length && !activity.notifications.length && <p>No reviewed actions yet.</p>}
    <ul className="activity-list">{activity?.actions.map((item) => <li key={item.id}><strong>{item.operation}</strong><span className="status-pill">{item.state}</span>
      {item.state === 'effect-unknown' && <p className="warning">Do not repeat this action. Reconcile its actual source outcome with an authorized owner.</p>}
    </li>)}</ul>
    <ul className="activity-list">{activity?.notifications.map((item) => <li key={item.id}>{item.title}<span>{item.state}</span></li>)}</ul>
    <ul className="activity-list">{activity?.workflows?.map((item) => <li key={item.runId}><strong>{item.workflowId}</strong><span>{item.status}</span>{item.detail && <p className="warning">{item.detail}</p>}</li>)}</ul>
  </section>
}
