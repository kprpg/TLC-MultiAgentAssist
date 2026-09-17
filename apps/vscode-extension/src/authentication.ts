import * as vscode from 'vscode'

export interface DelegatedToken {
    token: string
    account: string
}

/**
 * Acquires a delegated Microsoft token for the given resource via VS Code's built-in
 * Microsoft auth provider. Tokens are returned to the caller and must stay in the
 * extension host - never send them to the webview.
 */
export async function acquireDelegatedToken(resource: string, createIfNone: boolean): Promise<DelegatedToken> {
    const scopes = [`${resource.replace(/\/+$/, '')}/.default`]
    const session = await vscode.authentication.getSession('microsoft', scopes, { createIfNone })
    if (!session) throw new Error('No Microsoft account session was granted.')
    return { token: session.accessToken, account: session.account.label }
}
