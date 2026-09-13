import { describe, expect, it, vi } from 'vitest'
import type { McpServer, McpServerRegistry } from '../../../packages/common/index.js'
import {
    McpClientPool,
    McpPoolError,
    McpTransportError
} from '../../../packages/connectors/mcp/index.js'

function server(overrides: Partial<McpServer> = {}): McpServer {
    return {
        id: 'dataverse',
        displayName: 'Dataverse MCP',
        enabled: true,
        execution: 'local-client',
        serverUrl: 'https://mcp.example.test',
        serverLabel: 'dataverse_broad',
        authentication: { kind: 'entra-delegated', scopes: ['scope/.default'] },
        limits: {
            connectTimeoutMs: 1_000,
            callTimeoutMs: 1_000,
            maxConcurrentCalls: 2,
            maxToolCallsPerRequest: 4,
            maxRowsPerCall: 100,
            maxResultBytes: 10_000
        },
        retry: {
            maxAttempts: 3,
            initialDelayMs: 50,
            backoffMultiplier: 2,
            retryOnStatus: [429, 503]
        },
        circuitBreaker: { failureThreshold: 2, openDurationMs: 1_000 },
        ...overrides
    }
}

function registry(config = server()): McpServerRegistry {
    return { schemaVersion: 1, servers: [config] }
}

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((complete) => { resolve = complete })
    return { promise, resolve }
}

