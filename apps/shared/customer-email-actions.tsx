import { useState } from 'react'
import { emailComposeRequestSchema } from '../../packages/common/contracts/index.js'
import { customerEmailCopyText, customerEmailHasPlaceholders, type CustomerEmailAction, type CustomerEmailDraft } from './customer-email.js'

export function CustomerEmailActions({ draft, emailAction }: { draft: CustomerEmailDraft; emailAction?: CustomerEmailAction | undefined }) {
    const [reviewOpen, setReviewOpen] = useState(false)
    const [recipients, setRecipients] = useState('')
    const [subject, setSubject] = useState(draft.subject)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')

    function reviewedDraft(): CustomerEmailDraft {
        const value = subject.trim()
        if (!value || value.length > 255) throw new Error('Enter an email subject between 1 and 255 characters.')
        return { ...draft, subject: value }
    }

    async function copy() {
        setError(''); setMessage(''); setBusy(true)
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this host. Select and copy the email text manually.')
            await navigator.clipboard.writeText(customerEmailCopyText(reviewedDraft()))
            setMessage('Email subject and body copied. Review before sending.')
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'The email text could not be copied.') }
        finally { setBusy(false) }
    }

    async function compose() {
        if (!emailAction || busy) return
        setError(''); setMessage(''); setBusy(true)
        try {
            const reviewed = reviewedDraft()
            let result: 'opened' | 'downloaded' | 'cancelled'
            if (emailAction.kind === 'host') result = await emailAction.compose(reviewed)
            else {
                const addresses = emailComposeRequestSchema.shape.recipients.safeParse(recipients.split(/[;,]/).map((item) => item.trim()).filter(Boolean))
                if (!addresses.success) throw new Error('Enter 1 to 20 valid recipient addresses, separated by commas or semicolons.')
                result = await emailAction.compose(reviewed, addresses.data)
            }
            if (result !== 'cancelled') setReviewOpen(false)
            setMessage(result === 'cancelled' ? 'Email draft cancelled. Nothing was sent.'
                : result === 'downloaded' ? 'Unsent email draft downloaded. Review before sending.'
                    : 'Unsent email draft opened. Review before sending.')
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'The email draft could not be prepared.') }
        finally { setBusy(false) }
    }

    return <section className="customer-email-actions" aria-label="Customer email draft actions" aria-busy={busy}>
        <div className="customer-email-buttons">
            {emailAction && <button type="button" disabled={busy} onClick={() => {
                if (emailAction.kind === 'host') void compose()
                else setReviewOpen((open) => !open)
            }}>E-mail</button>}
            <button type="button" disabled={busy} onClick={() => void copy()}>Copy</button>
        </div>
        <p className="customer-email-review-note">Draft only. Review the customer email and the response's assumptions before sending. Nothing is sent automatically.</p>
                {customerEmailHasPlaceholders(draft) && <p className="customer-email-review-note" role="note">Replace the bracketed placeholders, such as names and meeting options, before sending.</p>}
                {reviewOpen && <form className="customer-email-form" onSubmit={(event) => { event.preventDefault(); void compose() }}>
            <label>Draft recipients<input type="text" required value={recipients} disabled={busy}
                placeholder="reviewer@example.com" onChange={(event) => setRecipients(event.target.value)} /></label>
            <label>Draft subject<input type="text" required maxLength={255} value={subject} disabled={busy} onChange={(event) => setSubject(event.target.value)} /></label>
            <div className="customer-email-buttons">
                <button type="submit" disabled={busy}>Prepare unsent draft</button>
                <button type="button" disabled={busy} onClick={() => setReviewOpen(false)}>Cancel draft</button>
            </div>
        </form>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
    </section>
}
