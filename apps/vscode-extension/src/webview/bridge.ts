interface VsCodeApi {
    postMessage(message: unknown): void
    getState<T>(): T | undefined
    setState<T>(state: T): void
}

declare function acquireVsCodeApi(): VsCodeApi

const vscodeApi: VsCodeApi = acquireVsCodeApi()

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

const pending = new Map<string, Pending>()
let counter = 0

window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { kind?: string; id?: string; ok?: boolean; result?: unknown; error?: { message?: string } } | null
    if (!data || data.kind !== 'response' || typeof data.id !== 'string') return
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (data.ok) entry.resolve(data.result)
    else entry.reject(new Error(data.error?.message ?? 'The request failed.'))
})

/** Send a validated request to the extension host and await its correlated response. */
export function request<T>(method: string, params?: unknown): Promise<T> {
    const id = `req-${counter += 1}`
    return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
        vscodeApi.postMessage({ kind: 'request', id, method, ...(params === undefined ? {} : { params }) })
    })
}

const streams = new Map<string, (event: unknown) => void>()

window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { kind?: string; id?: string; event?: unknown } | null
    if (!data || data.kind !== 'stream-event' || typeof data.id !== 'string') return
    streams.get(data.id)?.(data.event)
})

/** Start a progressive host request. `onEvent` receives raw events (validated by the caller); `cancel` aborts host-side. */
export function streamRequest(method: 'runAgentTaskStream', params: unknown, onEvent: (event: unknown) => void): { cancel(): void; end(): void } {
    const id = `stream-${counter += 1}`
    streams.set(id, onEvent)
    vscodeApi.postMessage({ kind: 'stream-request', id, method, params })
    return {
        cancel: () => vscodeApi.postMessage({ kind: 'stream-cancel', id }),
        end: () => { streams.delete(id) }
    }
}

export type HostEventMessage = { kind: 'event'; type: 'init' | 'modeChanged' | 'refresh'; payload: { mode: 'sample' | 'live'; userEmail?: string } }
export type HostFocusMessage = { kind: 'focus'; accountId?: string; opportunityId?: string }
export type HostRunPlayMessage = { kind: 'runPlay'; workflowId: string; token: number }

export function onHostMessage(handler: (message: HostEventMessage | HostFocusMessage | HostRunPlayMessage) => void): void {
    window.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { kind?: string } | null
        if (data && (data.kind === 'event' || data.kind === 'focus' || data.kind === 'runPlay')) {
            handler(data as HostEventMessage | HostFocusMessage | HostRunPlayMessage)
        }
    })
}

// Tell the host the webview is mounted and ready to receive focus/run messages.
vscodeApi.postMessage({ kind: 'ready' })

export { vscodeApi }
