export const compositeDataverseWorkflowRows: Record<string, Array<Record<string, unknown>>> = {
    'WF-001': [
        { id: 'opp-b', accountId: 'account-1', name: 'Fabrikam cloud renewal', closeDate: '2026-07-01' },
        { id: 'opp-a', accountId: 'account-1', name: 'Northwind AI transformation', closeDate: '2026-07-01' }
    ],
    'WF-002': [
        { id: 'milestone-b', opportunityId: 'opp-1', name: 'Architecture sign-off', status: 'At Risk', targetDate: '2026-09-01' },
        { id: 'milestone-a', opportunityId: 'opp-1', name: 'Security review', status: 'Blocked', targetDate: '2026-09-01' }
    ],
    'WF-003': [
        { id: 'milestone-stage-gap', opportunityId: 'opp-1', name: 'Customer outcome evidence', status: 'At Risk', targetDate: '2026-09-05' }
    ],
    'WF-005': [
        { id: 'milestone-1', opportunityId: 'opp-1', name: 'Proof review', status: 'Blocked', targetDate: '2026-09-10' }
    ],
    'WF-006': [
        { id: 'opp-1', accountId: 'account-1', name: 'Contoso data platform', closeDate: '2026-10-01' }
    ],
    'WF-007': [
        { id: 'meeting-1', opportunityId: 'opp-1', subject: 'Executive architecture review', ownerId: 'owner-1', dueDate: '2026-09-18', status: 'Open' }
    ],
    'WF-009': [
        { id: 'opp-1', accountId: 'account-1', name: 'Contoso data platform', ownerId: 'owner-1', closeDate: '2026-10-01' },
        { id: 'opp-2', accountId: 'account-1', name: 'Contoso security expansion', ownerId: 'owner-1', closeDate: '2026-11-01' }
    ],
    'WF-010': [
        { id: 'activity-1', opportunityId: 'opp-1', subject: 'Customer follow-up', ownerId: 'owner-1', dueDate: '2026-08-01', status: 'Open' }
    ],
    'WF-012': [
        { id: 'milestone-exit-1', opportunityId: 'opp-1', name: 'Decision criteria confirmed', status: 'Completed', targetDate: '2026-09-08' },
        { id: 'milestone-exit-2', opportunityId: 'opp-1', name: 'Execution owner assigned', status: 'At Risk', targetDate: '2026-09-12' }
    ]
}

export const compositeMsxPipelineRows = [
    {
        id: 'opp-a', accountId: 'account-1', name: 'Northwind AI transformation', owner: 'Avery Stone',
        recordedStage: 3, value: 250_000, currency: 'USD', closeDate: '2026-06-28',
        forecastCategory: 'Committed', probability: 80
    },
    {
        id: 'opp-1', accountId: 'account-1', name: 'Contoso data platform', owner: 'Jordan Lee',
        recordedStage: 4, value: 500_000, currency: 'USD', closeDate: '2026-09-25',
        forecastCategory: 'Best Case', probability: 65
    }
]

export const compositeMsxForecastSnapshot = {
    currency: 'USD', committed: 500_000, bestCase: 750_000, target: 1_000_000, gap: -500_000
}

export const compositeDataverseBrokerRows: Record<string, Array<Record<string, unknown>>> = {
    opportunities: compositeDataverseWorkflowRows['WF-001']!.map((row) => ({
        opportunityid: row.id,
        _parentaccountid_value: row.accountId,
        name: row.name,
        estimatedclosedate: row.closeDate
    }))
}

export const compositeMsxBrokerResults = {
    list_pipeline: compositeMsxPipelineRows,
    get_forecast_snapshot: compositeMsxForecastSnapshot
}

export const compositeConflictScenario = {
    dataverseRows: [
        { id: 'opp-1', accountId: 'account-1', name: 'Dataverse name', closeDate: '2026-10-20' },
        { id: 'opp-1', accountId: 'account-1', name: 'Duplicate name', closeDate: '2026-10-21' }
    ],
    msxRows: [{
        id: 'opp-1', accountId: 'account-1', name: 'MSX name', recordedStage: 3,
        value: 250_000, currency: 'USD', closeDate: '2026-10-15', forecastCategory: 'Committed', probability: 80
    }]
}