import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { hostingModelDeclaration, resolveHostingModel } from '../../../packages/common/configuration/hosting-model.js'
import { JsonFilePortfolioPreferenceStore } from '../../../packages/connectors/common/index.js'
import type { WorkflowDefinition } from '../../../packages/common/index.js'
import {
    SharedWorkflowHost, WorkflowRegistry, WorkflowRuntime, type WorkflowConnectorExecutor
} from '../../../packages/orchestrator/workflows/index.js'

const contractVersion = '1.0' as const
const definition: WorkflowDefinition = {
    contractVersion, id: 'WF-001', name: 'Pipeline review', version: '1.0.0', scope: 'portfolio',
    personaTargets: ['AE'], category: 'portfolio-hygiene', executionMode: 'deterministic',
    connectorPlan: [{ connector: 'dataverse-mcp', operation: 'read_query', required: true }],
    inputSchemaRef: 'wf-001.input.v1', outputSchemaRef: 'wf-001.output.v1',
    sla: { targetMs: 1_000, timeoutMs: 5_000 }, auth: { requiresDelegatedUser: true, allowedWrite: false },
    ui: { cardStyle: 'record-table', resultPriority: 'high', showInQuickLaunch: true }
}
const headers = {
    'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-ms-client-principal': 'principal',
    'x-ms-client-principal-name': 'seller@microsoft.com', 'x-ms-token-aad-access-token': 'delegated-token'
}

/** Each call models a separate process: a restart, or another replica that shares no memory. */
function newInstance() {
    const registry = new WorkflowRegistry([definition])
    const execute = vi.fn<WorkflowConnectorExecutor['execute']>(() => new Promise(() => undefined))
    let counter = 0
    const runtime = new WorkflowRuntime(registry, { execute }, { createId: () => `${String(++counter).padStart(8, '0')}-0000-4000-8000-00000000000a` })
    return new SharedWorkflowHost(registry, runtime)
}

describe('declared hosting model', () => {
    it('declares single-instance, process-local workflow state as the only supported model', () => {
        expect(hostingModelDeclaration).toMatchObject({ model: 'single-instance', workflowState: 'process-local', preferenceFiles: 'single-process' })
        expect(resolveHostingModel({})).toEqual(hostingModelDeclaration)
        expect(resolveHostingModel({ TLC_HOSTING_MODEL: 'single-instance' })).toEqual(hostingModelDeclaration)
        expect(resolveHostingModel({ TLC_HOSTING_MODEL: ' Single-Instance ' })).toEqual(hostingModelDeclaration)
    })

    it('fails closed for any unsupported or unrecognized model instead of silently running replicas', () => {
        for (const value of ['multi-instance', 'replicated', 'scale-out', 'x']) {
            expect(() => resolveHostingModel({ TLC_HOSTING_MODEL: value })).toThrowError(/single-instance/)
        }
        expect(() => resolveHostingModel({ TLC_HOSTING_MODEL: 'multi-instance' })).toThrowError(/shared workflow state/i)
    })
})

describe('start, poll and cancel when another instance or a restart does not hold the run', () => {
    let server: Server | undefined
    afterEach(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
        server = undefined
    })

    it('reports an unknown run explicitly through the host, never as an empty success', () => {
        const owner = newInstance()
        const run = owner.start({ contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' } })
        const otherReplica = newInstance()
        const request = { contractVersion, runId: run.runId }

        expect(() => otherReplica.get(request)).toThrowError(expect.objectContaining({ code: 'run_not_found' }))
        expect(() => otherReplica.cancel(request)).toThrowError(expect.objectContaining({ code: 'run_not_found' }))
        expect(otherReplica.listRuns({ contractVersion })).toEqual([])
        expect(owner.get(request).run.runId).toBe(run.runId)
        expect(owner.cancel(request).status).toBe('cancelled')
    })

    it('maps an unknown run to an explicit 404 over HTTP so clients can start fresh', async () => {
        const owner = newInstance()
        const run = owner.start({ contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' } })
        const restarted = newInstance()
        const handler = buildWebApiHandler({ createRuntime: () => ({}) as WebRuntime, resolveWorkflowHost: () => restarted })
        server = createServer((request, response) => void handler(request, response))
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Test server did not bind.')

        for (const operation of ['get', 'cancel']) {
            const response = await fetch(`http://127.0.0.1:${address.port}/api/workflows/${operation}`, {
                method: 'POST', headers, body: JSON.stringify({ contractVersion, runId: run.runId })
            })
            expect(response.status).toBe(404)
            expect(await response.json()).toMatchObject({ code: 'run_not_found', error: expect.stringContaining('not available') })
        }
    })

    it('exposes the number of active runs so cache management can protect in-flight work', () => {
        const host = newInstance()
        expect(host.activeRunCount()).toBe(0)
        const run = host.start({ contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' } })
        expect(host.activeRunCount()).toBe(1)
        host.cancel({ contractVersion, runId: run.runId })
        expect(host.activeRunCount()).toBe(0)
    })
})

describe('concurrent preference updates within the single process', () => {
    const directories: string[] = []
    afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })

    it('keeps every overlapping update and a consistent revision', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'tlc-hosting-model-'))
        directories.push(directory)
        const store = new JsonFilePortfolioPreferenceStore(join(directory, 'preferences.json'))
        const accounts = Array.from({ length: 25 }, (_, index) => `account-${index}`)

        await Promise.all([
            ...accounts.map((id) => store.addAccount('user-a', id)),
            ...accounts.map((id) => store.addAccount('user-b', id)),
            ...accounts.filter((_, index) => index % 2 === 0).map((id) => store.setVisibility('user-a', id, 'hidden'))
        ])

        const a = await store.read('user-a')
        const b = await store.read('user-b')
        expect(a.manualAccountIds).toEqual([...accounts].sort())
        expect(a.hiddenAccountIds).toEqual(accounts.filter((_, index) => index % 2 === 0).sort())
        expect(b.manualAccountIds).toEqual([...accounts].sort())
        expect(b.hiddenAccountIds).toEqual([])
        expect(a.revision).toBeGreaterThanOrEqual(accounts.length)
        expect(b.revision).toBe(accounts.length)
    })
})
