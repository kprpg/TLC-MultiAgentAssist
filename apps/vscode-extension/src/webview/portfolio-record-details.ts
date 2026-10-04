import { mcemStages } from './mcem-stages.js'
import type { MilestoneView, OpportunityView } from './view-types.js'

export interface RecordTooltipContent {
    title: string
    details: ReadonlyArray<{ label: string; value: string }>
}

export function formatMoney(value: number, currency: string): string {
    const formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        notation: 'compact',
        maximumFractionDigits: 1
    }).format(value)
    // Some ICU builds keep a trailing ".0" in compact notation (e.g. "$350.0K" instead of
    // "$350K"). Strip it so output is stable across Node/ICU versions and host platforms.
    return formatted.replace(/\.0(?=\D|$)/, '')
}

export function opportunityTooltipContent(opportunity: OpportunityView): RecordTooltipContent {
    const stageOwner = mcemStages.find((stage) => stage.id === opportunity.recordedStage)?.role ?? 'Account team'
    return {
        title: opportunity.name,
        details: [
            { label: 'Opportunity owner', value: opportunity.owner ?? 'Not assigned' },
            { label: 'Stage owner', value: stageOwner },
            { label: 'Recorded stage', value: String(opportunity.recordedStage) },
            { label: 'Value', value: formatMoney(opportunity.value, opportunity.currency) },
            { label: 'Close', value: opportunity.closeDate }
        ]
    }
}

export function milestoneTooltipContent(milestone: MilestoneView, currency: string): RecordTooltipContent {
    return {
        title: milestone.name,
        details: [
            { label: 'Status', value: milestone.status },
            { label: 'Owner', value: milestone.owner ?? 'Unassigned' },
            { label: 'Commitment', value: milestone.commitment ?? 'Uncommitted' },
            { label: 'Target date', value: milestone.targetDate ?? 'Not set' },
            {
                label: 'Estimated monthly usage',
                value: milestone.estimatedMonthlyUsage === undefined
                    ? 'Not available'
                    : formatMoney(milestone.estimatedMonthlyUsage, currency)
            }
        ]
    }
}
