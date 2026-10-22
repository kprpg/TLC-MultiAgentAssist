import { useRef, useState } from 'react'
import type { TeamsDataMode, TeamsDataModes } from '../../../../packages/common/contracts/teams-data-mode.js'

export function DataModeSwitcher({ catalog, mode, locked, error, onSwitch }: {
  catalog: TeamsDataModes | undefined; mode: TeamsDataMode | undefined; locked: boolean; error: string
  onSwitch(mode: TeamsDataMode): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [pending, setPending] = useState<TeamsDataMode>()
  if (!catalog || !mode) return error ? <p role="alert" className="warning">{error}</p> : null
  return <div className="data-mode-switcher">
    <label>Data mode<select aria-label="Data mode" value={mode} disabled={locked} onChange={(event) => {
      const next = event.target.value
      if ((next === 'sample' || next === 'live') && next !== mode) { setPending(next); dialog.current?.showModal() }
    }}>
      <option value="sample">Sample - SQLite</option>
      <option value="live" disabled={!catalog.availableModes.includes('live')}>Live</option>
    </select></label>
    {!catalog.availableModes.includes('live') && <small>Live requires one-time approved runtime configuration.</small>}
    {locked && <small>Wait for the current write confirmation before switching modes.</small>}
    <dialog ref={dialog} className="data-mode-dialog" aria-labelledby="data-mode-dialog-title" onCancel={() => setPending(undefined)}>
      <h2 id="data-mode-dialog-title">Switch to {pending === 'sample' ? 'Sample' : 'Live'} mode?</h2>
      <p>This clears this page's unsaved drafts, displayed results and pending reviews. Other open pages are unchanged.</p>
      <p>Sample edits remain in their separate SQLite store. Live access still requires your approved source connection and page pairing.</p>
      <p>Switching does not cancel or undo work already submitted in the previous mode.</p>
      <div className="toolbar">
        <button type="button" onClick={() => { dialog.current?.close(); setPending(undefined) }}>Keep current mode</button>
        <button type="button" className="primary" disabled={locked || !pending} onClick={() => {
          if (!pending || locked) return
          const next = pending
          dialog.current?.close(); setPending(undefined); onSwitch(next)
        }}>Switch mode and discard unsaved work</button>
      </div>
    </dialog>
  </div>
}
