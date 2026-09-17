import { randomUUID } from 'node:crypto'
import {
    isWorkflowRunTransitionAllowed,
    scopeRefSchema,
    workflowRunSchema,
    type McpEvidenceLineage,
    type ScopeRef,
    type SourceHealth,
    type WorkflowDefinition,
    type WorkflowRun
} from '../../common/index.js'
import { WorkflowRunHistory } from '../progress/index.js'
import { WorkflowRegistry } from './registry.js'

type ConnectorStep = WorkflowDefinition['connectorPlan'][number]

export type WorkflowConnectorResult = {
    state: 'complete' | 'partial' | 'unauthorized'
    data: unknown
    rowCount: number
    truncated: boolean
    lineage?: McpEvidenceLineage
    sourceHealth?: SourceHealth
}

export type WorkflowConnectorExecutionContext = {
    runId: string
    workflowId: string
    correlationId: string
    scope: ScopeRef
    input: unknown
    signal: AbortSignal
}

export interface WorkflowConnectorExecutor {
    execute(step: ConnectorStep, context: WorkflowConnectorExecutionContext): Promise<WorkflowConnectorResult>
}

export type StartWorkflowRequest = {
    workflowId: string
    scope: ScopeRef
    input?: unknown
    correlationId?: string
}

export type WorkflowExecutionResult = {
    workflowId: string
    scope: ScopeRef
    steps: Array<{
        connector: ConnectorStep['connector']
        operation: string
        data: unknown
        lineage?: McpEvidenceLineage
        sourceHealth?: SourceHealth
    }>
    output?: unknown
}

export interface WorkflowResultAssembler {
    assemble(context: {
        definition: WorkflowDefinition
        scope: ScopeRef
        input: unknown
        steps: WorkflowExecutionResult['steps']
        generatedAt: string
    }): unknown
}

export type WorkflowStepErrorInfo = {
    workflowId: string
    connector: string
    operation: string
    required: boolean
    message: string
}

export type WorkflowRuntimeOptions = {
    historyCapacity?: number
    now?: () => number
    createId?: () => string
    resultAssembler?: WorkflowResultAssembler
    onStepError?: (info: WorkflowStepErrorInfo) => void
}

type Completion = {
    promise: Promise<WorkflowRun>
    resolve: (run: WorkflowRun) => void
}

export class WorkflowRuntime {
    private readonly history: WorkflowRunHistory
    private readonly results = new Map<string, WorkflowExecutionResult>()
    private readonly controllers = new Map<string, AbortController>()
    private readonly completions = new Map<string, Completion>()
    private readonly now: () => number
    private readonly createId: () => string
    private readonly resultAssembler: WorkflowResultAssembler | undefined
    private readonly onStepError: ((info: WorkflowStepErrorInfo) => void) | undefined

    constructor(
        private readonly registry: WorkflowRegistry,
        private readonly executor: WorkflowConnectorExecutor,
        options: WorkflowRuntimeOptions = {}
    ) {
        this.now = options.now ?? Date.now
        this.createId = options.createId ?? randomUUID
        this.resultAssembler = options.resultAssembler
        this.onStepError = options.onStepError
        this.history = new WorkflowRunHistory({
            ...(options.historyCapacity === undefined ? {} : { capacity: options.historyCapacity }),
            onEvicted: (run) => {
                this.results.delete(run.resultRef ?? '')
                this.controllers.delete(run.runId)
                this.completions.delete(run.runId)
            }
        })
    }

    start(request: StartWorkflowRequest): WorkflowRun {
        const definition = this.registry.get(request.workflowId)
        const scope = scopeRefSchema.parse(request.scope)
        if (definition.scope !== scope.kind) {
            throw new WorkflowRuntimeError('scope_mismatch', `Workflow ${definition.id} requires ${definition.scope} scope.`)
        }
        if (definition.executionMode === 'agentic') {
            throw new WorkflowRuntimeError('unsupported_execution_mode', 'This runtime does not execute agentic workflows.')
        }

        const runId = this.createId()
        const correlationId = request.correlationId ?? this.createId()
        const run = workflowRunSchema.parse({
            contractVersion: '1.0',
            runId,
            workflowId: definition.id,
            status: 'queued',
            scope,
            connectorCalls: [],
            telemetry: { correlationId, cacheHit: false }
        })
        this.history.set(run)
        this.controllers.set(runId, new AbortController())
        this.completions.set(runId, deferredCompletion())
        queueMicrotask(() => { void this.execute(runId, definition, request.input) })
        return run
    }

    get(runId: string): WorkflowRun | undefined {
        return this.history.get(runId)
    }

