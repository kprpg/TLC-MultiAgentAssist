import { workflowRunSchema, type ScopeRef, type WorkflowRun } from '../../common/index.js'

export type WorkflowRunHistoryOptions = {
    /** Maximum number of finished runs retained. Queued and running runs are never evicted. */
    capacity?: number
    onEvicted?: (run: WorkflowRun) => void
}

function isFinished(run: WorkflowRun): boolean {
    return run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'
}

export class WorkflowRunHistory {
    private readonly runs = new Map<string, WorkflowRun>()
    /** Ids of finished runs in the order they finished; the front is evicted first. */
    private readonly finished: string[] = []
    private readonly capacity: number
    private readonly onEvicted: ((run: WorkflowRun) => void) | undefined

    constructor(options: WorkflowRunHistoryOptions = {}) {
        this.capacity = options.capacity ?? 100
        if (!Number.isInteger(this.capacity) || this.capacity < 1) {
            throw new Error('Workflow run history capacity must be a positive integer.')
        }
        this.onEvicted = options.onEvicted
    }

    set(run: WorkflowRun): void {
        const validated = workflowRunSchema.parse(run)
        const previous = this.runs.get(validated.runId)
        this.runs.set(validated.runId, structuredClone(validated))
        if (isFinished(validated) && !(previous && isFinished(previous))) this.finished.push(validated.runId)
        while (this.finished.length > this.capacity) {
            const evictedRunId = this.finished.shift()!
            const evicted = this.runs.get(evictedRunId)
            this.runs.delete(evictedRunId)
            if (evicted) this.onEvicted?.(structuredClone(evicted))
        }
    }

    /** Number of queued or running runs, which retention never removes. */
    activeCount(): number {
        return this.runs.size - this.finished.length
    }

    get(runId: string): WorkflowRun | undefined {
        const run = this.runs.get(runId)
        return run ? structuredClone(run) : undefined
    }

    list(scope?: ScopeRef, limit: number = Number.MAX_SAFE_INTEGER): WorkflowRun[] {
        if (!Number.isInteger(limit) || limit < 1) throw new Error('Workflow run history limit must be a positive integer.')
        return [...this.runs.values()]
            .filter((run) => scope === undefined || sameScope(run.scope, scope))
            .reverse()
            .slice(0, limit)
            .map((run) => structuredClone(run))
    }
}

function sameScope(left: ScopeRef, right: ScopeRef): boolean {
    if (left.kind !== right.kind) return false
    if (left.kind === 'portfolio' && right.kind === 'portfolio') return true
    if (left.kind === 'account' && right.kind === 'account') return left.accountId === right.accountId
    return left.kind === 'opportunity' && right.kind === 'opportunity' &&
        left.accountId === right.accountId && left.opportunityId === right.opportunityId
}