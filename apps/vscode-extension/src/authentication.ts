import * as vscode from 'vscode'
import type { AccessToken, TokenCredential } from '@azure/core-auth'
import { currentFoundrySignIn } from './foundry-sign-in.js'

export interface DelegatedToken {
    token: string
    account: string
}

const pendingSessions = new Map<string, Promise<vscode.AuthenticationSession | undefined>>()
const reconnectMessage = 'Microsoft sign-in is required. Run TLC: Use Live Data to reconnect.'

export function acquireMicrosoftSession(
    scopes: readonly string[],
    createIfNone: boolean,
    account?: vscode.AuthenticationSessionAccountInformation,
    forceNewSession = false
): Promise<vscode.AuthenticationSession | undefined> {
    const key = JSON.stringify([[...scopes].sort(), createIfNone, account?.id, forceNewSession])
    const pending = pendingSessions.get(key)
    if (pending) return pending

    const request = Promise.resolve(vscode.authentication.getSession('microsoft', [...scopes], {
        ...(forceNewSession ? { forceNewSession: { detail: 'Reconnect to Microsoft Foundry using the selected account.' } }
            : createIfNone ? { createIfNone: true } : { silent: true }),
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
    let account: vscode.AuthenticationSessionAccountInformation | undefined
    const credential: TokenCredential = {
        async getToken(scopes, options): Promise<AccessToken> {
            const requested = [...new Set(Array.isArray(scopes) ? scopes : [scopes])].sort()
            const requestedScopes = [`VSCODE_TENANT:${tenantId}`, ...requested]
            const context = currentFoundrySignIn()
            const checkCancellation = () => {
                context?.signal?.throwIfAborted()
                if (options?.abortSignal?.aborted) throw new Error('Microsoft Foundry sign-in was cancelled.')
                if (context?.failure) throw context.failure
            }
            const fail = (message: string, cause?: unknown): never => {
                const error = new Error(message, { cause })
                if (context) context.failure = error
                throw error
            }
            const validate = (session: vscode.AuthenticationSession): AccessToken | undefined => {
                checkCancellation()
                if (account && session.account.id !== account.id) {
                    fail('The Microsoft Foundry account changed. Select the original Foundry account or reload TLC to choose another account.')
                }
                const tokenTenant = tokenTenantId(session.accessToken)
                if (tokenTenant && tokenTenant.toLowerCase() !== tenantId.toLowerCase()) {
                    fail('Microsoft Foundry returned a token for a different tenant. Verify the configured project tenant and your access before retrying.')
                }
                account = session.account
                const expiresOnTimestamp = tokenExpiry(session.accessToken)
                return expiresOnTimestamp > Date.now() ? { token: session.accessToken, expiresOnTimestamp } : undefined
            }
            const acquire = async (): Promise<AccessToken> => {
                checkCancellation()
                try {
                    const session = await acquireMicrosoftSession(requestedScopes, false, account)
                    if (session) {
                        const token = validate(session)
                        if (token) return token
                    }
                } catch (error) {
                    checkCancellation()
                    if (terminalSignInError(error)) fail('Microsoft Foundry access is unavailable in the configured tenant. Verify tenant membership and consent before retrying.', error)
                    if (cancelledSignIn(error)) fail('Microsoft Foundry sign-in was cancelled.', error)
                }
                if (!context) throw new Error('Microsoft Foundry sign-in is required. Submit a Guidance prompt to reconnect.')
                while (context.attempts < 3) {
                    checkCancellation()
                    context.attempts++
                    try {
                        const session = await acquireMicrosoftSession(requestedScopes, true, account, Boolean(account) || context.attempts > 1)
                        checkCancellation()
                        if (!session) return fail('Microsoft Foundry sign-in was cancelled.')
                        const token = validate(session)
                        if (token) return token
                    } catch (error) {
                        checkCancellation()
                        if (cancelledSignIn(error)) fail('Microsoft Foundry sign-in was cancelled.', error)
                        if (terminalSignInError(error)) fail('Microsoft Foundry access is unavailable in the configured tenant. Verify tenant membership and consent before retrying.', error)
                        if (context.attempts >= 3) fail('Microsoft Foundry sign-in failed after 3 attempts. Verify access to the configured tenant and submit a new prompt to retry.', error)
                    }
                }
                return fail('Microsoft Foundry sign-in failed after 3 attempts. Submit a new prompt to retry.')
            }
            if (!context) return acquire()
            let pending = context.pending.get(credential)
            if (!pending) { pending = new Map(); context.pending.set(credential, pending) }
            const key = JSON.stringify(requested)
            const existing = pending.get(key)
            if (existing) return existing
            const request = acquire().finally(() => { pending.delete(key) })
            pending.set(key, request)
            return request
        }
    }
    return credential
}

function tokenTenantId(token: string): string | undefined {
    const payload = token.split('.')[1]
    if (!payload) return undefined
    let claims: unknown
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) }
    catch { return undefined }
    return claims && typeof claims === 'object' && 'tid' in claims && typeof claims.tid === 'string' ? claims.tid : undefined
}

function cancelledSignIn(error: unknown): boolean {
    return error instanceof Error && /cancel|did not consent|user denied|AADSTS65004/i.test(error.message)
}

function terminalSignInError(error: unknown): boolean {
    return error instanceof Error && /AADSTS(?:50020|50105|700016|90094)|does not exist in tenant|invalid.tenant|invalid.client|admin.consent|access.denied/i.test(error.message)
}
