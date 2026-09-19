import type { AgentCapability } from '../contracts/index.js'

export const agentCapabilities = [
    { id: 'account-pulse', label: 'Account Pulse', description: 'Summarizes account health, priorities, activity, and the actions that need attention.' },
    { id: 'mcem-coach', label: 'MCEM Coach', description: 'Evaluates MCEM stage evidence, exit criteria, ownership gaps, and the next best action.' },
    { id: 'pursuit-executive', label: 'Pursuit', description: 'Builds an opportunity pursuit view covering stakeholders, value, competition, and deal progression.' },
    { id: 'risk-solution-play', label: 'Risk & Play', description: 'Surfaces delivery and deal risks, then recommends the most relevant solution play and mitigations.' }
] as const satisfies ReadonlyArray<{ id: AgentCapability; label: string; description: string }>