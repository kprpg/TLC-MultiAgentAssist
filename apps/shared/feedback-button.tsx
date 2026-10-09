import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, ReactElement } from 'react'
import {
    buildFeedbackIssueUrl,
    copyFeedbackScreenshots,
    feedbackScreenshotLimit,
    selectFeedbackScreenshots,
    type FeedbackDraft
} from './feedback.js'

interface FeedbackScreenshot {
    id: number
    file: File
    previewUrl: string
}

const emptyDraft: FeedbackDraft = { title: '', description: '', reproductionSteps: '' }

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

function invoke(action: () => Promise<void> | void): Promise<void> {
    try {
        return Promise.resolve(action())
    } catch (error) {
        return Promise.reject(error)
    }
}

export function FeedbackButton({ onOpenIssue }: {
    onOpenIssue(url: string): Promise<void> | void
}): ReactElement {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState<FeedbackDraft>(emptyDraft)
    const [screenshots, setScreenshots] = useState<FeedbackScreenshot[]>([])
    const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const screenshotId = useRef(0)
    const screenshotsRef = useRef(screenshots)

    useEffect(() => {
        screenshotsRef.current = screenshots
    }, [screenshots])

    useEffect(() => () => {
        for (const screenshot of screenshotsRef.current) URL.revokeObjectURL(screenshot.previewUrl)
    }, [])

    useEffect(() => {
        if (!open) return
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !submitting) setOpen(false)
        }
        window.addEventListener('keydown', closeOnEscape)
        return () => window.removeEventListener('keydown', closeOnEscape)
    }, [open, submitting])

    const addScreenshots = (files: readonly File[]) => {
        const selection = selectFeedbackScreenshots(screenshots.length, files)
        if (selection.accepted.length > 0) {
            setScreenshots((current) => [
                ...current,
                ...selection.accepted.map((file) => ({
                    id: screenshotId.current += 1,
                    file,
                    previewUrl: URL.createObjectURL(file)
                }))
            ])
        }
        setMessage(selection.rejected.length > 0
            ? { kind: 'error', text: selection.rejected.join(' ') }
            : null)
    }

    const handlePaste = (event: ClipboardEvent<HTMLFormElement>) => {
        const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
        if (images.length === 0) return
        event.preventDefault()
        addScreenshots(images)
    }

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        addScreenshots(Array.from(event.dataTransfer.files))
    }

    const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
        addScreenshots(Array.from(event.currentTarget.files ?? []))
        event.currentTarget.value = ''
    }

    const removeScreenshot = (id: number) => {
        setScreenshots((current) => {
            const removed = current.find((screenshot) => screenshot.id === id)
            if (removed) URL.revokeObjectURL(removed.previewUrl)
            return current.filter((screenshot) => screenshot.id !== id)
        })
        setMessage(null)
    }

    const updateDraft = (field: keyof FeedbackDraft, value: string) => {
        setDraft((current) => ({ ...current, [field]: value }))
        setMessage(null)
    }

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setSubmitting(true)
        setMessage(null)
        const issueUrl = buildFeedbackIssueUrl(draft, screenshots.length > 0)
        const copyPromise = screenshots.length > 0
            ? copyFeedbackScreenshots(screenshots.map((screenshot) => screenshot.file))
            : Promise.resolve()
        const openPromise = invoke(() => onOpenIssue(issueUrl))
        const [openResult, copyResult] = await Promise.allSettled([openPromise, copyPromise])
        setSubmitting(false)

        if (openResult.status === 'rejected') {
            setMessage({ kind: 'error', text: `GitHub could not be opened. ${errorMessage(openResult.reason)}` })
            return
        }
        if (copyResult.status === 'rejected') {
            setMessage({
                kind: 'error',
                text: `GitHub opened, but the screenshots could not be copied. ${errorMessage(copyResult.reason)} Paste them directly into the GitHub issue.`
            })
            return
        }
        setMessage({
            kind: 'success',
            text: screenshots.length > 0
                ? 'GitHub opened with your feedback. Paste once in the Screenshots section, then review and submit the issue.'
                : 'GitHub opened with your feedback. Review and submit the issue.'
        })
    }

    return <>
        <button
            type="button"
            className="feedback-trigger"
            aria-label="Send feedback"
            title="Send feedback"
            onClick={() => { setMessage(null); setOpen(true) }}
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" />
                <circle cx="9" cy="10" r="1" className="feedback-smile-fill" />
                <circle cx="15" cy="10" r="1" className="feedback-smile-fill" />
                <path d="M8.5 14c1.9 2 5.1 2 7 0" />
            </svg>
        </button>
        {open && <div className="feedback-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) setOpen(false)
        }}>
            <section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
                <form onSubmit={(event) => void submit(event)} onPaste={handlePaste}>
                    <header className="feedback-dialog-header">
                        <div>
                            <h2 id="feedback-title">Send feedback</h2>
                            <p>Create a GitHub issue for the TLC MultiAgent Assist team.</p>
                        </div>
                        <button type="button" className="feedback-close" aria-label="Close feedback" disabled={submitting} onClick={() => setOpen(false)}>x</button>
                    </header>
                    <div className="feedback-fields">
                        <label>
                            <span>Title</span>
                            <input
                                autoFocus
                                required
                                maxLength={200}
                                value={draft.title}
                                onChange={(event) => updateDraft('title', event.currentTarget.value)}
                            />
                        </label>
                        <label>
                            <span>Description</span>
                            <textarea
                                required
                                maxLength={2_000}
                                rows={4}
                                value={draft.description}
                                onChange={(event) => updateDraft('description', event.currentTarget.value)}
                            />
                        </label>
                        <label>
                            <span>Steps to reproduce <small>(optional)</small></span>
                            <textarea
                                maxLength={2_000}
                                rows={4}
                                placeholder={'1. Go to...\n2. Select...\n3. Observe...'}
                                value={draft.reproductionSteps}
                                onChange={(event) => updateDraft('reproductionSteps', event.currentTarget.value)}
                            />
                        </label>
                        <div
                            className="feedback-dropzone"
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={handleDrop}
                        >
                            <strong>Screenshots <small>(optional)</small></strong>
                            <span>Paste, drop, or choose up to {feedbackScreenshotLimit} images. Each image must be 5 MB or smaller.</span>
                            <label className="feedback-file-button">
                                Choose images
                                <input type="file" accept="image/*" multiple onChange={handleFileSelection} />
                            </label>
                        </div>
                        {screenshots.length > 0 && <div className="feedback-screenshots" aria-label="Selected screenshots">
                            {screenshots.map((screenshot) => <figure key={screenshot.id}>
                                <img src={screenshot.previewUrl} alt={screenshot.file.name} />
                                <figcaption title={screenshot.file.name}>{screenshot.file.name}</figcaption>
                                <button type="button" aria-label={`Remove ${screenshot.file.name}`} onClick={() => removeScreenshot(screenshot.id)}>Remove</button>
                            </figure>)}
                        </div>}
                        <p className="feedback-privacy">Do not include customer data, credentials, tokens, or other sensitive information.</p>
                        {screenshots.length > 0 && <p className="feedback-copy-note">
                            Screenshots stay local. Continue combines them into one clipboard image for you to paste into GitHub.
                        </p>}
                        {message && <p className={`feedback-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
                    </div>
                    <footer className="feedback-actions">
                        <button type="button" disabled={submitting} onClick={() => setOpen(false)}>Cancel</button>
                        <button type="submit" className="feedback-primary" disabled={submitting || !draft.title.trim() || !draft.description.trim()}>
                            {submitting ? 'Opening GitHub...' : 'Continue to GitHub'}
                        </button>
                    </footer>
                </form>
            </section>
        </div>}
    </>
}
