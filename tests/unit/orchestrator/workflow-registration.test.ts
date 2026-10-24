import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { workflowRunViewSchema } from '../../../packages/common/contracts/workflow-output.js'
import type { WorkflowDefinition } from '../../../packages/common/index.js'
import {
    composeWorkflows, invokeWorkflowHost, SharedWorkflowHost, WorkflowRegistry, WorkflowRuntime,
    type WorkflowConnectorExecutor, type WorkflowRegistration, type WorkflowResultAssembler
} from '../../../packages/orchestrator/workflows/index.js'

const contractVersion = '1.0' as const
const now = '2026-09-12T10:00:00.000Z'
const baseDefinition = (id: string, name: string): WorkflowDefinition => ({
    contractVersion, id, name, version: '1.0.0', scope: 'portfolio', personaTargets: ['AE'], category: 'portfolio-hygiene',
    executionMode: 'deterministic', connectorPlan: [{ connector: 'dataverse-mcp', operation: 'read_query', required: true }],
    inputSchemaRef: `${id.toLowerCase()}.input.v1`, outputSchemaRef: `${id.toLowerCase()}.output.v1`,
    sla: { targetMs: 1_000, timeoutMs: 5_000 }, auth: { requiresDelegatedUser: true, allowedWrite: false },
    ui: { cardStyle: 'record-table', resultPriority: 'high', showInQuickLaunch: true }
})
const initialOutput = {
    contractVersion, workflowId: 'WF-001', generatedAt: now, scope: { kind: 'portfolio' },
    card: { kind: 'record-table', title: 'Pipeline review', evidenceIds: ['call-1'], columns: ['Name'], rows: [{ Name: 'Visible' }] },
    queueItems: [], lineage: [{ connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'call-1' }],
    sourceHealth: [{ source: 'dataverse-mcp', state: 'live', detail: 'Live.', checkedAt: now }]
}
const renewalOutputSchema = z.object({ renewalWindowDays: z.number().int().positive(), accounts: z.array(z.string()) }).strict()

function renewalRegistration(output: unknown = { renewalWindowDays: 90, accounts: ['Contoso'] }) {
    const execute = vi.fn<WorkflowConnectorExecutor['execute']>().mockResolvedValue({ state: 'complete', data: [{ name: 'Contoso' }], rowCount: 1, truncated: false })
    const assembler: WorkflowResultAssembler = { assemble: vi.fn(() => output) }
    const registration: WorkflowRegistration = {
        definition: baseDefinition('WF-101', 'Renewal readiness'), executor: { execute }, assembler, outputSchema: renewalOutputSchema
    }
    return { registration, execute, assembler }
}

function build(registrations: WorkflowRegistration[]) {
    const baseExecute = vi.fn<WorkflowConnectorExecutor['execute']>().mockResolvedValue({ state: 'complete', data: [{ id: 'a' }], rowCount: 1, truncated: false })
    const baseAssemble = vi.fn(() => initialOutput)
    const composition = composeWorkflows({
        definitions: [baseDefinition('WF-001', 'Pipeline review')], executor: { execute: baseExecute }, assembler: { assemble: baseAssemble }
    }, registrations)
    const registry = new WorkflowRegistry(composition.definitions)
    const runtime = new WorkflowRuntime(registry, composition.executor, { resultAssembler: composition.assembler })
    return { host: new SharedWorkflowHost(registry, runtime, composition.outputs), runtime, baseExecute, baseAssemble }
}

