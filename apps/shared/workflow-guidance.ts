import type { AgentCapability } from '../../packages/common/index.js'

const capabilities: Readonly<Record<string, AgentCapability>> = {
  'WF-001': 'pursuit-executive',
  'WF-002': 'mcem-coach',
  'WF-003': 'mcem-coach',
  'WF-004': 'pursuit-executive',
  'WF-005': 'mcem-coach',
  'WF-006': 'risk-solution-play',
  'WF-007': 'account-pulse',
  'WF-008': 'risk-solution-play',
  'WF-009': 'account-pulse',
  'WF-010': 'account-pulse',
  'WF-011': 'account-pulse',
  'WF-012': 'mcem-coach'
}

export function workflowGuidanceCapability(workflowId: string): AgentCapability {
  return capabilities[workflowId] ?? 'mcem-coach'
}
