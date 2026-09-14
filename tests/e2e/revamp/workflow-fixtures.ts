import type { WorkflowDefinition, WorkflowResultCard, WorkflowRun } from '../../../packages/common/index.js'
import type { InitialWorkflowId, InitialWorkflowOutput } from '../../../packages/orchestrator/workflows/index.js'

export const workflowDefinitions: WorkflowDefinition[] = [
    definition('WF-001', 'Stale opportunity sweep', ['AE', 'Manager'], ['dataverse-mcp', 'msx-mcp']),
    definition('WF-002', 'Overdue milestone triage', ['Specialist', 'SE'], ['dataverse-mcp']),
    definition('WF-005', 'Weekly governance exceptions', ['Manager'], ['dataverse-mcp']),
    definition('WF-006', 'Commit-risk conflict list', ['Manager', 'CSAM'], ['dataverse-mcp', 'msx-mcp'])
]

export const workflowGuidanceDefinition = definition('WF-003', 'Stage mismatch review', ['Specialist', 'SE'], ['dataverse-mcp', 'msx-mcp'])

export function workflowRun(workflowId: string, status: WorkflowRun['status'], state?: WorkflowRun['state']): WorkflowRun {
    const terminal = status === 'completed' || status === 'failed' || status === 'cancelled'
    return {
        contractVersion: '1.0',
        runId: '11111111-1111-4111-8111-111111111111',
        workflowId,
        status,
        ...(state ? { state } : {}),
        scope: { kind: 'portfolio' },
        ...(status !== 'queued' ? { startedAt: '2026-09-12T10:00:00.000Z' } : {}),
        ...(terminal ? { completedAt: '2026-09-12T10:00:01.000Z' } : {}),
        connectorCalls: [],
        ...(status === 'completed' ? { resultRef: `result:${workflowId}` } : {}),
        telemetry: {
            correlationId: '22222222-2222-4222-8222-222222222222',
            cacheHit: false
        }
    }
}

function definition(id: string, name: string, personaTargets: string[], connectors: Array<'dataverse-mcp' | 'msx-mcp'>): WorkflowDefinition {
    return {
        contractVersion: '1.0',
        id,
        name,
        version: '1.0.0',
        scope: 'portfolio',
        personaTargets,
        category: 'portfolio-hygiene',
        executionMode: 'deterministic',
        connectorPlan: connectors.map((connector) => ({ connector, operation: 'read_query', required: connector === 'dataverse-mcp' })),
        inputSchemaRef: `workflow-input-${id.toLowerCase()}.v1`,
        outputSchemaRef: `workflow-output-${id.toLowerCase()}.v1`,
        sla: { targetMs: 4_000, timeoutMs: 12_000 },
        auth: { requiresDelegatedUser: true, allowedWrite: false },
        ui: { cardStyle: 'record-table', resultPriority: 'high', showInQuickLaunch: true }
    }
}

export function workflowOutput(workflowId: InitialWorkflowId = 'WF-001', kind: WorkflowResultCard['kind'] = 'record-table'): InitialWorkflowOutput {
    const card: WorkflowResultCard = kind === 'metric-strip' ? {
        kind,
        title: 'Portfolio health',
        evidenceIds: ['evidence-1'],
        metrics: [{ label: 'At risk', value: 3 }, { label: 'Coverage', value: '82%' }]
    } : kind === 'timeline' ? {
        kind,
        title: 'Milestone timeline',
        evidenceIds: ['evidence-1'],
        events: [{ at: '2026-09-12T09:00:00.000Z', label: 'Commitment became overdue' }]
    } : kind === 'action-list' ? {
        kind,
        title: 'Recommended actions',
        evidenceIds: ['evidence-1'],
        actions: [{ id: 'action-1', label: 'Contact the account owner', priority: 'P1' }]
    } : kind === 'exception-list' ? {
        kind,
        title: 'Governance exceptions',
        evidenceIds: ['evidence-1'],
        exceptions: [{ id: 'exception-1', title: 'Missing owner', priority: 'P0', detail: 'No accountable owner is assigned.', evidenceIds: ['evidence-1'] }]
    } : {
        kind,
        title: 'Stale opportunities',
        evidenceIds: ['evidence-1'],
        columns: ['Opportunity', 'Days stale'],
        rows: [{ Opportunity: 'Northwind renewal', 'Days stale': 42 }]
    }
    return {
        contractVersion: '1.0',
        workflowId,
        generatedAt: '2026-09-12T10:00:01.000Z',
        scope: { kind: 'portfolio' },
        card,
        queueItems: [{
            id: 'queue-1',
            workflowId,
            priority: 'P1',
            title: 'Review Northwind renewal',
            owner: 'Account Executive',
            evidenceIds: ['evidence-1'],
            status: 'new'
        }],
        lineage: [{ connector: 'dataverse-mcp', operation: 'read_query', queryTemplateId: 'stale-opportunities', toolCallId: 'tool-call-1' }],
        sourceHealth: [{ source: 'dataverse-mcp', state: 'live', detail: 'Current delegated data.', checkedAt: '2026-09-12T10:00:01.000Z' }]
    }
}

export function workflowGuidanceOutput(): InitialWorkflowOutput {
    const output = workflowOutput('WF-003', 'exception-list')
    return {
        ...output,
        card: {
            kind: 'exception-list',
            title: 'Stage mismatches',
            evidenceIds: ['tool-call-1'],
            exceptions: [{
                id: 'exception-stage-1',
                title: 'Recorded and evidence-based stages differ',
                priority: 'P0',
                detail: 'Grid operations modernization is recorded at Stage 3 while evidence supports Stage 2.',
                evidenceIds: ['tool-call-1']
            }]
        },
        queueItems: [{
            id: 'queue-stage-1',
            workflowId: 'WF-003',
            accountId: 'account-contoso',
            opportunityId: 'opp-grid-modernization',
            priority: 'P0',
            title: 'Resolve Grid operations modernization stage mismatch',
            owner: 'Avery Johnson',
            evidenceIds: ['tool-call-1'],
            status: 'new'
        }]
    }
}