import { describe, expect, it, vi } from 'vitest'
import { selectGuidancePrompt } from '../../../apps/vscode-extension/src/webview/guidance-prompt-selection.js'

describe('selectGuidancePrompt', () => {
    it('populates the composer before dispatching the same suggested prompt', () => {
        const setPrompt = vi.fn()
        const dispatchPrompt = vi.fn()
        const prompt = 'What should the account team focus on this week?'

        selectGuidancePrompt(prompt, setPrompt, dispatchPrompt)

        expect(setPrompt).toHaveBeenCalledWith(prompt)
        expect(dispatchPrompt).toHaveBeenCalledWith(prompt)
        expect(setPrompt.mock.invocationCallOrder[0]).toBeLessThan(dispatchPrompt.mock.invocationCallOrder[0]!)
    })
})
