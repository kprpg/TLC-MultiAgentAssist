import { useEffect, useState } from 'react'
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from '@fluentui/react-components'
import type { ActionPreview } from '../../../../packages/common/contracts/collaboration.js'

export function ReviewDialog({ preview, onConfirm, onCancel, error, busy }: {
  preview: ActionPreview | null; onConfirm(reason: string): void; onCancel(): void; error: string; busy: boolean
}) {
  const [reason, setReason] = useState('')
  useEffect(() => { setReason('') }, [preview?.id])
  const expired = preview ? Date.parse(preview.expiresAt) <= Date.now() : false
  return <Dialog open={preview !== null} onOpenChange={(_, data) => { if (!data.open && !busy) onCancel() }}>
    <DialogSurface className="teams-review-dialog"><DialogBody>
      <DialogTitle>Review exact changes</DialogTitle>
      <DialogContent>
        <p><strong>Operation:</strong> {preview?.operation}. Only the exact reviewed version can be confirmed.</p>
        <p className="warning">This can change source data. Canceling does not undo an operation already sent. Ambiguous outcomes must not be retried.</p>
        <h3>Before</h3><pre>{JSON.stringify(preview?.before, null, 2)}</pre>
        <h3>Selected changes</h3><pre>{JSON.stringify(preview?.input, null, 2)}</pre>
        <label className="field">Review reason<textarea aria-label="Review reason" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
        <p className="muted">Approval expires {preview ? new Date(preview.expiresAt).toLocaleTimeString() : ''}. Source permissions and state are checked again.</p>
        {error && <p role="alert" className="error-banner">{error}</p>}
        {expired && <p role="alert">This review expired. Cancel and refresh the preview.</p>}
      </DialogContent>
      <DialogActions>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel review</button>
        <button type="button" className="primary" disabled={!preview || busy || expired || reason.trim().length < 3} onClick={() => onConfirm(reason)}>
          {busy ? 'Confirming...' : 'Confirm selected changes'}
        </button>
      </DialogActions>
    </DialogBody></DialogSurface>
  </Dialog>
}
