import type { McpEvidenceLineage, SourceHealth } from '../../common/index.js'
import { InitialWorkflowResultAssembler } from './cohort-executor.js'
import { initialWorkflowDefinitions, type InitialWorkflowId } from './cohort.js'
import { SharedWorkflowHost } from './host.js'
import { WorkflowRegistry } from './registry.js'
import { WorkflowRuntime, type WorkflowConnectorExecutor } from './runtime.js'

const sampleRows: Record<InitialWorkflowId, Array<Record<string, unknown>>> = {
    'WF-001': [
        { id: 'opp-grid-modernization', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', name: 'Grid operations modernization', closeDate: '2026-08-15' },
        { id: 'opp-ai-service', accountId: 'account-fabrikam', opportunityId: 'opp-ai-service', name: 'AI-assisted customer service', closeDate: '2026-08-29' }
    ],
    'WF-002': [{ id: 'milestone-grid', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', name: 'Architecture sign-off', status: 'At Risk', targetDate: '2026-09-01' }],
    'WF-003': [{ id: 'milestone-stage-gap', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', name: 'Customer outcome evidence', status: 'At Risk', targetDate: '2026-09-05' }],
    'WF-004': [
        { id: 'opp-grid-modernization', accountId: 'account-contoso', name: 'Grid operations modernization', closeDate: '2026-08-15' },
        { id: 'opp-ai-service', accountId: 'account-fabrikam', name: 'AI-assisted customer service', closeDate: '2026-08-29' }
    ],
    'WF-005': [{ id: 'milestone-governance', accountId: 'account-fabrikam', opportunityId: 'opp-ai-service', name: 'Proof review', status: 'Blocked', targetDate: '2026-09-10' }],
    'WF-006': [{ id: 'opp-grid-modernization', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', name: 'Grid operations modernization', closeDate: '2026-10-30' }],
    'WF-007': [{ id: 'meeting-grid', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', subject: 'Executive architecture review', ownerId: 'owner-1', dueDate: '2026-09-18', status: 'Open' }],
    'WF-008': [
        { id: 'opp-grid-modernization', accountId: 'account-contoso', name: 'Grid operations modernization', closeDate: '2026-10-30' },
        { id: 'opp-cloud-security-readiness', accountId: 'account-contoso', name: 'Cloud security readiness', closeDate: '2027-02-26' },
        { id: 'opp-ai-service', accountId: 'account-fabrikam', name: 'AI-assisted customer service', closeDate: '2026-12-18' }
    ],
    'WF-009': [
        { id: 'opp-grid-modernization', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', name: 'Grid operations modernization', ownerId: 'owner-1', closeDate: '2026-10-30' },
        { id: 'opp-cloud-security-readiness', accountId: 'account-contoso', opportunityId: 'opp-cloud-security-readiness', name: 'Cloud security readiness', ownerId: 'owner-1', closeDate: '2027-02-26' }
    ],
    'WF-010': [{ id: 'activity-grid', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', subject: 'Customer follow-up', ownerId: 'owner-1', dueDate: '2026-08-01', status: 'Open' }],
    'WF-011': [
        { id: 'opp-grid-modernization', accountId: 'account-contoso', name: 'Grid operations modernization', closeDate: '2026-10-30' },
        { id: 'opp-cloud-security-readiness', accountId: 'account-contoso', name: 'Cloud security readiness', closeDate: '2027-02-26' }
    ],
    'WF-012': [
        { id: 'milestone-exit-1', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', name: 'Decision criteria confirmed', status: 'Completed', targetDate: '2026-09-08' },
        { id: 'milestone-exit-2', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', name: 'Execution owner assigned', status: 'At Risk', targetDate: '2026-09-12' }
    ]
}

const sampleMsxRows = [
    { id: 'opp-grid-modernization', accountId: 'account-contoso', name: 'Grid operations modernization', owner: 'Avery Johnson', recordedStage: 3, value: 4_200_000, currency: 'USD', closeDate: '2026-10-30', forecastCategory: 'Committed', probability: 80 },
    { id: 'opp-ai-service', accountId: 'account-fabrikam', name: 'AI-assisted customer service', recordedStage: 2, value: 1_750_000, currency: 'USD', closeDate: '2026-12-18', forecastCategory: 'Best Case', probability: 65 }
]

export function createSampleWorkflowHost(): SharedWorkflowHost {
    const registry = new WorkflowRegistry(initialWorkflowDefinitions)
    const executor: WorkflowConnectorExecutor = {
        execute: async (step, context) => {
            const workflowId = context.workflowId as InitialWorkflowId
            const data = step.connector === 'dataverse-mcp'
                ? sampleRows[workflowId]
                : step.operation === 'get_forecast_snapshot'
                    ? { currency: 'USD', committed: 4_200_000, bestCase: 1_750_000, target: 7_000_000, gap: -2_800_000 }
                    : sampleMsxRows
            const lineage: McpEvidenceLineage = {
                connector: step.connector,
                operation: step.operation,
                toolCallId: `sample-${workflowId}-${step.connector}`
            }
            const sourceHealth: SourceHealth = {
                source: step.connector,
                state: 'sample',
                detail: 'Sanitized workflow fixture data.',
                checkedAt: new Date().toISOString()
            }
            return { state: 'complete', data, rowCount: Array.isArray(data) ? data.length : 1, truncated: false, lineage, sourceHealth }
        }
    }
    return new SharedWorkflowHost(registry, new WorkflowRuntime(registry, executor, {
        resultAssembler: new InitialWorkflowResultAssembler()
    }))
}