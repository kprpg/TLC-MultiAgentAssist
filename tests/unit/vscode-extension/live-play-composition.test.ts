import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLiveDataProvider } from '../../../apps/vscode-extension/src/live-provider.js'
import { JsonFilePortfolioPreferenceStore, MemoryPortfolioPreferenceStore } from '../../../packages/connectors/common/index.js'
import { LiveMsxConnector } from '../../../packages/connectors/msx/index.js'
import * as workflows from '../../../packages/orchestrator/workflows/index.js'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

function setup(preferenceFilePath?: string) {
    const fetcher = vi.fn().mockRejectedValue(new Error('Unexpected network request.'))
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(LiveMsxConnector.prototype, 'getCurrentUserId').mockResolvedValue('user-1')
    const listAccounts = vi.spyOn(LiveMsxConnector.prototype, 'listAccounts').mockRejectedValue(new Error('Portfolio enumeration is not needed for Plays.'))
    const createHost = vi.spyOn(workflows, 'createLivePlayWorkflowHost')
    const provider = createLiveDataProvider(async () => 'test-token', 'seller@example.test', undefined, false, preferenceFilePath)
    const options = createHost.mock.calls[0]?.[0]
    if (!options?.resolveExcludedAccountIds) throw new Error('Expected a hidden-account resolver.')
    return { provider, resolveHidden: options.resolveExcludedAccountIds, listAccounts, fetcher }
}

describe('live Play composition', () => {
    it('reads in-memory hidden preferences without enumerating the portfolio or calling a data source', async () => {
        const read = vi.spyOn(MemoryPortfolioPreferenceStore.prototype, 'read').mockResolvedValue({
            manualAccountIds: [], hiddenAccountIds: ['account-hidden'], revision: 1
        })
        const { provider, resolveHidden, listAccounts, fetcher } = setup()
        try {
            expect(await resolveHidden()).toEqual(['account-hidden'])
            expect(read).toHaveBeenCalledWith('user-1')
            expect(listAccounts).not.toHaveBeenCalled()
            expect(fetcher).not.toHaveBeenCalled()
        } finally {
            await provider.dispose()
        }
    })

    it('reads persisted preferences freshly for every Play and remains scoped to the signed-in user', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'tlc-play-preferences-'))
        const preferenceFilePath = join(directory, 'preferences.json')
        const store = new JsonFilePortfolioPreferenceStore(preferenceFilePath)
        await store.setVisibility('user-1', 'account-hidden', 'hidden')
        await store.setVisibility('other-user', 'account-other', 'hidden')
        const { provider, resolveHidden, listAccounts } = setup(preferenceFilePath)
        try {
            expect(await resolveHidden()).toEqual(['account-hidden'])
            await store.setVisibility('user-1', 'account-hidden', 'visible')
            expect(await resolveHidden()).toEqual([])
            expect(listAccounts).not.toHaveBeenCalled()
        } finally {
            await provider.dispose()
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('surfaces preference failures rather than treating hidden accounts as visible', async () => {
        vi.spyOn(MemoryPortfolioPreferenceStore.prototype, 'read').mockRejectedValue(new Error('Preferences unavailable.'))
        const { provider, resolveHidden } = setup()
        try {
            await expect(resolveHidden()).rejects.toThrow('Preferences unavailable.')
        } finally {
            await provider.dispose()
        }
    })
})
