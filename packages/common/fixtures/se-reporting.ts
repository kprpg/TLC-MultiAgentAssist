import type { SeNarrativeBundle, SeReportingInput, SeReportingProfile } from '../contracts/se-reporting.js'

export const sampleSeProfile: SeReportingProfile = {
    id: 'sample-manager', label: 'Synthetic reporting team',
    contractUrl: 'https://example.sharepoint.com/teams/sample/Shared%20Documents/reporting-contract.md',
    outputRootUrl: 'https://example.sharepoint.com/teams/sample/Shared%20Documents/Pod%20Reports',
    semanticModelId: '11111111-1111-4111-8111-111111111111', sources: ['m365_email']
}
export function emptySeNarratives(): SeNarrativeBundle {
    return { customer_updates: [], priority_initiatives: [], account_notes: [], partners: [], technical_themes: [],
        cross_pillar_dependencies: [], next_month_priorities: [], leadership_decisions: [], scrum_rollup_bullets: [], follow_up_required: [] }
}
export function createSeReportingFixture(): SeReportingInput {
    const assignment = {
        managerId: 'sample-manager-id', managerAlias: 'sample-manager', managerName: 'Morgan Sample',
        reporterId: 'sample-reporter-id', accountId: 'account-one', accountName: 'Contoso Energy',
        atu: 'atu-one', workload: 'infra', assignmentType: 'Primary' as const
    }
    const milestone = {
        id: 'active-one', reporterId: 'sample-reporter-id', accountId: 'account-one', opportunityId: 'opportunity-one',
        name: 'Cloud production rollout', category: 'Production', status: 'On Track', commitment: 'Committed',
        monthlyAcr: 1000, date: '2026-11-10', committedOn: '2026-10-12', completedOn: null,
        createdOn: '2026-09-01', blocker: ''
    }
    const task = {
        id: 'task-one', ownerId: 'sample-reporter-id', milestoneId: 'active-one', accountId: 'account-one',
        milestoneName: 'Cloud production rollout',
        subject: 'Architecture design session completed', categoryCode: '861980004', state: 1,
        actualEnd: '2026-10-10', activityDate: '2026-10-09'
    }
    return {
        mode: 'sample',
        runId: 'sample-run', profileId: sampleSeProfile.id,
        owner: { name: 'Alex Sample', alias: 'alex-sample', email: 'alex@example.test', system_user_id: 'sample-reporter-id' },
        contract: { version: '2.0', manager: { name: 'Morgan Sample', alias: 'sample-manager', system_user_id: 'sample-manager-id' },
            allowedAtus: ['atu-one', 'atu-two'], allowedPillars: ['infra'], url: sampleSeProfile.contractUrl, hash: 'synthetic-contract-hash', testMode: false },
        period: '2026-10', pillar: 'infra', asOf: '2026-10-20', generatedAt: '2026-10-20T12:00:00.000Z',
        eventDateCoverage: { committed: true, completed: true, created: true },
        mappingGaps: [],
        assignments: [
            assignment, { ...assignment, assignmentType: 'Backup' },
            { ...assignment, accountId: 'account-two', accountName: 'Fabrikam Manufacturing', atu: 'atu-two', assignmentType: 'Backup' },
            { ...assignment, managerId: 'another-manager', accountId: 'foreign-account' }
        ],
        milestones: [
            milestone,
            { ...milestone, id: 'completed-one', name: 'Landing zone pilot', status: 'Completed', commitment: 'Uncommitted', monthlyAcr: 500,
                date: '2026-10-15', committedOn: null, completedOn: '2026-10-15' },
            { ...milestone, id: 'active-two', accountId: 'account-two', name: 'Factory migration', monthlyAcr: 2000 },
            { ...milestone, id: 'foreign-milestone', accountId: 'foreign-account' },
            { ...milestone, id: 'cancelled-one', status: 'Cancelled' }
        ],
        tasks: [task, { ...task, id: 'task-untagged', categoryCode: '' }, { ...task, id: 'task-no-completion', actualEnd: null }],
        evidence: [],
        access: [{ source: 'contract', state: 'available', detail: 'Synthetic contract' },
            { source: 'assignments', state: 'available', detail: 'Synthetic assignments' },
            { source: 'msx', state: 'available', detail: 'Synthetic milestones and activities' },
            { source: 'm365_email', state: 'available', detail: 'Synthetic source' }],
        narratives: {
            ...emptySeNarratives(),
            customer_updates: [{
                account_id: 'account-one', customer: 'Contoso Energy', atu: 'atu-one', ownership: 'Primary', status: 'advisory',
                summary: 'The landing zone pilot is complete; the production rollout is on track.',
                impact: 'The customer can proceed with production readiness review.',
                msx: [{ label: 'Production', text: 'Cloud production rollout is On Track.' }], m365: [],
                next_actions: ['Review production readiness with the customer.'], source_refs: ['active-one', 'completed-one'], confidence: 'high'
            }]
        }
    }
}
