import * as vscode from 'vscode'
import type { AccessToken, TokenCredential } from '@azure/core-auth'

export interface DelegatedToken {
    token: string
    account: string
}

function tokenExpiry(accessToken: string): number {
    const payload = accessToken.split('.')[1]
    if (!payload) return Date.now() + 5 * 60 * 1000

    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
        return typeof claims['exp'] === 'number'
            ? claims['exp'] * 1000
            : Date.now() + 5 * 60 * 1000
    } catch {
        return Date.now() + 5 * 60 * 1000
    }
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

export function createVsCodeTokenCredential(tenantId: string): TokenCredential {
    return {
        async getToken(scopes: string | string[]): Promise<AccessToken> {
            const requestedScopes = Array.isArray(scopes) ? scopes : [scopes]
            const session = await vscode.authentication.getSession(
                'microsoft',
                [`VSCODE_TENANT:${tenantId}`, ...requestedScopes],
                { createIfNone: true }
            )
            if (!session) throw new Error('No Microsoft account session was granted for Microsoft Foundry.')
            return {
                token: session.accessToken,
                expiresOnTimestamp: tokenExpiry(session.accessToken)
            }
        }
    }
}
