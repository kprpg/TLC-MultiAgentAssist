import { describe, expect, it, vi } from 'vitest'
import { createWebSeReportingResolver } from '../../../apps/web/src/runtime.js'
import type { createSeReportingHost } from '../../../packages/orchestrator/se-reporting/composition.js'
import type { SeDataverseSource } from '../../../packages/connectors/se-reporting/dataverse.js'

const user = (index: number) => ({ userEmail: `user${index}@example.com` }) as never

describe('Web SE reporting resolver', () => {
    it('admits new users after earlier sessions have expired', () => {
        let clock = 0
        const resolve = createWebSeReportingResolver('sample', undefined, () => clock)
        for (let index = 0; index < 50; index += 1) resolve(user(index))
        expect(() => resolve(user(50))).toThrow('limit')
        clock = 3_600_001
        expect(() => resolve(user(50))).not.toThrow()
    })
    it('gives hosted callers a Dataverse source bound to their own current MSX token and never shares it between users', async () => {
        const seen: string[] = []
        const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
            seen.push(String((init?.headers as Record<string, string>)['Authorization']).replace(/^Bearer /, ''))
            return Response.json({ value: [] })
        })
        const sources = new Map<string, SeDataverseSource | undefined>()
        const createHost = vi.fn((options: Parameters<typeof createSeReportingHost>[0]) => {
            sources.set(String(createHost.mock.calls.length), options.dataverse)
            return { invoke: async () => ({ kind: 'ok' }) } as never
        })
        const resolve = createWebSeReportingResolver('easy-auth', undefined, Date.now, { createHost, fetchImplementation })
        const caller = (email: string, token: string) => ({ userEmail: email, accessToken: token, clientPrincipal: email }) as never
        resolve(caller('a@example.com', 'token-a1'))
        resolve(caller('a@example.com', 'token-a2'))
        resolve(caller('b@example.com', 'token-b'))
        expect(createHost).toHaveBeenCalledTimes(2)
        await sources.get('1')!.readRows('opportunities', { '$select': 'opportunityid' })
        await sources.get('2')!.readRows('opportunities', { '$select': 'opportunityid' })
        expect(seen).toEqual(['token-a2', 'token-b'])
    })

    it('does not build a Dataverse source in sample mode', () => {
        const createHost = vi.fn((options: Parameters<typeof createSeReportingHost>[0]) => ({ invoke: async () => ({ mode: options.mode }) }) as never)
        createWebSeReportingResolver('sample', undefined, Date.now, { createHost })({ userEmail: 'a@example.com' } as never)
        expect(createHost.mock.calls[0]![0].dataverse).toBeUndefined()
    })
})