    list(scope?: ScopeRef, limit?: number): WorkflowRun[] {
        return this.history.list(scope, limit)
    }

    getResult(resultRef: string): WorkflowExecutionResult | undefined {
        const result = this.results.get(resultRef)
        return result ? structuredClone(result) : undefined
    }

    wait(runId: string): Promise<WorkflowRun> {
        const run = this.requireRun(runId)
        if (isTerminal(run.status)) return Promise.resolve(run)
        const completion = this.completions.get(runId)
        if (!completion) throw new WorkflowRuntimeError('run_not_found', `Workflow run ${runId} is not available.`)
        return completion.promise.then((completed) => structuredClone(completed))
    }

    cancel(runId: string): WorkflowRun {
        const run = this.requireRun(runId)
        if (isTerminal(run.status)) return run
        this.controllers.get(runId)?.abort(new WorkflowCancellationError())
        const timestamp = iso(this.now())
        const cancelled = this.transition(run, 'cancelled', {
            startedAt: run.startedAt ?? timestamp,
            completedAt: timestamp
        })
        this.finish(cancelled)
        return cancelled
    }

    private async execute(runId: string, definition: WorkflowDefinition, input: unknown): Promise<void> {
        const queued = this.history.get(runId)
        const controller = this.controllers.get(runId)
        if (!queued || !controller || queued.status !== 'queued') return

        const startedMs = this.now()
        let run = this.transition(queued, 'running', { startedAt: iso(startedMs) })
        const result: WorkflowExecutionResult = { workflowId: definition.id, scope: run.scope, steps: [] }
        const resultRef = `memory://workflow-runs/${runId}/result`
        let outcome: 'complete' | 'partial' | 'unauthorized' = 'complete'

        try {
            for (const step of definition.connectorPlan) {
                const callStarted = this.now()
                const stepAbort = linkedAbortController(controller.signal)
                try {
                    const connectorResult = await withTimeout(
                        this.executor.execute(step, {
                            runId,
                            workflowId: definition.id,
                            correlationId: run.telemetry.correlationId,
                            scope: run.scope,
                            input,
                            signal: stepAbort.controller.signal
                        }),
                        Math.max(0, definition.sla.timeoutMs - (this.now() - startedMs)),
                        stepAbort.controller
                    )
                    const current = this.history.get(runId)
                    if (!current || current.status !== 'running' || controller.signal.aborted) return
                    run = current
                    const status = connectorResult.state === 'complete' ? 'success' : connectorResult.state
                    run.connectorCalls.push({
                        connector: step.connector,
                        operation: step.operation,
                        status,
                        durationMs: Math.max(0, this.now() - callStarted),
                        recordCount: connectorResult.rowCount,
                        truncated: connectorResult.truncated
                    })
                    if (run.telemetry.firstResultMs === undefined && connectorResult.state !== 'unauthorized') {
                        run.telemetry.firstResultMs = Math.max(0, this.now() - startedMs)
                    }
                    result.steps.push({
                        connector: step.connector,
                        operation: step.operation,
                        data: connectorResult.data,
                        ...(connectorResult.lineage ? { lineage: connectorResult.lineage } : {}),
                        ...(connectorResult.sourceHealth ? { sourceHealth: connectorResult.sourceHealth } : {})
                    })
                    if (connectorResult.state === 'unauthorized') {
                        outcome = step.required ? 'unauthorized' : 'partial'
                    } else {
                        if (connectorResult.state === 'partial') outcome = 'partial'
                    }
                    if (this.resultAssembler && connectorResult.state !== 'unauthorized') {
                        result.output = this.resultAssembler.assemble({
                            definition,
                            scope: run.scope,
                            input,
                            steps: result.steps,
                            generatedAt: iso(this.now())
                        })
                        this.results.set(resultRef, structuredClone(result))
                        run = workflowRunSchema.parse({ ...run, resultRef })
                    }
                    this.history.set(run)
                    if (step.required && connectorResult.state === 'unauthorized') break
                } catch (error) {
                    const current = this.history.get(runId)
                    if (!current || current.status !== 'running') return
                    run = current
                    if (error instanceof WorkflowCancellationError || controller.signal.reason instanceof WorkflowCancellationError) return
                    const errorCode = getErrorCode(error)
                    const unauthorized = errorCode?.endsWith('_denied') || errorCode === 'unauthorized' || errorCode === 'scope_required'
                    this.onStepError?.({
                        workflowId: run.workflowId,
                        connector: step.connector,
                        operation: step.operation,
                        required: step.required ?? false,
                        message: error instanceof Error ? error.message : String(error)
                    })
                    run.connectorCalls.push({
                        connector: step.connector,
                        operation: step.operation,
                        status: unauthorized ? 'unauthorized' : 'failed',
                        durationMs: Math.max(0, this.now() - callStarted),
                        recordCount: 0,
                        truncated: false
                    })
                    this.history.set(run)
                    if (step.required) {
                        if (unauthorized) {
                            outcome = 'unauthorized'
                            break
                        }
                        const failed = this.transition(run, 'failed', { completedAt: iso(this.now()) })
                        this.finish(failed)
                        return
                    }
                    result.steps.push({
                        connector: step.connector,
                        operation: step.operation,
                        data: undefined,
                        sourceHealth: {
                            source: step.connector,
                            state: unauthorized ? 'unauthorized' : 'unavailable',
                            detail: unauthorized
                                ? `${step.connector} delegated authorization is unavailable.`
                                : `${step.connector} enrichment is temporarily unavailable.`,
                            checkedAt: iso(this.now())
                        }
                    })
                    outcome = 'partial'
                } finally {
                    stepAbort.dispose()
                }
            }

            const current = this.history.get(runId)
            if (!current || current.status !== 'running' || controller.signal.aborted) return
            if (this.resultAssembler) {
                result.output = this.resultAssembler.assemble({
                    definition,
                    scope: current.scope,
                    input,
                    steps: result.steps,
                    generatedAt: iso(this.now())
                })
            }
            this.results.set(resultRef, structuredClone(result))
            const completed = this.transition(current, 'completed', {
                completedAt: iso(this.now()),
                state: outcome,
                resultRef
            })
            this.finish(completed)
        } catch {
            const current = this.history.get(runId)
            if (!current || current.status !== 'running') return
            const failed = this.transition(current, 'failed', { completedAt: iso(this.now()) })
            this.finish(failed)
        }
    }