describe('McpClientPool', () => {
    it('shares one physical client across logical server aliases', async () => {
        const fakeClient = {
            initialize: vi.fn(async () => undefined),
            listTools: vi.fn(async () => ({ tools: [] })),
            callTool: vi.fn(async () => ({ content: [] })),
            dispose: vi.fn(async () => undefined)
        }
        const clientFactory = vi.fn(() => fakeClient)
        const dataverse = server({ connectionId: 'msxprod' })
        const msx = server({
            id: 'msx',
            connectionId: 'msxprod',
            displayName: 'MSX MCP',
            serverLabel: 'msx_sales'
        })
        const pool = new McpClientPool({
            registry: { schemaVersion: 1, servers: [dataverse, msx] },
            accessTokenProvider: async () => 'token',
            clientFactory
        })

        await pool.listTools('dataverse')
        await pool.callTool('msx', 'get_opportunity_360', {})

        expect(clientFactory).toHaveBeenCalledTimes(1)
        expect(fakeClient.initialize).toHaveBeenCalledTimes(1)
        expect(pool.getHealth('dataverse')).toMatchObject({ health: 'healthy' })
        expect(pool.getHealth('msx')).toMatchObject({ health: 'healthy' })
        await pool.dispose()
        expect(fakeClient.dispose).toHaveBeenCalledTimes(1)
    })

    it('lazily initializes one client and enforces per-server concurrency', async () => {
        const pending: Array<ReturnType<typeof deferred<unknown>>> = []
        let active = 0
        let peak = 0
        const fakeClient = {
            initialize: vi.fn(async () => undefined),
            listTools: vi.fn(async () => ({ tools: [] })),
            callTool: vi.fn(async () => {
                active += 1
                peak = Math.max(peak, active)
                const result = deferred<unknown>()
                pending.push(result)
                await result.promise
                active -= 1
                return { content: [] }
            }),
            dispose: vi.fn(async () => undefined)
        }
        const pool = new McpClientPool({
            registry: registry(),
            accessTokenProvider: async () => 'token',
            clientFactory: () => fakeClient
        })

        const calls = [
            pool.callTool('dataverse', 'read', {}),
            pool.callTool('dataverse', 'read', {}),
            pool.callTool('dataverse', 'read', {})
        ]
        await vi.waitFor(() => expect(pending).toHaveLength(2))
        expect(peak).toBe(2)
        expect(fakeClient.initialize).toHaveBeenCalledTimes(1)
        pending[0]?.resolve(undefined)
        await vi.waitFor(() => expect(pending).toHaveLength(3))
        pending[1]?.resolve(undefined)
        pending[2]?.resolve(undefined)
        await Promise.all(calls)
        await pool.dispose()
    })

    it('uses capped exponential retries and recovers health', async () => {
        vi.useFakeTimers()
        try {
            const fakeClient = {
                initialize: vi.fn(async () => undefined),
                listTools: vi.fn()
                    .mockRejectedValueOnce(new McpTransportError('transport', 'failed', 503))
                    .mockRejectedValueOnce(new McpTransportError('rate_limited', 'limited', 429, 75))
                    .mockResolvedValueOnce({ tools: [] }),
                callTool: vi.fn(),
                dispose: vi.fn(async () => undefined)
            }
            const pool = new McpClientPool({
                registry: registry(),
                accessTokenProvider: async () => 'token',
                clientFactory: () => fakeClient
            })

            const result = pool.listTools('dataverse')
            await vi.advanceTimersByTimeAsync(50)
            await vi.advanceTimersByTimeAsync(100)

            await expect(result).resolves.toEqual({ tools: [] })
            expect(fakeClient.listTools).toHaveBeenCalledTimes(3)
            expect(pool.getHealth('dataverse')).toMatchObject({ health: 'healthy', circuit: 'closed' })
            await pool.dispose()
        } finally {
            vi.useRealTimers()
        }
    })

    it('exhausts configured retries before recording one breaker failure', async () => {
        vi.useFakeTimers()
        try {
            const fakeClient = {
                initialize: vi.fn(async () => undefined),
                listTools: vi.fn(async () => { throw new McpTransportError('transport', 'failed', 503) }),
                callTool: vi.fn(),
                dispose: vi.fn(async () => undefined)
            }
            const pool = new McpClientPool({
                registry: registry(),
                accessTokenProvider: async () => 'token',
                clientFactory: () => fakeClient
            })

            const result = pool.listTools('dataverse')
            const rejection = expect(result).rejects.toMatchObject({ code: 'transport' })
            await vi.advanceTimersByTimeAsync(150)

            await rejection
            expect(fakeClient.listTools).toHaveBeenCalledTimes(3)
            expect(pool.getHealth('dataverse')).toMatchObject({
                health: 'degraded',
                circuit: 'closed',
                consecutiveFailures: 1
            })
            await pool.dispose()
        } finally {
            vi.useRealTimers()
        }
    })

    it('does not retry unauthorized failures', async () => {
        const fakeClient = {
            initialize: vi.fn(async () => undefined),
            listTools: vi.fn(async () => { throw new McpTransportError('unauthorized', 'denied', 401) }),
            callTool: vi.fn(),
            dispose: vi.fn(async () => undefined)
        }
        const pool = new McpClientPool({
            registry: registry(),
            accessTokenProvider: async () => 'token',
            clientFactory: () => fakeClient
        })

        await expect(pool.listTools('dataverse')).rejects.toMatchObject({ code: 'unauthorized' })
        expect(fakeClient.listTools).toHaveBeenCalledTimes(1)
        expect(pool.getHealth('dataverse').health).toBe('unavailable')
        await pool.dispose()
    })

    it('opens after the threshold and allows one successful half-open probe', async () => {
        let now = 0
        let shouldFail = true
        const fakeClient = {
            initialize: vi.fn(async () => undefined),
            listTools: vi.fn(async () => {
                if (shouldFail) throw new McpTransportError('transport', 'failed', 503)
                return { tools: [] }
            }),
            callTool: vi.fn(),
            dispose: vi.fn(async () => undefined)
        }
        const pool = new McpClientPool({
            registry: registry(server({
                retry: { maxAttempts: 1, initialDelayMs: 50, backoffMultiplier: 2, retryOnStatus: [503] },
                circuitBreaker: { failureThreshold: 1, openDurationMs: 1_000 }
            })),
            accessTokenProvider: async () => 'token',
            clientFactory: () => fakeClient,
            now: () => now
        })

        await expect(pool.listTools('dataverse')).rejects.toBeInstanceOf(McpTransportError)
        expect(pool.getHealth('dataverse')).toMatchObject({ circuit: 'open', health: 'unavailable' })
        await expect(pool.listTools('dataverse')).rejects.toBeInstanceOf(McpPoolError)
        expect(fakeClient.listTools).toHaveBeenCalledTimes(1)

        now = 1_000
        shouldFail = false
        await expect(pool.listTools('dataverse')).resolves.toEqual({ tools: [] })
        expect(pool.getHealth('dataverse')).toMatchObject({ circuit: 'closed', health: 'healthy' })
        await pool.dispose()
    })

    it('reopens when the half-open probe fails', async () => {
        let now = 0
        const fakeClient = {
            initialize: vi.fn(async () => undefined),
            listTools: vi.fn(async () => { throw new McpTransportError('transport', 'failed', 503) }),
            callTool: vi.fn(),
            dispose: vi.fn(async () => undefined)
        }
        const pool = new McpClientPool({
            registry: registry(server({
                retry: { maxAttempts: 1, initialDelayMs: 50, backoffMultiplier: 2, retryOnStatus: [503] },
                circuitBreaker: { failureThreshold: 1, openDurationMs: 1_000 }
            })),
            accessTokenProvider: async () => 'token',
            clientFactory: () => fakeClient,
            now: () => now
        })

        await expect(pool.listTools('dataverse')).rejects.toBeInstanceOf(McpTransportError)
        now = 1_000
        await expect(pool.listTools('dataverse')).rejects.toBeInstanceOf(McpTransportError)
        expect(pool.getHealth('dataverse')).toMatchObject({ circuit: 'open', consecutiveFailures: 2 })
        now = 1_500
        await expect(pool.listTools('dataverse')).rejects.toMatchObject({ code: 'circuit_open' })
        expect(fakeClient.listTools).toHaveBeenCalledTimes(2)
        await pool.dispose()
    })

    it('rejects queued calls when disposal begins', async () => {
        const pending = deferred<unknown>()
        const fakeClient = {
            initialize: vi.fn(async () => undefined),
            listTools: vi.fn(async () => ({ tools: [] })),
            callTool: vi.fn(async () => {
                await pending.promise
                return { content: [] }
            }),
            dispose: vi.fn(async () => undefined)
        }
        const pool = new McpClientPool({
            registry: registry(server({ limits: { ...server().limits, maxConcurrentCalls: 1 } })),
            accessTokenProvider: async () => 'token',
            clientFactory: () => fakeClient
        })

        const active = pool.callTool('dataverse', 'read', {})
        await vi.waitFor(() => expect(fakeClient.callTool).toHaveBeenCalledTimes(1))
        const queued = pool.callTool('dataverse', 'read', {})
        const queuedRejection = expect(queued).rejects.toMatchObject({ code: 'disposed' })
        await pool.dispose()
        await queuedRejection
        pending.resolve(undefined)
        await active
        expect(fakeClient.callTool).toHaveBeenCalledTimes(1)
        expect(fakeClient.dispose).toHaveBeenCalledTimes(1)
    })

    it('disposes a client whose initialization finishes after pool disposal', async () => {
        const initialization = deferred<void>()
        const fakeClient = {
            initialize: vi.fn(() => initialization.promise),
            listTools: vi.fn(async () => ({ tools: [] })),
            callTool: vi.fn(),
            dispose: vi.fn(async () => undefined)
        }
        const pool = new McpClientPool({
            registry: registry(),
            accessTokenProvider: async () => 'token',
            clientFactory: () => fakeClient
        })

        const call = pool.listTools('dataverse')
        const rejection = expect(call).rejects.toMatchObject({ code: 'disposed' })
        await vi.waitFor(() => expect(fakeClient.initialize).toHaveBeenCalledTimes(1))
        await pool.dispose()
        initialization.resolve(undefined)

        await rejection
        expect(fakeClient.listTools).not.toHaveBeenCalled()
        expect(fakeClient.dispose).toHaveBeenCalledTimes(1)
    })

    it('rejects disabled servers and deterministically disposes initialized clients', async () => {
        const fakeClient = {
            initialize: vi.fn(async () => undefined),
            listTools: vi.fn(async () => ({ tools: [] })),
            callTool: vi.fn(),
            dispose: vi.fn(async () => undefined)
        }
        const pool = new McpClientPool({
            registry: registry(server({ enabled: false })),
            accessTokenProvider: async () => 'token',
            clientFactory: () => fakeClient
        })

        await expect(pool.listTools('dataverse')).rejects.toMatchObject({ code: 'server_disabled' })
        await pool.dispose()
        await expect(pool.listTools('dataverse')).rejects.toMatchObject({ code: 'disposed' })
        expect(fakeClient.dispose).not.toHaveBeenCalled()
    })
})