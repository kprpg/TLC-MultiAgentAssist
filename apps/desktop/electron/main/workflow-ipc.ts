import type { WorkflowHost, WorkflowHostOperation } from '../../../../packages/orchestrator/workflows/index.js'
import { invokeWorkflowHost } from '../../../../packages/orchestrator/workflows/index.js'

export const workflowIpcChannels: Readonly<Record<WorkflowHostOperation, string>> = {
    list: 'tlc:workflow-list',
    start: 'tlc:workflow-start',
    get: 'tlc:workflow-get',
    cancel: 'tlc:workflow-cancel',
    history: 'tlc:workflow-history',
    guidance: 'tlc:workflow-guidance'
}

export function createWorkflowIpcHandlers(host: WorkflowHost): Readonly<Record<string, (request: unknown) => unknown>> {
    return Object.fromEntries(Object.entries(workflowIpcChannels).map(([operation, channel]) => [
        channel,
        (request: unknown) => invokeWorkflowHost(host, operation, request)
    ]))
}