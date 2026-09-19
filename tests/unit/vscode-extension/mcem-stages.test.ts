import { describe, expect, it } from 'vitest'
import { mcemStages } from '../../../apps/vscode-extension/src/webview/mcem-stages.js'

describe('VS Code MCEM stage metadata', () => {
    it('provides the stage name and role owner for every MCEM stage', () => {
        expect(mcemStages).toEqual([
            { id: 1, name: 'Listen & Consult', role: 'Account Executive' },
            { id: 2, name: 'Inspire & Design', role: 'Specialist / SSP' },
            { id: 3, name: 'Empower & Achieve', role: 'Solution Engineer' },
            { id: 4, name: 'Realize Value', role: 'Cloud Solution Architect' },
            { id: 5, name: 'Manage & Optimize', role: 'CSAM' }
        ])
    })
})