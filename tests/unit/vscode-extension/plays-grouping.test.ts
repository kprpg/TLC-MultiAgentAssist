import { describe, expect, it } from 'vitest'
import {
    groupQueueByOpportunity,
    highPriorityCount,
    priorityClass,
    priorityRank
} from '../../../apps/vscode-extension/src/webview/plays-grouping.js'
import type { WorkflowQueueItemView } from '../../../apps/vscode-extension/src/webview/view-types.js'

const resolvers = {
    accountName: (id?: string) => (id ? ({ 'account-contoso': 'Contoso', 'account-fabrikam': 'Fabrikam' }[id] ?? id) : 'Unassigned account'),
    opportunityName: (id?: string) =>
        id ? ({ 'opp-grid': 'Grid modernization', 'opp-store': 'Store rollout' }[id] ?? id) : undefined
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
})
