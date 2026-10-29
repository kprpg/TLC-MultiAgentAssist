import type { MomentumPriority, MomentumRecord } from '../../../../packages/common/contracts/momentum-focus.js'

export const momentumTierLabels: Record<MomentumPriority['tier'], string> = {
    'act-now': 'Act now', 'this-week': 'This week', 'plan-month': 'Plan this month', verify: 'Verify information'
}
export function momentumValue(value: MomentumRecord['value']): string {
    const unit = value.basis === 'pipeline' ? 'pipeline value' : 'monthly rate'
    if (value.amount === null) return `Unknown ${unit}`
    return `${value.currency ?? 'Unknown currency'} ${value.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}${value.basis === 'monthly-usage' ? '/month' : ''}`
}
