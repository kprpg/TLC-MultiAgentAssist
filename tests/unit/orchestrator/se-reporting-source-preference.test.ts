import { describe, expect, it } from 'vitest'
import { resolveSeSourcePreference } from '../../../packages/orchestrator/se-reporting/composition.js'

describe('SE reporting MSX source preference', () => {
    it('defaults to Power BI and accepts only known values', () => {
        expect(resolveSeSourcePreference({})).toBe('powerbi')
        expect(resolveSeSourcePreference({ TLC_SE_SOURCE: ' Auto ' })).toBe('auto')
        expect(resolveSeSourcePreference({ TLC_SE_SOURCE: 'dataverse' })).toBe('dataverse')
        expect(resolveSeSourcePreference({ TLC_SE_SOURCE: 'powerbi' })).toBe('powerbi')
        expect(resolveSeSourcePreference({ TLC_SE_SOURCE: 'kusto' })).toBe('powerbi')
    })
})