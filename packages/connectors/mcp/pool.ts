import type { McpServer, McpServerId, McpServerRegistry } from '../../common/index.js'
import { McpHttpClient, McpTransportError } from './index.js'
import type { McpAccessTokenProvider } from './index.js'

export type McpCircuitState = 'closed' | 'open' | 'half-open'
export type McpServerHealth = 'cold' | 'healthy' | 'degraded' | 'unavailable' | 'disposed'

export type McpServerHealthSnapshot = {
    serverId: McpServerId
    health: McpServerHealth
    circuit: McpCircuitState
    activeCalls: number
    consecutiveFailures: number
}

export type McpPoolErrorCode = 'circuit_open' | 'disposed' | 'server_disabled'

export class McpPoolError extends Error {
    constructor(readonly code: McpPoolErrorCode, message: string) {
        super(message)
        this.name = 'McpPoolError'
    }
}

type PooledClient = Pick<McpHttpClient, 'initialize' | 'listTools' | 'callTool' | 'dispose'>
type ClientFactory = (server: McpServer) => PooledClient

type Waiter = {
    resolve: () => void
    reject: (error: McpPoolError) => void
    signal?: AbortSignal
    abort?: () => void
}

type PoolEntry = {
    config: McpServer
    client: PooledClient | undefined
    initialization: Promise<PooledClient> | undefined
    activeCalls: number
    waiters: Waiter[]
    health: McpServerHealth
    circuit: McpCircuitState
    consecutiveFailures: number
    openedAt: number | undefined
    halfOpenInFlight: boolean
}

export type McpClientPoolOptions = {
    registry: McpServerRegistry
    accessTokenProvider: (server: McpServer) => ReturnType<McpAccessTokenProvider>
    clientFactory?: ClientFactory
    now?: () => number
}

const retryableCodes = new Set(['rate_limited', 'timeout', 'transport'])

export class McpClientPool {
    private readonly entries = new Map<McpServerId, PoolEntry>()
    private readonly createClient: ClientFactory
    private readonly now: () => number
    private disposed = false

    constructor(options: McpClientPoolOptions) {
        this.now = options.now ?? Date.now
        this.createClient = options.clientFactory ?? ((server) => new McpHttpClient({
            serverUrl: server.serverUrl,
            accessTokenProvider: () => options.accessTokenProvider(server),
            timeoutMs: server.limits.callTimeoutMs,
            maxResponseBytes: server.limits.maxResultBytes
        }))
        const connections = new Map<string, PoolEntry>()
        for (const server of options.registry.servers) {
            if (!server.enabled) continue
            const connectionId = server.connectionId ?? server.id
            const existing = connections.get(connectionId)
            if (existing) {
                this.entries.set(server.id, existing)
                continue
            }
            const entry: PoolEntry = {
                config: server,
                client: undefined,
                initialization: undefined,
                activeCalls: 0,
                waiters: [],
                health: 'cold',
                circuit: 'closed',
                consecutiveFailures: 0,
                openedAt: undefined,
                halfOpenInFlight: false
            }
            connections.set(connectionId, entry)
            this.entries.set(server.id, entry)
        }
    }

    async listTools(serverId: McpServerId, signal?: AbortSignal) {
        return this.execute(serverId, (client) => client.listTools(signal), signal)
    }

    async callTool(
        serverId: McpServerId,
        name: string,
        args: Record<string, unknown>,
        signal?: AbortSignal
    ) {
        return this.execute(serverId, (client) => client.callTool(name, args, signal), signal)
    }

    getHealth(serverId: McpServerId): McpServerHealthSnapshot {
        const entry = this.getEntry(serverId)
        return {
            serverId,
            health: entry.health,
            circuit: entry.circuit,
            activeCalls: entry.activeCalls,
            consecutiveFailures: entry.consecutiveFailures
        }
    }

    async dispose(): Promise<void> {
        if (this.disposed) return
        this.disposed = true
        const error = new McpPoolError('disposed', 'MCP client pool has been disposed.')
        const disposals: Promise<void>[] = []
        for (const entry of new Set(this.entries.values())) {
            entry.health = 'disposed'
            for (const waiter of entry.waiters.splice(0)) {
                waiter.signal?.removeEventListener('abort', waiter.abort ?? (() => undefined))
                waiter.reject(error)
            }
            if (entry.client) disposals.push(entry.client.dispose())
        }
        await Promise.allSettled(disposals)
    }

    private async execute<T>(
        serverId: McpServerId,
        operation: (client: PooledClient) => Promise<T>,
        signal?: AbortSignal
    ): Promise<T> {
        const entry = this.getEntry(serverId)
        await this.acquire(entry, signal)
        try {
            this.assertCircuitAvailable(entry)
            for (let attempt = 1; attempt <= entry.config.retry.maxAttempts; attempt += 1) {
                try {
                    const client = await this.getClient(entry, signal)
                    const result = await operation(client)
                    this.recordSuccess(entry)
                    return result
                } catch (error) {
                    const retryable = this.isRetryable(error, entry)
                    if (!retryable || attempt === entry.config.retry.maxAttempts) {
                        this.recordFailure(entry, retryable)
                        throw error
                    }
                    entry.health = 'degraded'
                    await this.resetClient(entry)
                    await this.delay(this.retryDelay(entry, attempt, error), signal)
                }
            }
            throw new McpPoolError('circuit_open', 'MCP retry attempts were exhausted.')
        } finally {
            if (entry.circuit === 'half-open') entry.halfOpenInFlight = false
            this.release(entry)
        }
    }

