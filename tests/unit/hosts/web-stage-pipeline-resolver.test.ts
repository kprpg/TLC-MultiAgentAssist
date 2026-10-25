import { describe, expect, it, vi } from 'vitest'
import { createWebStagePipelineResolver } from '../../../apps/web/src/runtime.js'

const auth = (principal: string, token: string) => ({ accessToken: token, clientPrincipal: principal, userEmail: `${principal}@example.test` })
const request = { contractVersion: '1.1', operation: 'get' }

describe('web Stage and Pipeline Review resolver', () => {
    it('serves the same synthetic host to everyone in sample mode', async () => {
        const resolve = createWebStagePipelineResolver('sample')
        const first = resolve(auth('a', 't1'))
        expect(resolve(auth('b', 't2'))).toBe(first)
        expect(await first.invoke(request)).toMatchObject({ kind: 'snapshot', mode: 'sample' })
    })

    it('uses the calling user token and reuses one host per principal in live modes', async () => {
        const tokens: string[] = []
        const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
            tokens.push(String((init?.headers as Record<string, string>)['Authorization']))
            return new Response('{}', { status: 401 })
        })
        const resolve = createWebStagePipelineResolver('easy-auth', { fetchImplementation })
        const first = resolve(auth('a', 'token-a1'))
        expect(await first.invoke(request)).toMatchObject({ kind: 'unavailable', code: 'unauthorized' })
        const again = resolve(auth('a', 'token-a2'))
        expect(await again.invoke(request)).toMatchObject({ kind: 'unavailable' })
        await resolve(auth('b', 'token-b')).invoke(request)
        expect(tokens.map((value) => value.replace(/^Bearer /, ''))).toEqual(['token-a1', 'token-a2', 'token-b'])
    })

    it('bounds the number of live sessions and evicts idle ones first', () => {
        let clock = 0
        const resolve = createWebStagePipelineResolver('easy-auth', { fetchImplementation: vi.fn<typeof fetch>(), now: () => clock, maxSessions: 2, idleMs: 1_000 })
        resolve(auth('a', 't')); resolve(auth('b', 't'))
        expect(() => resolve(auth('c', 't'))).toThrow(/session limit/i)
        clock = 5_000
        expect(() => resolve(auth('c', 't'))).not.toThrow()
    })
})
