import type { AgentCapability } from '../../../../packages/common/index.js'

const capabilities: Partial<Record<string, AgentCapability>> = {
    'WF-003': 'mcem-coach',
    'WF-007': 'pursuit-executive',
    'WF-012': 'mcem-coach'
}

export function workflowGuidanceCapability(workflowId: string): AgentCapability | undefined {
    return capabilities[workflowId]
}
