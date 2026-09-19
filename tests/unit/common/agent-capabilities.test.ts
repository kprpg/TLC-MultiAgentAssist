import { describe, expect, it } from 'vitest'
import { agentCapabilities } from '../../../packages/common/index.js'

describe('agent capabilities', () => {
    it('provides tooltip descriptions for all four guidance agents', () => {
        expect(agentCapabilities).toHaveLength(4)
        expect(agentCapabilities.map(({ id, label, description }) => ({ id, label, description }))).toEqual([
            { id: 'account-pulse', label: 'Account Pulse', description: 'Summarizes account health, priorities, activity, and the actions that need attention.' },
            { id: 'mcem-coach', label: 'MCEM Coach', description: 'Evaluates MCEM stage evidence, exit criteria, ownership gaps, and the next best action.' },
            { id: 'pursuit-executive', label: 'Pursuit', description: 'Builds an opportunity pursuit view covering stakeholders, value, competition, and deal progression.' },
            { id: 'risk-solution-play', label: 'Risk & Play', description: 'Surfaces delivery and deal risks, then recommends the most relevant solution play and mitigations.' }
        ])
    })
})