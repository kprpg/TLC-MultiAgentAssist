import { useEffect, useState } from 'react'
import { cliCapabilities, nativeCapabilities, nativeConnectionStatusSchema, type LocalPairRequestResult, type NativeConnectionStatus } from '../../../../packages/common/contracts/local-connection.js'
import type { LocalBrowserConnection } from './local-connection.js'
import type { TeamsApiClient } from './data-client.js'

export function NativeConnectionPanel({ connection, client, connected, authentication = 'local-interactive', onConnected, onDisconnected }: {
  connection: LocalBrowserConnection
  client: TeamsApiClient
  connected: boolean
  authentication?: 'local-interactive' | 'local-azure-cli'
  onConnected(): Promise<void>
  onDisconnected(message: string): void
}) {
  const cli = authentication === 'local-azure-cli'
  const ownerDirectory = cli ? 'launcher-cli' : 'launcher-native'
  const ownerArgument = `-WorkDirectory "$env:LOCALAPPDATA\\TLC-Assist\\Teams\\${ownerDirectory}"`
  const [pending, setPending] = useState<LocalPairRequestResult>()
  const [status, setStatus] = useState<NativeConnectionStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!pending || connected) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        if (await connection.poll(controller.signal)) {
          if (!controller.signal.aborted) { await onConnected(); if (!controller.signal.aborted) setPending(undefined) }
        } else if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, 2000)
      } catch (cause) {
        if (!controller.signal.aborted) { setError(String(cause)); setPending(undefined); connection.clear() }
      }
    }
    void poll()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [pending, connected, connection, onConnected])
  useEffect(() => {
    if (!connected) { setStatus(undefined); return }
    const controller = new AbortController()
    const refresh = () => {
      void client.request('local/status', nativeConnectionStatusSchema, undefined, controller.signal).then((value) => {
        if (!controller.signal.aborted) setStatus(value)
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          connection.clear(); onDisconnected(`Local connection unavailable; private results cleared. ${String(cause)}`)
        }
      })
    }
    refresh()
    const monitor = setInterval(refresh, 15_000)
    const expiry = setTimeout(() => {
      connection.clear(); onDisconnected('Local page authorization expired. Private results were cleared; pair again.')
    }, Math.max(0, (connection.expiresAt() ?? 0) - Date.now()))
    return () => { controller.abort(); clearInterval(monitor); clearTimeout(expiry) }
  }, [connected, connection, client, onDisconnected])
  async function begin() {
    setBusy(true); setError('')
    try { setPending(await connection.begin()) }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  async function disconnect() {
    setBusy(true)
    try {
      await connection.disconnect()
      onDisconnected('This page was disconnected and its API capability revoked. Private results were cleared; other paired pages are unchanged.')
    } catch (cause) { onDisconnected(`Private results were cleared. ${String(cause)}`) }
    finally { setBusy(false) }
  }
  const content = <>
    <h2>{connected ? 'Live MSX: this device' : 'Connect your local MSX installation'}</h2>
    {connected ? <>
      <p>{status?.detail ?? 'Checking the owner connection...'}</p>
      {status?.account && <p>{cli ? 'Azure CLI account' : 'Native account'}: <strong>{status.account}</strong></p>}
      <button type="button" disabled={busy} onClick={() => { void disconnect() }}>Disconnect this page</button>
    </> : <>
      <p>{cli
        ? 'This device reuses your existing Azure CLI sign-in. Your own Dataverse identity and permissions are verified before access. Your active deal-team accounts load automatically after pairing. This profile is read-only; the page never receives an MSX token or starts az login.'
        : 'Everything runs on your own machine. Your native account must be approved and permitted to access MSX. This page never receives an MSX token or opens source sign-in.'}</p>
      <ol>
        <li>In your local installation, run <code>{String.raw`.\scripts\teams-local-connection.ps1 -Action Connect ${ownerArgument}`}</code>.
          {cli ? ' This uses your current corporate CLI user, not a manually supplied user ID. If the CLI session has expired, run az login yourself, then reconnect.' : ' Complete corporate sign-in yourself.'}
          {' '}Use the same work directory as your launcher if you chose a custom location.</li>
        <li>Request a page pairing, then match and approve its code using the protected local owner command.</li>
      </ol>
      <p>Without a launcher record, use your extracted runtime: <code>node server.js --local-owner connect &lt;protected-owner-directory&gt; msx</code>, then the matching <code>approve</code> command.</p>
      <button type="button" className="primary" disabled={busy || !!pending} onClick={() => { void begin() }}>{busy ? 'Requesting...' : 'Request local pairing'}</button>
      {pending && <div role="status"><p>Pairing code: <strong>{pending.userCode}</strong></p>
        <p>On this machine, run <code>{String.raw`.\scripts\teams-local-connection.ps1 -Action Approve -UserCode ${pending.userCode} ${ownerArgument}`}</code> with your launcher work directory.</p>
        <p>Standalone runtime alternative: <code>{`node server.js --local-owner approve <protected-owner-directory> ${pending.userCode}`}</code>.</p>
        <p>Waiting for explicit owner approval. This code is public, expires in five minutes and grants no source access by itself.</p>
      </div>}
    </>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    <details><summary>Capabilities and limitations</summary>
      <p>Private source access does not enable cloud callbacks, cross-device shared state, audience publication or private earnings-profile access.</p>
      <dl>{(status?.capabilities ?? (cli ? cliCapabilities : nativeCapabilities)).map((capability) => <div key={capability.id}>
        <dt><strong>{capability.title}</strong>: {capability.state.replaceAll('-', ' ')}</dt><dd>{capability.detail}</dd>
      </div>)}</dl>
      {status?.resources.map((resource) => <p key={resource.resource}>{resource.resource.toUpperCase()}: {resource.state.replaceAll('-', ' ')}. {resource.detail}</p>)}
    </details>
  </>
  return connected
    ? <>{cli && <p role="status" className="context-banner">Live MSX - Azure CLI read-only</p>}
      <details className="panel native-connection-panel" aria-label="Local MSX connection"><summary>Live MSX: this device - {status?.state ?? 'checking connection'}</summary>{content}</details></>
    : <section className="panel native-connection-panel" aria-label="Local MSX connection">{content}</section>
}
