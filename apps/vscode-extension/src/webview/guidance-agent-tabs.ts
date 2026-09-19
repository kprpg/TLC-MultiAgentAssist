import { createElement, type ReactElement } from 'react'
import { agentCapabilities } from '../../../../packages/common/types/agent-capabilities.js'
import type { AgentCapability } from './view-types.js'

export function GuidanceAgentTabs({ capability, onSelect }: { capability: AgentCapability; onSelect: (capability: AgentCapability) => void }): ReactElement {
    return createElement('div', { className: 'agent-tabs', role: 'tablist', 'aria-label': 'Guidance agents' },
        agentCapabilities.map((item) => {
            const tooltipId = `guidance-agent-tooltip-${item.id}`
            return createElement('div', { key: item.id, className: 'agent-tab-with-tooltip', role: 'presentation' },
                createElement('button', {
                    role: 'tab',
                    'aria-selected': capability === item.id,
                    'aria-describedby': tooltipId,
                    className: capability === item.id ? 'tab active' : 'tab',
                    onClick: () => onSelect(item.id)
                }, item.label),
                createElement('button', {
                    type: 'button',
                    className: 'agent-tooltip-trigger',
                    'aria-label': `About ${item.label}`,
                    'aria-describedby': tooltipId
                }, 'i'),
                createElement('span', { id: tooltipId, className: 'agent-tab-tooltip', role: 'tooltip' }, item.description)
            )
        })
    )
}