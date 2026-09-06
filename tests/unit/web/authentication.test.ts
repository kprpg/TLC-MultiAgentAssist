import { describe, expect, it, vi } from 'vitest'
import { assertLoopbackHost, createAzureCliAuthentication } from '../../../apps/web/src/authentication.js'

describe('local web authentication', () => {
    it('acquires an MSX token and validates the signed-in corporate identity', async () => {
        const token = createToken({ preferred_username: 'signed-in-user@microsoft.com' })
        const credential = {
            getToken: vi.fn().mockResolvedValue({ token, expiresOnTimestamp: Date.now() + 60_000 })
        }

        await expect(createAzureCliAuthentication({ credential })()).resolves.toEqual({
            accessToken: token,
            clientPrincipal: 'signed-in-user@microsoft.com'
        })
        expect(credential.getToken).toHaveBeenCalledWith('https://microsoftsales.crm.dynamics.com/.default')
    })

    it('rejects a token for an identity outside the configured domain', async () => {
        const token = createToken({ preferred_username: 'personal@example.com' })
        const credential = {
            getToken: vi.fn().mockResolvedValue({ token, expiresOnTimestamp: Date.now() + 60_000 })
        }

        await expect(createAzureCliAuthentication({ credential })()).rejects.toThrow(
            'Sign in with an @microsoft.com account'
        )
    })

    it('prevents local live mode from binding beyond the loopback interface', () => {
        expect(() => assertLoopbackHost('127.0.0.1')).not.toThrow()
        expect(() => assertLoopbackHost('0.0.0.0')).toThrow('must bind to a loopback host')
    })
})

function createToken(claims: Record<string, unknown>): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    return `${encode({ alg: 'none' })}.${encode(claims)}.signature`
}