import { Component, type ReactNode } from 'react'

export class WorkspaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch() { console.error('[teams-ui] workspace_render_failed') }

  render() {
    return this.state.failed ? <section className="panel" role="alert">
      <h2>Workspace controls are unavailable</h2>
      <p>The workspace could not be loaded or rendered. Submitted operations were not undone. You can still use the other navigation screens.</p>
      <p>If you reload, unsaved work will be discarded and local Live will require page pairing again.</p>
      <button type="button" onClick={() => location.reload()}>Reload page and discard unsaved work</button>
    </section> : this.props.children
  }
}
