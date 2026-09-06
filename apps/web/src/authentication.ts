import { AzureCliCredential } from '@azure/identity'
import type { TokenCredential } from '@azure/core-auth'
import type { AuthenticatedRequest } from './app.js'

const defaultMsxScope = 'https://microsoftsales.crm.dynamics.com/.default'

export interface AzureCliAuthenticationOptions {
    credential?: TokenCredential
    scope?: string
    expectedUserDomain?: string
}

export function createAzureCliAuthentication(options: AzureCliAuthenticationOptions = {}) {
    const credential = options.credential ?? new AzureCliCredential({ processTimeoutInMs: 30_000 })
    const scope = options.scope ?? defaultMsxScope
    const expectedUserDomain = options.expectedUserDomain ?? '@microsoft.com'

    return async (): Promise<AuthenticatedRequest> => {
        const accessToken = await credential.getToken(scope)
        if (!accessToken) throw new Error('Azure CLI did not return an MSX access token.')

        return {
            accessToken: accessToken.token,
            clientPrincipal: readMicrosoftCorpId(accessToken.token, expectedUserDomain)
        }
    }
}

export function assertLoopbackHost(host: string): void {
    if (!['127.0.0.1', 'localhost', '::1'].includes(host.toLowerCase())) {
        throw new Error('Azure CLI web mode must bind to a loopback host.')
    }
}

function readMicrosoftCorpId(accessToken: string, expectedUserDomain: string): string {
    const payloadPart = accessToken.split('.')[1]
    if (!payloadPart) throw new Error('Azure CLI returned an invalid MSX access token.')

    let claims: Record<string, unknown>
    try {
        claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>
    } catch {
        throw new Error('Azure CLI returned an unreadable MSX access token.')
    }

    const normalizedDomain = expectedUserDomain.toLowerCase()
    const corpId = [claims['preferred_username'], claims['upn'], claims['unique_name']]
        .find((claim): claim is string => typeof claim === 'string' && claim.toLowerCase().endsWith(normalizedDomain))
    if (!corpId) {
        throw new Error(`The active token is not an authorized identity. Sign in with an ${expectedUserDomain} account.`)
    }
    return corpId
}