describe('workflow registration seam', () => {
    let server: Server | undefined
    afterEach(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
        server = undefined
    })
    const start = (workflowId: string) => ({ contractVersion, workflowId, scope: { kind: 'portfolio' } })

    it('runs a distinct approved workflow shape through the unchanged shared transport functions', async () => {
        const { registration, execute } = renewalRegistration()
        const { host, runtime, baseExecute } = build([registration])

        expect(host.listDefinitions({ contractVersion }).map(({ id }) => id)).toEqual(['WF-001', 'WF-101'])
        const run = invokeWorkflowHost(host, 'start', start('WF-101')) as { runId: string }
        await runtime.wait(run.runId)
        const view = workflowRunViewSchema.parse(invokeWorkflowHost(host, 'get', { contractVersion, runId: run.runId }))

        expect(view.output).toBeUndefined()
        expect(view.extensionOutput).toEqual({
            workflowId: 'WF-101', outputSchemaRef: 'wf-101.output.v1', data: { renewalWindowDays: 90, accounts: ['Contoso'] }
        })
        expect(execute).toHaveBeenCalledOnce()
        expect(baseExecute).not.toHaveBeenCalled()
    })

    it('leaves existing workflows on their original executor, assembler, and output shape', async () => {
        const { registration, execute, assembler } = renewalRegistration()
        const { host, runtime, baseExecute, baseAssemble } = build([registration])

        const run = invokeWorkflowHost(host, 'start', start('WF-001')) as { runId: string }
        await runtime.wait(run.runId)
        const view = workflowRunViewSchema.parse(invokeWorkflowHost(host, 'get', { contractVersion, runId: run.runId }))

        expect(view.output).toMatchObject({ workflowId: 'WF-001' })
        expect(view.extensionOutput).toBeUndefined()
        expect(baseExecute).toHaveBeenCalledOnce()
        expect(baseAssemble).toHaveBeenCalled()
        expect(execute).not.toHaveBeenCalled()
        expect(assembler.assemble).not.toHaveBeenCalled()
    })

    it('fails the run instead of publishing output that violates the approved schema', async () => {
        const { registration } = renewalRegistration({ renewalWindowDays: -5, accounts: [], unexpected: true })
        const { host, runtime } = build([registration])

        const run = invokeWorkflowHost(host, 'start', start('WF-101')) as { runId: string }
        const finished = await runtime.wait(run.runId)

        expect(finished.status).toBe('failed')
        expect(workflowRunViewSchema.parse(invokeWorkflowHost(host, 'get', { contractVersion, runId: run.runId })).extensionOutput).toBeUndefined()
    })

    it('rejects colliding or malformed registrations before any run can start', () => {
        const { registration } = renewalRegistration()
        const base = { definitions: [baseDefinition('WF-001', 'Pipeline review')], executor: { execute: vi.fn() }, assembler: { assemble: vi.fn() } }
        const collidingWithBase = { ...registration, definition: baseDefinition('WF-001', 'Impostor') }

        expect(() => composeWorkflows(base, [collidingWithBase])).toThrowError(/WF-001/)
        expect(() => composeWorkflows(base, [registration, registration])).toThrowError(/WF-101/)
        expect(() => composeWorkflows(base, [{ ...registration, definition: { ...registration.definition, executionMode: 'agentic' } }])).toThrowError(/agentic/i)
        expect(() => composeWorkflows(base, [{ ...registration, definition: { ...registration.definition, auth: { requiresDelegatedUser: true, allowedWrite: true } } }])).toThrowError(/read-only/i)
    })

    it('does not offer guidance handoff for a workflow whose shape has no queue items', async () => {
        const { registration } = renewalRegistration()
        const { host, runtime } = build([registration])
        const run = invokeWorkflowHost(host, 'start', start('WF-101')) as { runId: string }
        await runtime.wait(run.runId)

        expect(() => host.prepareGuidance({ contractVersion, runId: run.runId, queueItemId: 'x', capability: 'account-pulse' }))
            .toThrowError(expect.objectContaining({ code: 'result_not_available' }))
    })

    it('serves the registered workflow over the unchanged Web transport', async () => {
        const { registration } = renewalRegistration()
        const { host, runtime } = build([registration])
        const handler = buildWebApiHandler({ createRuntime: () => ({}) as WebRuntime, resolveWorkflowHost: () => host })
        server = createServer((request, response) => void handler(request, response))
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
        const headers = {
            'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-ms-client-principal': 'principal',
            'x-ms-client-principal-name': 'seller@microsoft.com', 'x-ms-token-aad-access-token': 'delegated-token'
        }
        const post = async (operation: string, body: unknown) => (await fetch(`http://127.0.0.1:${address.port}/api/workflows/${operation}`, {
            method: 'POST', headers, body: JSON.stringify(body)
        })).json()

        const run = await post('start', start('WF-101')) as { runId: string }
        await runtime.wait(run.runId)
        expect(await post('get', { contractVersion, runId: run.runId })).toMatchObject({
            extensionOutput: { workflowId: 'WF-101', data: { accounts: ['Contoso'] } }
        })
    })
})
