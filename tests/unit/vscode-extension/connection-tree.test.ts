import { describe, expect, it } from 'vitest'
import { buildConnectionItems } from '../../../apps/vscode-extension/src/tree/connection-items.js'

describe('Connection view labels', () => {
    it('reflects live mode in the MSX source label (not hardcoded sample)', () => {
        const labels = buildConnectionItems('live', 'girish.pillai@microsoft.com').map((item) => item.label)
        expect(labels).toContain('Mode: Live')
        expect(labels).toContain('MSX: live')
        expect(labels).toContain('Identity: girish.pillai@microsoft.com')
    })

    it('shows sample for the MSX source label in sample mode', () => {
        const labels = buildConnectionItems('sample').map((item) => item.label)
        expect(labels).toContain('Mode: Sample')
        expect(labels).toContain('MSX: sample')
        expect(labels).toContain('Identity: Not signed in (sample)')
    })

    it('labels MCEM guidance as built-in criteria in both modes', () => {
        for (const mode of ['live', 'sample'] as const) {
            expect(buildConnectionItems(mode).map((item) => item.label)).toContain('MCEM guidance: built-in criteria')
        }
    })
})