    private transition(run: WorkflowRun, status: WorkflowRun['status'], patch: Partial<WorkflowRun>): WorkflowRun {
        if (!isWorkflowRunTransitionAllowed(run.status, status)) {
            throw new WorkflowRuntimeError('invalid_transition', `Workflow run cannot transition from ${run.status} to ${status}.`)
        }
        const next = workflowRunSchema.parse({ ...run, ...patch, status })
        this.history.set(next)
        return next
    }

    private requireRun(runId: string): WorkflowRun {
        const run = this.history.get(runId)
        if (!run) throw new WorkflowRuntimeError('run_not_found', `Workflow run ${runId} is not available.`)
        return run
    }

    private finish(run: WorkflowRun): void {
        this.controllers.delete(run.runId)
        this.completions.get(run.runId)?.resolve(run)
    }
}

export class WorkflowRuntimeError extends Error {
    constructor(readonly code: 'scope_mismatch' | 'unsupported_execution_mode' | 'run_not_found' | 'invalid_transition' | 'result_not_available' | 'queue_item_not_found' | 'opportunity_scope_required' | 'invalid_evidence', message: string) {
        super(message)
        this.name = 'WorkflowRuntimeError'
    }
}

class WorkflowCancellationError extends Error {
    constructor() {
        super('Workflow execution was cancelled.')
        this.name = 'AbortError'
    }
}

class WorkflowTimeoutError extends Error {
    readonly code = 'timeout'
    constructor() {
        super('Workflow execution timed out.')
        this.name = 'TimeoutError'
    }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
    if (timeoutMs <= 0) {
        controller.abort(new WorkflowTimeoutError())
        return Promise.reject(new WorkflowTimeoutError())
    }
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            const error = new WorkflowTimeoutError()
            controller.abort(error)
            reject(error)
        }, timeoutMs)
        operation.then(
            (value) => { clearTimeout(timer); resolve(value) },
            (error: unknown) => { clearTimeout(timer); reject(error) }
        )
    })
}

function deferredCompletion(): Completion {
    let resolve!: (run: WorkflowRun) => void
    const promise = new Promise<WorkflowRun>((resolvePromise) => { resolve = resolvePromise })
    return { promise, resolve }
}

function getErrorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined
}

function isTerminal(status: WorkflowRun['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function iso(milliseconds: number): string {
    return new Date(milliseconds).toISOString()
}

function linkedAbortController(parent: AbortSignal): { controller: AbortController; dispose: () => void } {
    const controller = new AbortController()
    const abort = () => controller.abort(parent.reason)
    if (parent.aborted) abort()
    else parent.addEventListener('abort', abort, { once: true })
    return {
        controller,
        dispose: () => parent.removeEventListener('abort', abort)
    }
}