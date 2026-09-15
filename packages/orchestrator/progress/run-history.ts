import { workflowRunSchema, type ScopeRef, type WorkflowRun } from '../../common/index.js'

export type WorkflowRunHistoryOptions = {
    capacity?: number
    onEvicted?: (run: WorkflowRun) => void
}

export class WorkflowRunHistory {
    private readonly runs = new Map<string, WorkflowRun>()
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
        if (!this.runs.has(validated.runId) && this.runs.size >= this.capacity) {
            const oldestRunId = this.runs.keys().next().value as string | undefined
            if (oldestRunId) {
                const evicted = this.runs.get(oldestRunId)
                this.runs.delete(oldestRunId)
                if (evicted) this.onEvicted?.(structuredClone(evicted))
            }
        }
        this.runs.set(validated.runId, structuredClone(validated))
    }

    get(runId: string): WorkflowRun | undefined {
        const run = this.runs.get(runId)
        return run ? structuredClone(run) : undefined
    }

    list(scope?: ScopeRef, limit = this.capacity): WorkflowRun[] {
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