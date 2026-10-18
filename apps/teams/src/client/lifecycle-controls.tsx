import { useEffect, useState } from 'react'
import {
  collaborationLifecycleSchema, collaborationVersion, type CollaborationLifecycleStatus
} from '../../../../packages/common/contracts/collaboration.js'
import type { TeamsApiClient } from './data-client.js'

export function LifecycleControls({ client, onChanged }: { client: TeamsApiClient; onChanged(command: 'pause' | 'resume' | 'retire'): void }) {
  const [status, setStatus] = useState<CollaborationLifecycleStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    client.request('lifecycle', collaborationLifecycleSchema, undefined, controller.signal).then(setStatus)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client])
  async function change(command: 'pause' | 'resume' | 'retire') {
    setBusy(true); setError('')
    try {
      setStatus(await client.request('lifecycle', collaborationLifecycleSchema, { contractVersion: collaborationVersion, command }))
      onChanged(command)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <fieldset className="panel">
    <legend>Background work and admission</legend>
    {status && <p role="status">{status.state === 'active' ? 'Work is active.' : status.state === 'paused' ? 'Work is paused.' : 'Work is disconnected.'}</p>}
    <p>Pause stops new runs, changes, publications and background acquisition. Existing reads and cancellation remain available.
      Resuming requires fresh reviews; old notifications and acquisition hints do not replay.</p>
    {status?.state === 'retired' && <p>Resume explicitly before reopening private data. Reinstallation alone does not restore work.</p>}
    {status?.state === 'active' && !status.acceptingNewWork && <p className="warning">The operator has disabled new work. A personal resume cannot override this.</p>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    <div className="toolbar">
      <button type="button" disabled={!status || busy || status.state !== 'active'} onClick={() => { void change('pause') }}>Pause new work</button>
      <button type="button" disabled={!status || busy || status.state === 'active'} onClick={() => { void change('resume') }}>Resume work</button>
      <button type="button" disabled={!status || busy || status.state === 'retired'} onClick={() => { void change('retire') }}>Disconnect work</button>
    </div>
    <p className="muted">Already dispatched effects cannot be undone. In-flight work may need reconciliation; disconnect does not sign you out of Teams.</p>
  </fieldset>
}
