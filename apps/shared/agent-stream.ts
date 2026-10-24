import type { AgentTaskResponse, AgentTaskStreamEvent, SourceHealth } from '../../packages/common/contracts/index.js'
import { contractVersion } from '../../packages/common/contracts/version.js'

/** Browser-safe accumulator shared by every UI. No Node built-ins. */
export interface AgentStreamProgress {
    /** `draft`: instant evidence-based draft shown while the model works; `streaming`: model text arriving. */
    phase: 'draft' | 'streaming'
    content: string
    sourceHealth: SourceHealth[]
}

export class AgentStreamError extends Error {
    constructor(readonly code: 'failed' | 'timeout' | 'cancelled', message: string) {
        super(message)
        this.name = 'AgentStreamError'
    }
}

export function createAgentStreamAccumulator(onProgress?: (progress: AgentStreamProgress) => void) {
    let sourceHealth: SourceHealth[] = []
    let text = ''
    let response: AgentTaskResponse | undefined
    return {
        push(event: AgentTaskStreamEvent): void {
            switch (event.type) {
                case 'context':
                    sourceHealth = event.sourceHealth
                    onProgress?.({ phase: 'draft', content: event.instantDraft, sourceHealth })
                    break
                case 'delta':
                    text += event.text
                    onProgress?.({ phase: 'streaming', content: text, sourceHealth })
                    break
                case 'complete':
                    response = event.response
                    break
                case 'error':
                    throw new AgentStreamError(event.code, event.message)
            }
        },
        /** The authoritative response; throws if the stream ended without one. */
        result(): AgentTaskResponse {
            if (!response) throw new AgentStreamError('failed', 'The agent response ended before it completed.')
            return response
        }
    }
}

/** Placeholder response shape used to render in-progress content through the existing result view. */
export function progressToResponse(progress: AgentStreamProgress, capability: AgentTaskResponse['capability']): AgentTaskResponse {
    return {
        contractVersion,
        correlationId: '00000000-0000-4000-8000-000000000000',
        capability,
        agentVersion: 'streaming',
        generatedAt: new Date().toISOString(),
        mode: progress.sourceHealth.some((item) => item.state === 'sample') ? 'sample' : 'live',
        state: 'partial',
        content: progress.content,
        sourceHealth: progress.sourceHealth
    } as AgentTaskResponse
}

/** Reads newline-delimited JSON from a fetch body, invoking `onLine` per parsed line (heartbeat blanks ignored). */
export async function readNdjson(body: ReadableStream<Uint8Array>, onLine: (value: unknown) => void, signal?: AbortSignal): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    const flush = (line: string) => { if (line.trim()) onLine(JSON.parse(line)) }
    try {
        for (;;) {
            if (signal?.aborted) throw new AgentStreamError('cancelled', 'The request was cancelled.')
            const { done, value } = await reader.read()
            if (done) break
            buffered += decoder.decode(value, { stream: true })
            let newline = buffered.indexOf('\n')
            while (newline >= 0) {
                flush(buffered.slice(0, newline))
                buffered = buffered.slice(newline + 1)
                newline = buffered.indexOf('\n')
            }
        }
        flush(buffered + decoder.decode())
    } finally {
        reader.releaseLock()
    }
}
