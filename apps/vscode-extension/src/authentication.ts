import * as vscode from 'vscode'
import type { AccessToken, TokenCredential } from '@azure/core-auth'

export interface DelegatedToken {
    token: string
    account: string
}

const pendingSessions = new Map<string, Promise<vscode.AuthenticationSession | undefined>>()
const reconnectMessage = 'Microsoft sign-in is required. Run TLC: Use Live Data to reconnect.'

export function acquireMicrosoftSession(
    scopes: readonly string[],
    createIfNone: boolean,
    account?: vscode.AuthenticationSessionAccountInformation
): Promise<vscode.AuthenticationSession | undefined> {
    const key = JSON.stringify([[...scopes].sort(), createIfNone, account?.id])
    const pending = pendingSessions.get(key)
    if (pending) return pending

    const request = Promise.resolve(vscode.authentication.getSession('microsoft', [...scopes], {
        ...(createIfNone ? { createIfNone: true } : { silent: true }),
        ...(account ? { account } : {})
    })).finally(() => { pendingSessions.delete(key) })
    pendingSessions.set(key, request)
    return request
}

function resourceScopes(resource: string): string[] {
    return [`${resource.replace(/\/+$/, '')}/.default`]
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
    const session = await acquireMicrosoftSession(resourceScopes(resource), createIfNone)
    if (!session) throw new Error(createIfNone ? 'No Microsoft account session was granted.' : reconnectMessage)
    return { token: session.accessToken, account: session.account.label }
}

export async function createDelegatedTokenProvider(resource: string): Promise<{ account: string; getToken(): Promise<string> }> {
    const scopes = resourceScopes(resource)
    const session = await acquireMicrosoftSession(scopes, true)
    if (!session) throw new Error('No Microsoft account session was granted.')
    return {
        account: session.account.label,
        async getToken(): Promise<string> {
            const current = await acquireMicrosoftSession(scopes, false, session.account)
            if (!current) throw new Error(reconnectMessage)
            if (current.account.id !== session.account.id) {
                throw new Error('The Microsoft account changed. Run TLC: Use Live Data to reconnect.')
            }
            return current.accessToken
        }
    }
}

export function createVsCodeTokenCredential(tenantId: string): TokenCredential {
    return {
        async getToken(scopes: string | string[]): Promise<AccessToken> {
            const requestedScopes = Array.isArray(scopes) ? scopes : [scopes]
            const session = await acquireMicrosoftSession(
                [`VSCODE_TENANT:${tenantId}`, ...requestedScopes],
                true
            )
            if (!session) throw new Error('No Microsoft account session was granted for Microsoft Foundry.')
            return {
                token: session.accessToken,
                expiresOnTimestamp: tokenExpiry(session.accessToken)
            }
        }
    }
}
