import { useEffect, useRef, useState, type ReactElement } from 'react'

export function MembershipRemovalPrompt({ title, message, busy, onCancel, onConfirm }: {
  title: string
  message: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => Promise<void>
}): ReactElement {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const working = busy || confirming

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  async function confirm() {
    if (working) return
    setError('')
    setConfirming(true)
    try {
      await onConfirm()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove membership. Please try again.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div
      className="membership-removal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      aria-busy={working}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !working) onCancel()
      }}
    >
      <div className="membership-removal-dialog">
        <h2>{title}</h2>
        <p>{message}</p>
        {error && <p className="membership-removal-error" role="alert">{error}</p>}
        <div className="membership-removal-actions">
          <button type="button" className="membership-removal-cancel" disabled={working} onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="button" className="membership-removal-confirm" disabled={working} onClick={() => void confirm()}>
            {working ? 'Removing...' : 'Remove membership'}
          </button>
        </div>
      </div>
    </div>
  )
}
