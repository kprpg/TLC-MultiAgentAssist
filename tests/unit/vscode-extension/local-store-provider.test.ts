import type { TokenCredential } from '@azure/core-auth'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalStoreDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { buildFoundryMeetingExtractor } from '../../../apps/vscode-extension/src/live-provider.js'

vi.mock('../../../apps/vscode-extension/src/live-provider.js', () => ({
    buildFoundryMeetingExtractor: vi.fn(() => undefined)
}))

afterEach(() => {
    vi.clearAllMocks()
})

describe('VS Code local-store provider credentials', () => {
    const credential: TokenCredential = { getToken: vi.fn(async () => null) }

    it.each([undefined, credential])('keeps offline data usable without acquiring credential %s', async (foundryCredential) => {
        const provider = createLocalStoreDataProvider({ foundryCredential })
        try {
            expect(buildFoundryMeetingExtractor).not.toHaveBeenCalled()
            expect(provider.mode).toBe('sample')
            expect(provider.inferenceMode).toBe('sample')
            expect(credential.getToken).not.toHaveBeenCalled()
            expect((await provider.listAccounts()).length).toBeGreaterThan(0)
        } finally {
            await provider.dispose()
        }
    })

    it('keeps credentials optional for offline sample use', async () => {
        const provider = createLocalStoreDataProvider()
        try {
            expect(buildFoundryMeetingExtractor).not.toHaveBeenCalled()
            expect(provider.mode).toBe('sample')
            expect((await provider.listAccounts()).length).toBeGreaterThan(0)
        } finally {
            await provider.dispose()
        }
    })
})
