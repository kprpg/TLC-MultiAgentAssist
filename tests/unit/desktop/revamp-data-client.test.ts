import { describe, expect, it, vi } from 'vitest'
import { createDataClient, createWebApiClient } from '../../../apps/desktop/renderer-revamp/src/data-client.js'
import { contractVersion } from '../../../packages/common/index.js'

describe('revamp live web data client', () => {
    it('uses the shared guidance envelope over the desktop IPC bridge', async () => {
        const handoff = {
            contractVersion,
            workflowId: 'WF-003',
            resultRef: 'result-1',
            capability: 'mcem-coach',
            scope: { kind: 'opportunity', accountId: 'account-1', opportunityId: 'opportunity-1' },
            prompt: 'Review the stage mismatch using evidence call-1.',
            context: { cardTitle: 'Stage mismatch', facts: [], evidenceIds: ['call-1'] }
        }
        const invokeWorkflow = vi.fn().mockResolvedValue(handoff)
        vi.stubGlobal('window', { tlc: { invokeWorkflow } })

        await expect(createDataClient('desktop').prepareWorkflowGuidance(
            '11111111-1111-4111-8111-111111111111', 'queue-1', 'mcem-coach'
        )).resolves.toEqual(handoff)
        expect(invokeWorkflow).toHaveBeenCalledWith('guidance', {
            contractVersion,
            runId: '11111111-1111-4111-8111-111111111111',
            queueItemId: 'queue-1',
            capability: 'mcem-coach'
        })
        vi.unstubAllGlobals()
    })

    it('uses the shared workflow envelopes for every lifecycle route', async () => {
        const runId = '11111111-1111-4111-8111-111111111111'
        const correlationId = '22222222-2222-4222-8222-222222222222'
        const definition = {
            contractVersion, id: 'WF-001', name: 'Pipeline review', version: '1.0.0', scope: 'portfolio',
            personaTargets: ['AE'], category: 'portfolio-hygiene', executionMode: 'deterministic',
            connectorPlan: [{ connector: 'dataverse-mcp', operation: 'read_query', required: true }],
            inputSchemaRef: 'wf-001.input.v1', outputSchemaRef: 'wf-001.output.v1',
            sla: { targetMs: 1_000, timeoutMs: 5_000 }, auth: { requiresDelegatedUser: true, allowedWrite: false },
            ui: { cardStyle: 'record-table', resultPriority: 'high', showInQuickLaunch: true }
        }
        const run = {
            contractVersion, runId, workflowId: 'WF-001', status: 'queued', scope: { kind: 'portfolio' },
            connectorCalls: [], telemetry: { correlationId, cacheHit: false }
        }
        const guidance = {
            contractVersion,
            workflowId: 'WF-003',
            resultRef: 'result-1',
            capability: 'mcem-coach',
            scope: { kind: 'opportunity', accountId: 'account-1', opportunityId: 'opportunity-1' },
            prompt: 'Review the stage mismatch using evidence call-1.',
            context: {
                cardTitle: 'Stage mismatch',
                queueItemId: 'queue-1',
                queueItemTitle: 'Resolve stage mismatch',
                facts: [{ label: 'Priority', value: 'P0' }],
                evidenceIds: ['call-1']
            }
        }
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
            const path = String(input)
            const payload = path.endsWith('/list') ? [definition]
                : path.endsWith('/get') ? { run }
                    : path.endsWith('/history') ? [run]
                        : path.endsWith('/guidance') ? guidance
                            : run
            return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
        })
        const client = createWebApiClient(fetcher)
        const startRequest = { contractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' as const }, input: {}, correlationId }

        await client.listWorkflowDefinitions('portfolio')
        await client.startWorkflow(startRequest)
        await client.getWorkflowRun(runId)
        await client.cancelWorkflowRun(runId)
        await client.listWorkflowRuns({ kind: 'portfolio' }, 10)
        await expect(client.prepareWorkflowGuidance(runId, 'queue-1', 'mcem-coach')).resolves.toEqual(guidance)

        expect(fetcher.mock.calls.map(([path, init]) => [path, init?.body])).toEqual([
            ['/api/workflows/list', JSON.stringify({ contractVersion, scope: 'portfolio' })],
            ['/api/workflows/start', JSON.stringify(startRequest)],
            ['/api/workflows/get', JSON.stringify({ contractVersion, runId })],
            ['/api/workflows/cancel', JSON.stringify({ contractVersion, runId })],
            ['/api/workflows/history', JSON.stringify({ contractVersion, scope: { kind: 'portfolio' }, limit: 10 })],
            ['/api/workflows/guidance', JSON.stringify({ contractVersion, runId, queueItemId: 'queue-1', capability: 'mcem-coach' })]
        ])
    })

    it('downloads the rich email draft returned by the web host', async () => {
        const click = vi.fn()
        const anchor = { href: '', download: '', click }
        const createObjectURL = vi.fn(() => 'blob:email-draft')
        const revokeObjectURL = vi.fn()
        vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('MIME-Version: 1.0', {
            status: 200,
            headers: { 'content-type': 'message/rfc822', 'x-tlc-file-name': 'Account guidance.eml' }
        }))

        await expect(createWebApiClient(fetcher).openEmailCompose({
            contractVersion,
            recipients: ['seller@example.com'],
            subject: 'Account guidance',
            responseTitle: 'Account Pulse',
            responseMarkdown: '## Guidance'
        })).resolves.toEqual({ state: 'opened' })

        expect(anchor.download).toBe('Account guidance.eml')
        expect(click).toHaveBeenCalledOnce()
        expect(createObjectURL).toHaveBeenCalledOnce()
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:email-draft')
        vi.unstubAllGlobals()
    })

    it('retrieves the authenticated email used to pre-populate email recipients', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
            JSON.stringify({ email: 'signed-in-user@microsoft.com' }),
            { status: 200, headers: { 'content-type': 'application/json' } }
        ))

        await expect(createWebApiClient(fetcher).getCurrentUserEmail()).resolves.toBe('signed-in-user@microsoft.com')
        expect(fetcher).toHaveBeenCalledWith('/api/me', expect.objectContaining({ credentials: 'same-origin' }))
    })

    it('uses the same-origin account API and validates its response', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
            { id: 'account-1', name: 'Account One', segment: 'Enterprise' }
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))

        const result = await createWebApiClient(fetcher).listAccounts()

        expect(result).toEqual([{ id: 'account-1', name: 'Account One', segment: 'Enterprise' }])
        expect(fetcher).toHaveBeenCalledWith('/api/accounts', expect.objectContaining({ credentials: 'same-origin' }))
    })

    it('encodes account identifiers and surfaces sanitized API errors', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
            JSON.stringify({ error: 'MSX access is not authorized.' }),
            { status: 403, headers: { 'content-type': 'application/json' } }
        ))

        await expect(createWebApiClient(fetcher).listOpportunities('account/one'))
            .rejects.toThrow('MSX access is not authorized.')
        expect(fetcher).toHaveBeenCalledWith('/api/accounts/account%2Fone/opportunities', expect.any(Object))
    })

    it('retrieves and validates milestones from the authenticated web API', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{
            id: 'milestone-1', opportunityId: 'opportunity-1', name: 'Customer pilot', status: 'On track'
        }]), { status: 200, headers: { 'content-type': 'application/json' } }))

        await expect(createWebApiClient(fetcher).listMilestones('opportunity/one')).resolves.toEqual([
            { id: 'milestone-1', opportunityId: 'opportunity-1', name: 'Customer pilot', status: 'On track' }
        ])
        expect(fetcher).toHaveBeenCalledWith('/api/opportunities/opportunity%2Fone/milestones', expect.any(Object))
    })

    it('requests a same-origin application exit from the web host', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
            JSON.stringify({ state: 'exiting' }),
            { status: 202, headers: { 'content-type': 'application/json' } }
        ))

        await createWebApiClient(fetcher).exitApplication()

        expect(fetcher).toHaveBeenCalledWith('/api/exit', expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin'
        }))
    })

    it('posts governed stage transitions with the shared contract', async () => {
        const result = {
            opportunity: { id: 'opportunity-1', accountId: 'account-1', name: 'Pilot', recordedStage: 1, value: 100, currency: 'USD', closeDate: '2026-10-01' },
            previousStage: 2,
            targetStage: 1,
            disposition: 'recycled',
            auditNote: 'Recycled to Stage 1 because customer scope changed.'
        }
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }))

        await expect(createWebApiClient(fetcher).transitionOpportunityStage(
            'account-1', 'opportunity-1', 1, 'Customer scope changed materially.'
        )).resolves.toEqual(result)

        expect(fetcher).toHaveBeenCalledWith('/api/mcem-stage-transition', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ contractVersion, accountId: 'account-1', opportunityId: 'opportunity-1', targetStage: 1, reason: 'Customer scope changed materially.' })
        }))
    })

    it('dispatches the selected prompt without replacing it with generic guidance', async () => {
        const response = {
            contractVersion,
            correlationId: '4df83249-8309-46a7-a78b-0af491ef497f',
            capability: 'account-pulse',
            agentVersion: '1.0.0',
            generatedAt: '2026-04-01T12:00:00.000Z',
            mode: 'live',
            state: 'complete',
            content: 'Grounded response',
            sourceHealth: [{ source: 'msx', state: 'live', detail: 'Ready', checkedAt: '2026-04-01T12:00:00.000Z' }]
        }
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }))

        await createWebApiClient(fetcher).runAgentTask('account-pulse', 'account-1', 'opportunity-1', 'Show milestone drift.')

        expect(fetcher).toHaveBeenCalledWith('/api/agent-task', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ contractVersion, capability: 'account-pulse', accountId: 'account-1', opportunityId: 'opportunity-1', prompt: 'Show milestone drift.' })
        }))
    })
})