import { describe, expect, it } from 'vitest'
import {
    groupQueueByOpportunity,
    highPriorityCount,
    humanizeResultCard,
    priorityClass,
    priorityRank,
    sectionPlaysByWorkflowNumber
} from '../../../apps/vscode-extension/src/webview/plays-grouping.js'
import type { WorkflowQueueItemView } from '../../../apps/vscode-extension/src/webview/view-types.js'

const resolvers = {
    accountName: (id?: string) => id ? ({ 'account-contoso': 'Contoso', 'account-fabrikam': 'Fabrikam' }[id]) : undefined,
    opportunityName: (id?: string) =>
        id ? ({ 'opp-grid': 'Grid modernization', 'opp-store': 'Store rollout' }[id]) : undefined
}

function item(overrides: Partial<WorkflowQueueItemView> & Pick<WorkflowQueueItemView, 'id' | 'title' | 'priority'>): WorkflowQueueItemView {
    return { ...overrides }
}

describe('plays grouping helpers', () => {
    it('ranks P0 above P1 above P2 and unknown last', () => {
        expect(priorityRank('P0')).toBeLessThan(priorityRank('P1'))
        expect(priorityRank('P1')).toBeLessThan(priorityRank('P2'))
        expect(priorityRank('P2')).toBeLessThan(priorityRank('P9'))
    })

    it('maps priorities to severity classes', () => {
        expect(priorityClass('P0')).toBe('high')
        expect(priorityClass('P1')).toBe('medium')
        expect(priorityClass('P2')).toBe('low')
        expect(priorityClass('P7')).toBe('unknown')
    })

    it('counts high-priority items', () => {
        expect(highPriorityCount([
            item({ id: 'a', title: 'A', priority: 'P0' }),
            item({ id: 'b', title: 'B', priority: 'P1' }),
            item({ id: 'c', title: 'C', priority: 'P0' })
        ])).toBe(2)
    })

    it('groups by account and opportunity, resolving names', () => {
        const groups = groupQueueByOpportunity([
            item({ id: '1', title: 'Grid item', priority: 'P1', accountId: 'account-contoso', opportunityId: 'opp-grid' }),
            item({ id: '2', title: 'Store item', priority: 'P0', accountId: 'account-fabrikam', opportunityId: 'opp-store' })
        ], resolvers)

        expect(groups).toHaveLength(2)
        // Fabrikam/Store has the P0 item, so it sorts first (most urgent group).
        expect(groups[0]?.opportunityName).toBe('Store rollout')
        expect(groups[0]?.accountName).toBe('Fabrikam')
        expect(groups[1]?.opportunityName).toBe('Grid modernization')
        expect(groups[1]?.accountName).toBe('Contoso')
    })

    it('prefers queue-provided names and never displays GUID fallbacks', () => {
        const accountId = '98fdc866-1634-471c-a53c-2b3f5c2fa044'
        const opportunityId = '90d5a586-9e5f-ed11-9561-6045bda8abe8'
        const [named] = groupQueueByOpportunity([
            item({
                id: '1',
                title: 'Map stakeholders',
                priority: 'P1',
                accountId,
                accountName: 'Honeywell',
                opportunityId,
                opportunityName: 'HPS Enabled Services: BCDR Planning'
            })
        ], {
            accountName: () => accountId,
            opportunityName: () => opportunityId
        })
        const [unnamed] = groupQueueByOpportunity([
            item({ id: '2', title: 'Map stakeholders', priority: 'P1', accountId, opportunityId })
        ], {
            accountName: () => accountId,
            opportunityName: () => opportunityId
        })

        expect(named).toMatchObject({
            accountName: 'Honeywell',
            opportunityName: 'HPS Enabled Services: BCDR Planning'
        })
        // When no descriptive name resolves, the opportunity name is omitted so the header can
        // fall back to the account/customer name instead of showing a GUID.
        expect(unnamed?.accountName).toBe('Account name unavailable')
        expect(unnamed?.opportunityName).toBeUndefined()
    })

    it('resolves the parent account for items that only carry an opportunity id', () => {
        const [group] = groupQueueByOpportunity([
            item({ id: '1', title: 'Triage overdue milestone', priority: 'P1', opportunityId: 'opp-grid' })
        ], {
            accountName: (id?: string) => (id ? ({ 'account-contoso': 'Contoso' }[id]) : undefined),
            opportunityName: () => undefined,
            accountForOpportunity: (id?: string) =>
                id === 'opp-grid' ? { id: 'account-contoso', name: 'Contoso' } : undefined
        })

        expect(group?.accountName).toBe('Contoso')
        expect(group?.accountId).toBe('account-contoso')
        expect(group?.opportunityName).toBeUndefined()
    })

    it('sorts items by priority then title within a group', () => {
        const [group] = groupQueueByOpportunity([
            item({ id: '1', title: 'Zeta', priority: 'P2', accountId: 'account-contoso', opportunityId: 'opp-grid' }),
            item({ id: '2', title: 'Alpha', priority: 'P0', accountId: 'account-contoso', opportunityId: 'opp-grid' }),
            item({ id: '3', title: 'Beta', priority: 'P0', accountId: 'account-contoso', opportunityId: 'opp-grid' })
        ], resolvers)

        expect(group?.items.map((entry) => entry.title)).toEqual(['Alpha', 'Beta', 'Zeta'])
        expect(group?.topRank).toBe(0)
        expect(group?.highPriorityCount).toBe(2)
    })

    it('buckets items without an opportunity under the account with no opportunity name', () => {
        const [group] = groupQueueByOpportunity([
            item({ id: '1', title: 'Owner overload', priority: 'P1', accountId: 'account-contoso' })
        ], resolvers)

        expect(group?.accountName).toBe('Contoso')
        expect(group?.opportunityName).toBeUndefined()
        expect(group?.opportunityId).toBeUndefined()
    })

    it('sections plays in numeric WF order even when a category repeats later', () => {
        const sections = sectionPlaysByWorkflowNumber([
            { id: 'WF-010', category: 'activity-compliance' },
            { id: 'WF-004', category: 'account-planning' },
            { id: 'WF-011', category: 'portfolio-hygiene' },
            { id: 'WF-002', category: 'portfolio-hygiene' },
            { id: 'WF-001', category: 'portfolio-hygiene' }
        ])

        expect(sections.flatMap(({ definitions }) => definitions.map(({ id }) => id))).toEqual([
            'WF-001', 'WF-002', 'WF-004', 'WF-010', 'WF-011'
        ])
        expect(sections.map(({ category }) => category)).toEqual([
            'portfolio-hygiene', 'account-planning', 'activity-compliance', 'portfolio-hygiene'
        ])
    })

    it('humanizes record-table cards: drops id/owner columns and resolves account/opportunity names', () => {
        const card = humanizeResultCard({
            style: 'record-table',
            columns: ['id', 'accountId', 'name', 'closeDate'],
            rows: [{
                id: '01a45a8e-265f-ef11-bfe3-002248336354',
                accountId: '6b112f4e-cc56-472a-803c-865eba110ae6',
                name: 'Arc enabled SQL',
                closeDate: '2027-03-18'
            }]
        }, {
            accountName: (id?: string) => (id === '6b112f4e-cc56-472a-803c-865eba110ae6' ? 'CHOA' : undefined),
            opportunityName: () => undefined
        })

        expect(card.columns).toEqual(['accountId', 'name', 'closeDate'])
        expect(card.columnLabels).toMatchObject({ accountId: 'Account', name: 'Opportunity', closeDate: 'Close date' })
        expect(card.rows?.[0]).toEqual({ accountId: 'CHOA', name: 'Arc enabled SQL', closeDate: '2027-03-18' })
    })

    it('falls back to a neutral label when a record-table account id cannot be resolved', () => {
        const card = humanizeResultCard({
            style: 'record-table',
            columns: ['id', 'opportunityId', 'subject', 'ownerId', 'dueDate'],
            rows: [{
                id: 'activity-1',
                opportunityId: '90d5a586-9e5f-ed11-9561-6045bda8abe8',
                subject: 'Executive review',
                ownerId: 'b769f2e7-f94f-4fb5-8479-ea400accf811',
                dueDate: '2026-09-18'
            }]
        }, {
            accountName: () => undefined,
            opportunityName: () => undefined
        })

        expect(card.columns).toEqual(['opportunityId', 'subject', 'dueDate'])
        expect(card.rows?.[0]).toEqual({
            opportunityId: 'Opportunity name unavailable',
            subject: 'Executive review',
            dueDate: '2026-09-18'
        })
    })
})
