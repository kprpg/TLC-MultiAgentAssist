import type { StagePipelineRequest, StagePipelineSnapshot } from '../common/contracts/stage-pipeline-review.js'
import {
    StagePipelineSourceError, type StagePipelineLoadContext, type StagePipelineLoader
} from '../connectors/msx/stage-pipeline.js'

export type CachedStagePipelineOptions = {
    now?: () => number
    ttlMs?: number
    maxEntries?: number
}

type Entry = { snapshot: StagePipelineSnapshot; loadedAt: number }

/**
 * Per-user in-memory cache in front of a live loader: TTL reads, single-flight reloads, and a visibly
 * stale last-good snapshot when a reload fails. Nothing is persisted.
 */
export class CachedStagePipelineLoader implements StagePipelineLoader {
    private readonly entries = new Map<string, Entry>()
    private readonly inflight = new Map<string, Promise<StagePipelineSnapshot>>()
    private readonly now: () => number
    private readonly ttlMs: number
    private readonly maxEntries: number

    constructor(private readonly inner: StagePipelineLoader, options: CachedStagePipelineOptions = {}) {
        this.now = options.now ?? Date.now
        this.ttlMs = options.ttlMs ?? 5 * 60_000
        this.maxEntries = options.maxEntries ?? 8
    }

    invalidate(): void {
        this.entries.clear()
    }

    async load(request: StagePipelineRequest, context: StagePipelineLoadContext = { fresh: false }): Promise<StagePipelineSnapshot> {
        const key = `${request.scope}|${[...(request.reportIds ?? [])].sort().join(',')}`
        const cached = this.entries.get(key)
        if (!context.fresh && cached && this.now() - cached.loadedAt < this.ttlMs) return cached.snapshot
        const running = this.inflight.get(key)
        if (running) return running
        const pending = this.reload(key, request, context, cached).finally(() => { this.inflight.delete(key) })
        this.inflight.set(key, pending)
        return pending
    }

    private async reload(key: string, request: StagePipelineRequest, context: StagePipelineLoadContext, previous: Entry | undefined): Promise<StagePipelineSnapshot> {
        try {
            const snapshot = await this.inner.load(request, context)
            this.entries.delete(key)
            this.entries.set(key, { snapshot, loadedAt: this.now() })
            while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string)
            return snapshot
        } catch (error) {
            if (!previous) throw error
            const reason = error instanceof StagePipelineSourceError ? error.message : 'The source returned an unexpected error.'
            return {
                ...previous.snapshot, state: 'stale',
                message: `Showing data generated ${previous.snapshot.generatedAt}. The latest refresh failed: ${reason}`
            }
        }
    }
}