    private getEntry(serverId: McpServerId): PoolEntry {
        if (this.disposed) throw new McpPoolError('disposed', 'MCP client pool has been disposed.')
        const entry = this.entries.get(serverId)
        if (!entry) throw new McpPoolError('server_disabled', 'MCP server is not enabled.')
        return entry
    }

    private assertCircuitAvailable(entry: PoolEntry): void {
        if (entry.circuit === 'open') {
            const elapsed = this.now() - (entry.openedAt ?? this.now())
            if (elapsed < entry.config.circuitBreaker.openDurationMs) {
                throw new McpPoolError('circuit_open', 'MCP server circuit is open.')
            }
            entry.circuit = 'half-open'
            entry.halfOpenInFlight = false
        }
        if (entry.circuit === 'half-open') {
            if (entry.halfOpenInFlight) throw new McpPoolError('circuit_open', 'MCP server circuit probe is in progress.')
            entry.halfOpenInFlight = true
        }
    }

    private async getClient(entry: PoolEntry, signal?: AbortSignal): Promise<PooledClient> {
        if (entry.client) return entry.client
        if (!entry.initialization) {
            const client = this.createClient(entry.config)
            entry.initialization = client.initialize(signal)
                .then(() => {
                    if (this.disposed) {
                        throw new McpPoolError('disposed', 'MCP client pool has been disposed.')
                    }
                    entry.client = client
                    entry.health = 'healthy'
                    return client
                })
                .catch(async (error: unknown) => {
                    await client.dispose().catch(() => undefined)
                    throw error
                })
                .finally(() => {
                    entry.initialization = undefined
                })
        }
        return entry.initialization
    }

    private async resetClient(entry: PoolEntry): Promise<void> {
        const client = entry.client
        entry.client = undefined
        entry.initialization = undefined
        if (client) await client.dispose().catch(() => undefined)
    }

    private isRetryable(error: unknown, entry: PoolEntry): boolean {
        if (!(error instanceof McpTransportError)) return false
        if (!retryableCodes.has(error.code)) return false
        return error.status === undefined || entry.config.retry.retryOnStatus.includes(error.status)
    }

    private retryDelay(entry: PoolEntry, attempt: number, error: unknown): number {
        const configuredDelay = entry.config.retry.initialDelayMs * entry.config.retry.backoffMultiplier ** (attempt - 1)
        const retryAfterMs = error instanceof McpTransportError ? error.retryAfterMs ?? 0 : 0
        return Math.min(Math.max(configuredDelay, retryAfterMs), entry.config.circuitBreaker.openDurationMs)
    }

    private recordSuccess(entry: PoolEntry): void {
        entry.health = 'healthy'
        entry.circuit = 'closed'
        entry.consecutiveFailures = 0
        entry.openedAt = undefined
        entry.halfOpenInFlight = false
    }

    private recordFailure(entry: PoolEntry, transient: boolean): void {
        entry.health = transient ? 'degraded' : 'unavailable'
        if (!transient) return
        entry.consecutiveFailures += 1
        if (entry.circuit === 'half-open' || entry.consecutiveFailures >= entry.config.circuitBreaker.failureThreshold) {
            entry.circuit = 'open'
            entry.health = 'unavailable'
            entry.openedAt = this.now()
        }
    }

    private async acquire(entry: PoolEntry, signal?: AbortSignal): Promise<void> {
        if (entry.activeCalls < entry.config.limits.maxConcurrentCalls) {
            entry.activeCalls += 1
            return
        }
        await new Promise<void>((resolve, reject) => {
            const waiter: Waiter = { resolve, reject, ...(signal ? { signal } : {}) }
            if (signal) {
                waiter.abort = () => {
                    const index = entry.waiters.indexOf(waiter)
                    if (index >= 0) entry.waiters.splice(index, 1)
                    reject(new McpTransportError('aborted', 'MCP request was cancelled.'))
                }
                if (signal.aborted) {
                    waiter.abort()
                    return
                }
                signal.addEventListener('abort', waiter.abort, { once: true })
            }
            entry.waiters.push(waiter)
        })
        entry.activeCalls += 1
    }

    private release(entry: PoolEntry): void {
        entry.activeCalls -= 1
        const waiter = entry.waiters.shift()
        if (!waiter) return
        waiter.signal?.removeEventListener('abort', waiter.abort ?? (() => undefined))
        waiter.resolve()
    }

    private async delay(delayMs: number, signal?: AbortSignal): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const finish = () => {
                signal?.removeEventListener('abort', abort)
                resolve()
            }
            const timer = setTimeout(finish, delayMs)
            const abort = () => {
                clearTimeout(timer)
                signal?.removeEventListener('abort', abort)
                reject(new McpTransportError('aborted', 'MCP request was cancelled.'))
            }
            if (signal?.aborted) {
                abort()
                return
            }
            signal?.addEventListener('abort', abort, { once: true })
        })
    }
}