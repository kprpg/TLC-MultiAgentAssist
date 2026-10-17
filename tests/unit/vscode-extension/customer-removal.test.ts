import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../../../packages/common/index.js'
import { createRemoveCustomerAction, isSuccessfulCustomerMutation, type CustomerRemovalUi } from '../../../apps/vscode-extension/src/customer-removal.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'

vi.mock('../../../apps/vscode-extension/src/live-provider.js', () => ({ buildFoundryMeetingExtractor: () => undefined }))

const account: Account = { id: 'account-northwind', name: 'Northwind Health', segment: 'Enterprise', tpid: '1000003' }

function setup() {
    const provider = {
        listAccounts: vi.fn(async (): Promise<Account[]> => [account, { id: 'removed', name: 'Removed customer', segment: 'Enterprise', visibility: 'hidden' }]),
        setAccountVisibility: vi.fn(async () => ({ ...account, visibility: 'hidden' as const }))
    }
    const ui: CustomerRemovalUi = {
        chooseAccount: vi.fn(async () => account.id),
        confirmRemoval: vi.fn(async () => true),
        showInformation: vi.fn(),
        showError: vi.fn()
    }
    const onRemoved = vi.fn()
    const getProvider = vi.fn(() => provider)
    return { provider, ui, onRemoved, getProvider }
}

describe('native Remove customer action', () => {
    it('chooses only a visible tracked account and refreshes after named confirmation', async () => {
        const options = setup()
        await createRemoveCustomerAction(options)()
        expect(options.ui.chooseAccount).toHaveBeenCalledWith([account])
        expect(options.ui.confirmRemoval).toHaveBeenCalledWith(account)
        expect(options.provider.setAccountVisibility).toHaveBeenCalledExactlyOnceWith(account.id, 'hidden')
        expect(options.onRemoved).toHaveBeenCalledOnce()
        expect(options.ui.showError).not.toHaveBeenCalled()
    })

    it('confirms a contextual account without another chooser', async () => {
        const options = setup()
        await createRemoveCustomerAction(options)(account.id)
        expect(options.ui.chooseAccount).not.toHaveBeenCalled()
        expect(options.ui.confirmRemoval).toHaveBeenCalledWith(account)
    })

    it.each(['chooser', 'confirmation'] as const)('does not mutate or refresh when the %s is cancelled', async (step) => {
        const options = setup()
        if (step === 'chooser') vi.mocked(options.ui.chooseAccount).mockResolvedValue(undefined)
        else vi.mocked(options.ui.confirmRemoval).mockResolvedValue(false)
        await createRemoveCustomerAction(options)()
        expect(options.provider.setAccountVisibility).not.toHaveBeenCalled()
        expect(options.onRemoved).not.toHaveBeenCalled()
        expect(options.ui.showInformation).not.toHaveBeenCalled()
    })

    it('reports an unavailable contextual account instead of choosing another one', async () => {
        const options = setup()
        await createRemoveCustomerAction(options)('removed')
        expect(options.provider.setAccountVisibility).not.toHaveBeenCalled()
        expect(options.ui.showError).toHaveBeenCalledWith(expect.stringContaining('no longer in your tracked portfolio'))
    })

    it('explains an empty portfolio without attempting a mutation', async () => {
        const options = setup()
        options.provider.listAccounts.mockResolvedValue([])
        await createRemoveCustomerAction(options)()
        expect(options.ui.showInformation).toHaveBeenCalledWith(expect.stringContaining('No customers to remove'))
        expect(options.provider.setAccountVisibility).not.toHaveBeenCalled()
    })

    it('reports mutation failures without refreshing or claiming success', async () => {
        const options = setup()
        options.provider.setAccountVisibility.mockRejectedValue(new Error('Preference store unavailable'))
        await createRemoveCustomerAction(options)()
        expect(options.ui.showError).toHaveBeenCalledWith('Could not remove customer. Preference store unavailable')
        expect(options.onRemoved).not.toHaveBeenCalled()
        expect(options.ui.showInformation).not.toHaveBeenCalled()
    })

    it('distinguishes a saved removal from a failed UI refresh', async () => {
        const options = setup()
        options.onRemoved.mockRejectedValue(new Error('Refresh failed'))
        await createRemoveCustomerAction(options)()
        expect(options.ui.showError).toHaveBeenCalledWith('Customer removed, but TLC could not refresh its working views. Refresh failed')
        expect(options.provider.setAccountVisibility).toHaveBeenCalledOnce()
    })

    it('rejects a data-source change while confirmation is open', async () => {
        const options = setup()
        options.getProvider.mockReturnValueOnce(options.provider).mockReturnValue({ ...options.provider })
        await createRemoveCustomerAction(options)()
        expect(options.provider.setAccountVisibility).not.toHaveBeenCalled()
        expect(options.ui.showError).toHaveBeenCalledWith(expect.stringContaining('data source changed'))
    })

    it('prevents concurrent removals while a chooser is pending', async () => {
        const options = setup()
        let release!: (value: string | undefined) => void
        vi.mocked(options.ui.chooseAccount).mockImplementation(() => new Promise((resolve) => { release = resolve }))
        const remove = createRemoveCustomerAction(options)
        const pending = remove()
        await vi.waitFor(() => expect(options.ui.chooseAccount).toHaveBeenCalledOnce())
        await remove()
        expect(options.ui.showInformation).toHaveBeenCalledWith('A customer removal is already in progress.')
        release(account.id)
        await pending
        expect(options.provider.setAccountVisibility).toHaveBeenCalledOnce()
    })
})

describe('workbench-to-native portfolio refresh', () => {
    it('notifies for successful validated account mutations only', async () => {
        const provider = createSampleDataProvider()
        try {
            for (const method of ['addAccount', 'setAccountVisibility'] as const) {
                const request = { kind: 'request', id: method, method, params: { accountId: account.id, ...(method === 'setAccountVisibility' ? { visibility: 'hidden' } : {}) } }
                const response = await routeBridgeMessage(provider, request)
                expect(isSuccessfulCustomerMutation(request, response)).toBe(true)
                expect(isSuccessfulCustomerMutation(request, { ...response, id: 'different-request' })).toBe(false)
            }
            const invalid = { kind: 'request', id: 'invalid', method: 'setAccountVisibility', params: { accountId: account.id, visibility: 'deleted' } }
            expect(isSuccessfulCustomerMutation(invalid, await routeBridgeMessage(provider, invalid))).toBe(false)
            const read = { kind: 'request', id: 'read', method: 'listAccounts', params: {} }
            expect(isSuccessfulCustomerMutation(read, await routeBridgeMessage(provider, read))).toBe(false)
        } finally {
            await provider.setAccountVisibility(account.id, 'visible')
            await provider.dispose()
        }
    })
})
