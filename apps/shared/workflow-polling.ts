const POLL_INTERVAL_MS = 300
const COMPLETION_GRACE_MS = 15_000

export async function pollWorkflow<T extends { run: { status: string } }>(
    read: () => Promise<T>,
    timeoutMs: number,
    onUpdate?: (view: T) => void
): Promise<T> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error('Workflow timeout must be a positive integer.')
    }
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => reject(new Error('The play timed out before completing.')), timeoutMs + COMPLETION_GRACE_MS)
    })
    try {
        for (;;) {
            const view = await Promise.race([read(), expired])
            onUpdate?.(view)
            if (view.run.status === 'completed' || view.run.status === 'failed' || view.run.status === 'cancelled') return view
            await Promise.race([
                new Promise<void>((resolve) => { pollTimer = setTimeout(resolve, POLL_INTERVAL_MS) }),
                expired
            ])
        }
    } finally {
        clearTimeout(deadlineTimer)
        clearTimeout(pollTimer)
    }
}
