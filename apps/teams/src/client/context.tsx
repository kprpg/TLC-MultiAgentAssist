import { useEffect, useState } from 'react'
import { pages } from '@microsoft/teams-js'
import { z } from 'zod'
import { accountSchema } from '../../../../packages/common/contracts/index.js'
import { contextBindingSchema, type ActionPreview } from '../../../../packages/common/contracts/collaboration.js'
import type { TeamsApiClient } from './data-client.js'
import type { BrowserHostContext } from './authentication.js'
import type { WorkingSelection } from './accounts.js'

export function ContextWorkspace({ client, host, selection }: { client: TeamsApiClient; host: BrowserHostContext; selection: WorkingSelection | null }) {
  const [accounts, setAccounts] = useState<Array<z.infer<typeof accountSchema>>>([])
  const [accountId, setAccountId] = useState(selection?.account.id ?? '')
  const [contextId, setContextId] = useState(host.contextId ?? '')
  const [kind, setKind] = useState<'channel' | 'chat' | 'meeting'>(host.kind)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    client.operation('listAccounts', {}, z.array(accountSchema), controller.signal).then((items) => {
      setAccounts(items); setAccountId((current) => current || items[0]?.id || '')
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client])
  async function save() {
    const binding = await client.request('contexts', contextBindingSchema, {
      kind, contextId, accountId,
      ...(selection?.account.id === accountId ? { opportunityId: selection.opportunity.id } : {})
    })
    if (host.embedded && pages.config.isSupported()) {
      await pages.config.setConfig({
        entityId: binding.id, suggestedDisplayName: 'TLC Assist',
        contentUrl: `${location.origin}/?surface=channel&bindingId=${encodeURIComponent(binding.id)}`,
        websiteUrl: `${location.origin}/`
      })
    }
    setMessage(`Context saved. Open ${location.origin}/?surface=channel&bindingId=${encodeURIComponent(binding.id)}`)
    return binding
  }
  useEffect(() => {
    if (!host.embedded || !pages.config.isSupported()) return
    pages.config.setValidityState(Boolean(accountId && contextId))
    pages.config.registerOnSaveHandler((event) => {
      save().then(() => event.notifySuccess()).catch((cause: unknown) => { setError(String(cause)); event.notifyFailure('Context authorization or configuration failed.') })
    })
  }, [client, host.embedded, accountId, contextId, kind, selection])
  return <section className="panel"><h1>Configure a Teams context</h1>
    <p>A binding shares navigation, not source permission. Every live viewer signs in independently.</p>
    <label className="field">Context type<select value={kind} onChange={(event) => {
      const value = event.target.value; if (value === 'channel' || value === 'chat' || value === 'meeting') setKind(value)
    }}><option value="channel">Channel</option><option value="chat">Chat</option><option value="meeting">Meeting</option></select></label>
    <label className="field">Context reference<input value={contextId} onChange={(event) => setContextId(event.target.value)} maxLength={500} /></label>
    <label className="field">Bound account<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
      {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <button type="button" className="primary" disabled={!accountId || !contextId} onClick={() => { setError(''); void save().catch((cause: unknown) => setError(String(cause))) }}>Save verified context</button>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error-banner">{error}</p>}
  </section>
}

export function SharedStage({ client, artifactId }: { client: TeamsApiClient; artifactId: string | null }) {
  const [brief, setBrief] = useState<{ title: string; text: string; checkedAt: string }>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!artifactId) return
    const controller = new AbortController()
    client.request(`shared/${encodeURIComponent(artifactId)}`, z.object({ title: z.string(), text: z.string(), checkedAt: z.string() }), undefined, controller.signal)
      .then(setBrief).catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client, artifactId])
  return <main className="stage-view"><h1>Shared meeting brief</h1>
    {!artifactId && <p>No approved brief selected.</p>}
    {brief && <article><h2>{brief.title}</h2><p>{brief.text}</p><p>Reviewed snapshot. Source checked {new Date(brief.checkedAt).toLocaleString()}.</p></article>}
    {error && <p role="alert" className="error-banner">{error}</p>}
  </main>
}

export type PreparedPublication = ActionPreview
