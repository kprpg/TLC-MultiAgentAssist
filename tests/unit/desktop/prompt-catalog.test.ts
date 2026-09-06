import { describe, expect, it } from 'vitest'
import { parseSuggestedPrompts, suggestedPrompts } from '../../../apps/desktop/renderer-revamp/src/prompt-catalog.js'

describe('agent suggested prompt catalog', () => {
    it('loads at least four agent-owned prompts for every capability', () => {
        expect(Object.keys(suggestedPrompts)).toEqual([
            'account-pulse',
            'mcem-coach',
            'pursuit-executive',
            'risk-solution-play'
        ])
        expect(Object.values(suggestedPrompts).every((prompts) => prompts.length >= 4)).toBe(true)
    })

    it('rejects an incomplete prompts.md catalog', () => {
        expect(() => parseSuggestedPrompts('# Suggested prompts\n\n- One\n- Two')).toThrow(
            'Each agent prompt catalog must contain at least four list items.'
        )
    })
})