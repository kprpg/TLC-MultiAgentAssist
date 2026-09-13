import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { createWorkflowIpcHandlers, workflowIpcChannels } from '../../../apps/desktop/electron/main/workflow-ipc.js'
import type { WorkflowDefinition } from '../../../packages/common/index.js'
import {
    SharedWorkflowHost,
    WorkflowRegistry,
    WorkflowRuntime,
    type WorkflowConnectorExecutor
} from '../../../packages/orchestrator/workflows/index.js'

const contractVersion = '1.0' as const
const runId = '11111111-1111-4111-8111-111111111111'
const correlationId = '22222222-2222-4222-8222-222222222222'
const definition: WorkflowDefinition = {
    contractVersion, id: 'WF-001', name: 'Pipeline review', version: '1.0.0', scope: 'portfolio',
    personaTargets: ['AE'], category: 'portfolio-hygiene', executionMode: 'deterministic',
    connectorPlan: [{ connector: 'dataverse-mcp', operation: 'read_query', required: true }],
    inputSchemaRef: 'wf-001.input.v1', outputSchemaRef: 'wf-001.output.v1',
    sla: { targetMs: 1_000, timeoutMs: 5_000 }, auth: { requiresDelegatedUser: true, allowedWrite: false },
    ui: { cardStyle: 'record-table', resultPriority: 'high', showInQuickLaunch: true }
}
const authenticationHeaders = {
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
    'x-ms-client-principal': 'principal-1',
    'x-ms-client-principal-name': 'seller@microsoft.com',
    'x-ms-token-aad-access-token': 'delegated-token'
}

function runtimeStub(): WebRuntime {
    return {
        listAccounts: vi.fn(), listOpportunities: vi.fn(), listMilestones: vi.fn(),
        updateMilestone: vi.fn(), updateOpportunity: vi.fn(), transitionOpportunityStage: vi.fn(),
        runMcemCoach: vi.fn(), runAgentTask: vi.fn()
    }
}

function harness(state: 'partial' | 'pending' = 'partial') {
    const registry = new WorkflowRegistry([definition])
    const execute = state === 'pending'
        ? vi.fn<WorkflowConnectorExecutor['execute']>(() => new Promise(() => undefined))
        : vi.fn<WorkflowConnectorExecutor['execute']>().mockResolvedValue({
            state: 'partial', data: [{ rawRestrictedValue: 'never-return' }], rowCount: 1, truncated: true,
            lineage: { connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'call-1' },
            sourceHealth: { source: 'dataverse-mcp', state: 'partial', detail: 'Truncated.', checkedAt: '2026-09-12T10:00:00.000Z' }
        })
    const runtime = new WorkflowRuntime(registry, { execute }, {
        now: () => Date.parse('2026-09-12T10:00:00.000Z'),
        createId: () => runId,
        resultAssembler: {
            assemble: () => ({
                contractVersion, workflowId: 'WF-001', generatedAt: '2026-09-12T10:00:00.000Z',
                scope: { kind: 'portfolio' },
                card: { kind: 'record-table', title: 'Pipeline review', evidenceIds: ['call-1'], columns: ['Name'], rows: [{ Name: 'Visible' }] },
                queueItems: [],
                lineage: [{ connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'call-1' }],
                sourceHealth: [{ source: 'dataverse-mcp', state: 'partial', detail: 'Truncated.', checkedAt: '2026-09-12T10:00:00.000Z' }]
            })
        }
    })
    return { host: new SharedWorkflowHost(registry, runtime), runtime }
}

describe('workflow trusted-host parity', () => {
    let server: Server | undefined
    afterEach(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
        server = undefined
    })

    it('returns identical validated partial results and bounded history over IPC and HTTP', async () => {
        const desktop = harness()
        const web = harness()
        const ipc = createWorkflowIpcHandlers(desktop.host)
        const resolveWorkflowHost = vi.fn(() => web.host)
        const createRuntime = vi.fn(() => runtimeStub())
        const baseUrl = await listen(buildWebApiHandler({ createRuntime, resolveWorkflowHost }))
        const startRequest = { contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' as const }, input: {}, correlationId }

        const desktopQueued = ipc[workflowIpcChannels.start]!(startRequest)
        const webQueued = await post(baseUrl, 'start', startRequest)
        expect(webQueued).toEqual(desktopQueued)

        await Promise.all([desktop.runtime.wait(runId), web.runtime.wait(runId)])
        const request = { contractVersion, runId }
        const desktopView = ipc[workflowIpcChannels.get]!(request)
        const webView = await post(baseUrl, 'get', request)
        expect(webView).toEqual(desktopView)
        expect(webView).toMatchObject({ run: { state: 'partial', status: 'completed' } })
        expect(JSON.stringify(webView)).not.toContain('rawRestrictedValue')

        const historyRequest = { contractVersion, limit: 1 }
        expect(await post(baseUrl, 'history', historyRequest)).toEqual(ipc[workflowIpcChannels.history]!(historyRequest))
        expect(createRuntime).not.toHaveBeenCalled()
    })

    it('requires authentication, rejects malformed envelopes, and carries cancellation through both hosts', async () => {
        const desktop = harness('pending')
        const web = harness('pending')
        const ipc = createWorkflowIpcHandlers(desktop.host)
        const baseUrl = await listen(buildWebApiHandler({ createRuntime: () => runtimeStub(), resolveWorkflowHost: () => web.host }))

        const unauthenticated = await fetch(`${baseUrl}/api/workflows/list`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contractVersion })
        })
        expect(unauthenticated.status).toBe(401)

        const malformed = await fetch(`${baseUrl}/api/workflows/start`, {
            method: 'POST', headers: authenticationHeaders, body: JSON.stringify({ contractVersion, workflowId: 'bad' })
        })
        expect(malformed.status).toBe(400)
        expect(() => ipc[workflowIpcChannels.start]!({ contractVersion, workflowId: 'bad' })).toThrow()

        const startRequest = { contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' as const }, correlationId }
        ipc[workflowIpcChannels.start]!(startRequest)
        await post(baseUrl, 'start', startRequest)
        await Promise.resolve()
        const cancelRequest = { contractVersion, runId }
        expect(await post(baseUrl, 'cancel', cancelRequest)).toEqual(ipc[workflowIpcChannels.cancel]!(cancelRequest))
    })

    async function post(baseUrl: string, operation: string, body: unknown): Promise<unknown> {
        const response = await fetch(`${baseUrl}/api/workflows/${operation}`, {
            method: 'POST', headers: authenticationHeaders, body: JSON.stringify(body)
        })
        expect(response.status).toBe(200)
        return response.json()
    }

    function listen(handler: ReturnType<typeof buildWebApiHandler>): Promise<string> {
        server = createServer((request, response) => void handler(request, response))
        return new Promise((resolve) => {
            server!.listen(0, '127.0.0.1', () => {
                const address = server!.address()
                if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP.')
                resolve(`http://127.0.0.1:${address.port}`)
            })
        })
    }
})
