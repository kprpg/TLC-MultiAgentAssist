import { describe, expect, it } from 'vitest'
import { workflowGuidanceCapability } from '../../../apps/desktop/renderer-revamp/src/workflow-guidance.js'

describe('workflow guidance routing', () => {
    it('routes composite workflows to existing capabilities without creating another agent', () => {
        expect(workflowGuidanceCapability('WF-001')).toBe('pursuit-executive')
        expect(workflowGuidanceCapability('WF-002')).toBe('mcem-coach')
        expect(workflowGuidanceCapability('WF-003')).toBe('mcem-coach')
        expect(workflowGuidanceCapability('WF-004')).toBe('pursuit-executive')
        expect(workflowGuidanceCapability('WF-006')).toBe('risk-solution-play')
        expect(workflowGuidanceCapability('WF-007')).toBe('account-pulse')
        expect(workflowGuidanceCapability('WF-012')).toBe('mcem-coach')
        expect(workflowGuidanceCapability('unknown')).toBe('mcem-coach')
    })
})
