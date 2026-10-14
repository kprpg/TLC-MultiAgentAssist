import { useEffect, useRef, type ReactElement } from 'react'

export function MembershipRemovalPrompt({ title, message, busy, onCancel, onConfirm }: {
  title: string
  message: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => Promise<void>
}): ReactElement {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  return (
    <div
      className="membership-removal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel()
      }}
    >
      <div className="membership-removal-dialog">
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="membership-removal-actions">
          <button type="button" className="membership-removal-cancel" disabled={busy} onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="button" className="membership-removal-confirm" disabled={busy} onClick={() => void onConfirm()}>
            {busy ? 'Removing...' : 'Remove membership'}
          </button>
        </div>
      </div>
    </div>
  )
}
