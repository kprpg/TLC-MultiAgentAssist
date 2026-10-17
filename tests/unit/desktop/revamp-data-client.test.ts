import { describe, expect, it, vi } from 'vitest'
import { createDataClient, createWebApiClient } from '../../../apps/desktop/renderer-revamp/src/data-client.js'
import { contractVersion, workflowContractVersion } from '../../../packages/common/index.js'
import { LocalStore } from '../../../packages/connectors/local-store/index.js'
import { LocalStoreRecordCreation } from '../../../packages/connectors/local-store/record-creation.js'
import { SAMPLE_USER_ID } from '../../../packages/connectors/local-store/seed.js'

describe('revamp live web data client', () => {
    it('reports the search data mode from the existing host configuration', async () => {
        await expect(createWebApiClient().getDataMode()).resolves.toBe('live')
        const bridge = { getDataStatus: vi.fn().mockResolvedValue({ mode: 'sample', auth: { state: 'ready' } }) }
        vi.stubGlobal('window', { tlc: bridge })
        try {
            await expect(createDataClient('desktop').getDataMode()).resolves.toBe('sample')
            bridge.getDataStatus.mockResolvedValue({ mode: 'live', auth: { state: 'ready' } })
            await expect(createDataClient('desktop').getDataMode()).resolves.toBe('live')
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('sends versioned preview, confirmation and draft requests over the Web and Desktop bridges', async () => {
        const store = new LocalStore()
        try {
            const catalog = new LocalStoreRecordCreation(store, SAMPLE_USER_ID).getCatalog('account-contoso')
            const parent = catalog.opportunities.find((item) => item.id === 'opp-grid-modernization')!
            expect(parent.currency).toMatchObject({ isoCode: 'USD' })
            const draft = {
                kind: 'existing-opportunity-milestone-batch' as const,
                account: catalog.account,
                opportunity: { id: parent.id, label: parent.label },
                milestones: [{
                    clientMilestoneKey: 'ms-new',
                    name: 'Pilot',
                    category: catalog.choices.category[0]!,
                    milestoneDate: '2027-02-15',
                    workload: catalog.workloads[0]!
                }]
            }
            const preview = {
                contractVersion, batchId: 'batch-1', digest: 'a'.repeat(64),
                target: 'draft' as const, catalogRevision: catalog.revision, normalizedDraft: draft,
                mutationCount: 1, warnings: ['Draft only.'], expiresAt: '2027-02-01T00:00:00.000Z'
            }
            const result = {
                contractVersion, batchId: 'batch-1', target: 'draft' as const, state: 'drafted' as const, created: [],
                audit: { correlationId: 'batch-1', opportunityCount: 0, milestoneCount: 1 },
                message: 'Draft created. No Opportunity or Milestone was written to MSX.'
            }
            const exported = {
                contractVersion, result,
                files: [{ name: 'creation-manifest.json', content: '{}', mimeType: 'application/json' }]
            }
            const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
                const path = String(input)
                const body = path.includes('/catalog') ? catalog : path.includes('/preview') ? preview : path.includes('/draft') ? exported : result
                return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
            })
            const web = createWebApiClient(fetcher)
            await expect(web.getRecordCreationCatalog('account-contoso')).resolves.toEqual(catalog)
            await expect(web.previewRecordCreation('draft', draft)).resolves.toEqual(preview)
            await expect(web.commitRecordCreation(preview)).resolves.toEqual(result)
            await expect(web.exportRecordCreationDraft(preview)).resolves.toEqual(exported)
            expect(fetcher.mock.calls.map(([path]) => String(path))).toEqual([
                '/api/record-creation/catalog?accountId=account-contoso',
                '/api/record-creation/preview', '/api/record-creation/commit', '/api/record-creation/draft'
            ])
            expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({ contractVersion, target: 'draft', draft })
            expect(JSON.parse(String(fetcher.mock.calls[2]![1]?.body))).toEqual({
                contractVersion, preview, expectedDigest: preview.digest, confirmed: true
            })

            const bridge = {
                getRecordCreationCatalog: vi.fn().mockResolvedValue(catalog),
                previewRecordCreation: vi.fn().mockResolvedValue(preview),
                commitRecordCreation: vi.fn().mockResolvedValue(result),
                exportRecordCreationDraft: vi.fn().mockResolvedValue(exported)
            }
            vi.stubGlobal('window', { tlc: bridge })
            const desktop = createDataClient('desktop')
            await expect(desktop.getRecordCreationCatalog('account-contoso')).resolves.toEqual(catalog)
            await expect(desktop.previewRecordCreation('draft', draft)).resolves.toEqual(preview)
            await expect(desktop.commitRecordCreation(preview)).resolves.toEqual(result)
            await expect(desktop.exportRecordCreationDraft(preview)).resolves.toEqual(exported)
            expect(bridge.commitRecordCreation).toHaveBeenCalledWith({ contractVersion, preview, expectedDigest: preview.digest, confirmed: true })
        } finally {
            vi.unstubAllGlobals()
            store.close()
        }
    })

    it('uses the account-curation and Deal Team removal routes', async () => {
        const account = { id: 'account-2', name: 'Northwind Health', segment: 'Enterprise', tpid: '1000003', provenance: 'manual', visibility: 'visible' }
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
            const path = String(input)
            const payload = path.includes('/account-candidates')
                ? [{ ...account, state: 'not-added' }]
                : path.endsWith('/deal-team') && init?.method === 'DELETE'
                    ? { opportunityId: 'opportunity-2', onDealTeam: false, alreadyAbsent: false }
                    : path.endsWith('/visibility')
                        ? { ...account, visibility: 'hidden' }
                        : account
            return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
        })
        const client = createWebApiClient(fetcher)

        await client.searchAccounts({ query: '1000003', matchBy: 'tpid' })
        await client.addAccount('account-2')
        await client.setAccountVisibility('account-2', 'hidden')
        await client.leaveDealTeam('opportunity-2')

        expect(fetcher.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
            ['/api/account-candidates?matchBy=tpid&query=1000003', undefined],
            ['/api/accounts', 'POST'],
            ['/api/accounts/account-2/visibility', 'PATCH'],
            ['/api/opportunities/opportunity-2/deal-team', 'DELETE']
        ])
    })

    it('uses the shared guidance envelope over the desktop IPC bridge', async () => {
        const handoff = {
            contractVersion: workflowContractVersion,
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
            contractVersion: workflowContractVersion,
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
            contractVersion: workflowContractVersion, id: 'WF-001', name: 'Pipeline review', version: '1.0.0', scope: 'portfolio',
            personaTargets: ['AE'], category: 'portfolio-hygiene', executionMode: 'deterministic',
            connectorPlan: [{ connector: 'dataverse-mcp', operation: 'read_query', required: true }],
            inputSchemaRef: 'wf-001.input.v1', outputSchemaRef: 'wf-001.output.v1',
            sla: { targetMs: 1_000, timeoutMs: 5_000 }, auth: { requiresDelegatedUser: true, allowedWrite: false },
            ui: { cardStyle: 'record-table', resultPriority: 'high', showInQuickLaunch: true }
        }
        const run = {
            contractVersion: workflowContractVersion, runId, workflowId: 'WF-001', status: 'queued', scope: { kind: 'portfolio' },
            connectorCalls: [], telemetry: { correlationId, cacheHit: false }
        }
        const guidance = {
            contractVersion: workflowContractVersion,
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
        const startRequest = { contractVersion: workflowContractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' as const }, input: {}, correlationId }

        await client.listWorkflowDefinitions('portfolio')
        await client.startWorkflow(startRequest)
        await client.getWorkflowRun(runId)
        await client.cancelWorkflowRun(runId)
        await client.listWorkflowRuns({ kind: 'portfolio' }, 10)
        await expect(client.prepareWorkflowGuidance(runId, 'queue-1', 'mcem-coach')).resolves.toEqual(guidance)

        expect(fetcher.mock.calls.map(([path, init]) => [path, init?.body])).toEqual([
            ['/api/workflows/list', JSON.stringify({ contractVersion: workflowContractVersion, scope: 'portfolio' })],
            ['/api/workflows/start', JSON.stringify(startRequest)],
            ['/api/workflows/get', JSON.stringify({ contractVersion: workflowContractVersion, runId })],
            ['/api/workflows/cancel', JSON.stringify({ contractVersion: workflowContractVersion, runId })],
            ['/api/workflows/history', JSON.stringify({ contractVersion: workflowContractVersion, scope: { kind: 'portfolio' }, limit: 10 })],
            ['/api/workflows/guidance', JSON.stringify({ contractVersion: workflowContractVersion, runId, queueItemId: 'queue-1', capability: 'mcem-coach' })]
        ])
    })

    it('downloads the rich email draft returned by the web host', async () => {
        const click = vi.fn()
        const remove = vi.fn()
        const anchor = { href: '', download: '', style: { display: '' }, click, remove }
        const appendChild = vi.fn()
        const createObjectURL = vi.fn(() => 'blob:email-draft')
        const revokeObjectURL = vi.fn()
        vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } })
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
        expect(anchor.style.display).toBe('none')
        expect(appendChild).toHaveBeenCalledWith(anchor)
        expect(click).toHaveBeenCalledOnce()
        expect(remove).toHaveBeenCalledOnce()
        expect(createObjectURL).toHaveBeenCalledOnce()
        expect(revokeObjectURL).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:email-draft'))
        vi.unstubAllGlobals()
    })

    it('downloads the Word document returned by the web host', async () => {
        const click = vi.fn()
        const remove = vi.fn()
        const anchor = { href: '', download: '', style: { display: '' }, click, remove }
        const appendChild = vi.fn()
        const createObjectURL = vi.fn(() => 'blob:word-document')
        const revokeObjectURL = vi.fn()
        vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } })
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('document bytes', {
            status: 200,
            headers: {
                'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'x-tlc-file-name': 'Account guidance.docx'
            }
        }))

        await expect(createWebApiClient(fetcher).exportAgentResponse({
            contractVersion,
            responseTitle: 'Account guidance',
            responseMarkdown: '## Guidance',
            generatedAt: '2026-09-21T12:00:00.000Z'
        })).resolves.toEqual({ state: 'saved', filePath: 'Account guidance.docx' })

        expect(anchor.download).toBe('Account guidance.docx')
        expect(appendChild).toHaveBeenCalledWith(anchor)
        expect(click).toHaveBeenCalledOnce()
        expect(remove).toHaveBeenCalledOnce()
        await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:word-document'))
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

    it('uses the meeting-capture routes over the web HTTP transport', async () => {
        const transcripts = [{ id: 'transcript-1', subject: 'Executive review', occurredAt: '2026-04-01T10:00:00.000Z', meetingType: 'customer', source: 'teams', segmentCount: 3 }]
        const proposal = { changeSetId: 'cs-1', transcriptId: 'transcript-1', opportunityId: 'opportunity-1', meetingType: 'customer', slots: [], newMilestones: [], unmappedSignals: [], suggestedMilestoneIds: [], proposedAt: '2026-04-01T10:05:00.000Z' }
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
            const path = String(input)
            const payload = path.includes('/meeting-transcripts/transcript-1') ? null
                : path.includes('/meeting-transcripts') ? transcripts
                    : path.includes('/meeting-change-set/apply') ? { changeSetId: 'cs-1', state: 'applied', auditNote: 'ok', items: [] }
                        : proposal
            return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
        })
        const client = createWebApiClient(fetcher)

        await client.listMeetingTranscripts('opportunity-1')
        await client.getMeetingTranscript('transcript-1')
        await client.proposeMeetingFromTranscript('opportunity-1', 'transcript-1')
        await client.proposeMeetingFromRaw('opportunity-1', 'Avery: thanks.', 'customer')
        await client.applyMeetingChangeSet(proposal as never, { changeSetId: 'cs-1', opportunityId: 'opportunity-1', approvedSlotIds: [], approvedNewMilestoneTempIds: [], selectedMilestoneIds: [], reason: 'test' })

        expect(fetcher.mock.calls.map(([path, init]) => [path, init?.method, init?.body])).toEqual([
            ['/api/meeting-transcripts?opportunityId=opportunity-1', undefined, undefined],
            ['/api/meeting-transcripts/transcript-1', undefined, undefined],
            ['/api/opportunities/opportunity-1/meeting-change-set', 'POST', JSON.stringify({ transcriptId: 'transcript-1' })],
            ['/api/opportunities/opportunity-1/meeting-change-set', 'POST', JSON.stringify({ rawTranscript: { content: 'Avery: thanks.', meetingType: 'customer' } })],
            ['/api/meeting-change-set/apply', 'POST', JSON.stringify({
                proposal,
                approval: { changeSetId: 'cs-1', opportunityId: 'opportunity-1', approvedSlotIds: [], approvedNewMilestoneTempIds: [], selectedMilestoneIds: [], reason: 'test' }
            })]
        ])
    })

    it('uses the meeting-capture routes over the desktop IPC bridge', async () => {
        const invoke = vi.fn()
        invoke.mockResolvedValueOnce([{ id: 'transcript-1' }])
        invoke.mockResolvedValueOnce(null)
        const bridge = {
            listMeetingTranscripts: (opportunityId?: string) => invoke('listMeetingTranscripts', opportunityId),
            getMeetingTranscript: (transcriptId: string) => invoke('getMeetingTranscript', transcriptId),
            proposeMeetingChangeSet: (request: unknown) => invoke('proposeMeetingChangeSet', request),
            applyMeetingChangeSet: (proposal: unknown, approval: unknown) => invoke('applyMeetingChangeSet', proposal, approval)
        }
        vi.stubGlobal('window', { tlc: bridge })
        const client = createDataClient('desktop')

        await expect(client.listMeetingTranscripts('opportunity-1')).resolves.toEqual([{ id: 'transcript-1' }])
        await expect(client.getMeetingTranscript('transcript-1')).resolves.toBeNull()
        await client.proposeMeetingFromTranscript('opportunity-1', 'transcript-1')
        await client.proposeMeetingFromRaw('opportunity-1', 'Avery: thanks.', 'customer', 'text')

        expect(invoke).toHaveBeenNthCalledWith(1, 'listMeetingTranscripts', 'opportunity-1')
        expect(invoke).toHaveBeenNthCalledWith(2, 'getMeetingTranscript', 'transcript-1')
        expect(invoke).toHaveBeenNthCalledWith(3, 'proposeMeetingChangeSet', { opportunityId: 'opportunity-1', transcriptId: 'transcript-1' })
        expect(invoke).toHaveBeenNthCalledWith(4, 'proposeMeetingChangeSet', { opportunityId: 'opportunity-1', rawTranscript: { content: 'Avery: thanks.', meetingType: 'customer', format: 'text' } })
        vi.unstubAllGlobals()
    })
})