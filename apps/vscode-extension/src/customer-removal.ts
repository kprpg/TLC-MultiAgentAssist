import type { Account } from '../../../packages/common/index.js'
import type { ExtensionDataProvider } from './data-provider.js'
import { requestEnvelopeSchema, type ResponseEnvelope } from './message-contracts.js'

type CustomerRemovalProvider = Pick<ExtensionDataProvider, 'listAccounts' | 'setAccountVisibility'>

export interface CustomerRemovalUi {
    chooseAccount(accounts: readonly Account[]): Promise<string | undefined>
    confirmRemoval(account: Account): Promise<boolean>
    showInformation(message: string): void
    showError(message: string): void
}

export function createRemoveCustomerAction({ getProvider, ui, onRemoved }: {
    getProvider(): CustomerRemovalProvider
    ui: CustomerRemovalUi
    onRemoved(): void | Promise<void>
}): (accountId?: string) => Promise<void> {
    let busy = false
    return async (accountId) => {
        if (busy) {
            ui.showInformation('A customer removal is already in progress.')
            return
        }
        busy = true
        let saved = false
        try {
            const provider = getProvider()
            const accounts = (await provider.listAccounts()).filter((item) => item.visibility !== 'hidden')
            if (accounts.length === 0 && accountId === undefined) {
                ui.showInformation('No customers to remove. Use Add customer to track a customer first.')
                return
            }
            const selectedId = accountId ?? await ui.chooseAccount(accounts)
            if (selectedId === undefined) return
            const account = accounts.find((item) => item.id === selectedId)
            if (!account) throw new Error('This customer is no longer in your tracked portfolio. Refresh and choose another customer.')
            if (!await ui.confirmRemoval(account)) return
            if (getProvider() !== provider) throw new Error('The data source changed. Reopen Remove customer and choose the intended account.')
            await provider.setAccountVisibility(account.id, 'hidden')
            saved = true
            await onRemoved()
            ui.showInformation('Customer removed from this TLC portfolio. Use Add customer to add it again.')
        } catch (cause) {
            const detail = cause instanceof Error ? cause.message : 'The request could not be completed.'
            ui.showError(saved ? `Customer removed, but TLC could not refresh its working views. ${detail}` : `Could not remove customer. ${detail}`)
        } finally {
            busy = false
        }
    }
}

export function isSuccessfulCustomerMutation(raw: unknown, response: ResponseEnvelope): boolean {
    const request = requestEnvelopeSchema.safeParse(raw)
    return response.ok && request.success && request.data.id === response.id
        && (request.data.method === 'addAccount' || request.data.method === 'setAccountVisibility')
}
