import { describe, expect, it } from 'vitest'
import {
    formatMoney,
    milestoneTooltipContent,
    opportunityTooltipContent
} from '../../../apps/vscode-extension/src/webview/portfolio-record-details.js'

describe('portfolio record details', () => {
    it('formats opportunity value and hover details like Desktop and Web', () => {
        const opportunity = {
            id: 'opportunity-1',
            accountId: 'account-1',
            name: 'Grid operations modernization',
            owner: 'Avery Johnson',
            recordedStage: 3,
            value: 4_200_000,
            currency: 'USD',
            closeDate: '2026-10-30'
        }

        expect(formatMoney(opportunity.value, opportunity.currency)).toBe('$4.2M')
        expect(opportunityTooltipContent(opportunity)).toEqual({
            title: opportunity.name,
            details: [
                { label: 'Opportunity owner', value: 'Avery Johnson' },
                { label: 'Stage owner', value: 'Solution Engineer' },
                { label: 'Recorded stage', value: '3' },
                { label: 'Value', value: '$4.2M' },
                { label: 'Close', value: '2026-10-30' }
            ]
        })
    })

    it('formats milestone usage and hover details using the opportunity currency', () => {
        const milestone = {
            id: 'milestone-1',
            opportunityId: 'opportunity-1',
            name: 'Customer outcome validation',
            status: 'On Track',
            targetDate: '2026-09-15',
            owner: 'Taylor Morgan',
            commitment: 'Committed',
            estimatedMonthlyUsage: 350_000
        }

        expect(milestoneTooltipContent(milestone, 'USD')).toEqual({
            title: milestone.name,
            details: [
                { label: 'Status', value: 'On Track' },
                { label: 'Owner', value: 'Taylor Morgan' },
                { label: 'Commitment', value: 'Committed' },
                { label: 'Target date', value: '2026-09-15' },
                { label: 'Estimated monthly usage', value: '$350K' }
            ]
        })
    })
})
