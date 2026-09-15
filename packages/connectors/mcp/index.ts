import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
    StreamableHTTPClientTransport,
    StreamableHTTPError
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

export type McpAccessTokenProvider = () => Promise<string>

export type McpHttpClientOptions = {
    serverUrl: string
    accessTokenProvider: McpAccessTokenProvider
    timeoutMs?: number
    maxResponseBytes?: number
    maxRetryAfterMs?: number
    fetch?: typeof fetch
}

export type McpTransportErrorCode =
    | 'aborted'
    | 'disposed'
    | 'malformed_response'
    | 'rate_limited'
    | 'response_too_large'
    | 'timeout'
    | 'transport'
    | 'unauthorized'

export class McpTransportError extends Error {
    constructor(
        readonly code: McpTransportErrorCode,
        message: string,
        readonly status?: number,
        readonly retryAfterMs?: number
    ) {
        super(message)
        this.name = 'McpTransportError'
    }
}

const defaultTimeoutMs = 30_000
const defaultMaxResponseBytes = 2 * 1024 * 1024
const defaultMaxRetryAfterMs = 5_000

function requirePositiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive integer.`)
    }
    return value
}

function parseRetryAfter(value: string | null, now = Date.now()): number {
    if (!value) return 0
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
    const retryAt = Date.parse(value)
    return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : 0
}

async function waitForRetry(delayMs: number, signal: AbortSignal | null | undefined): Promise<void> {
    if (delayMs === 0) return
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs)
        const abort = () => {
            clearTimeout(timer)
            reject(new DOMException('The operation was aborted.', 'AbortError'))
        }
        if (signal?.aborted) {
            abort()
            return
        }
        signal?.addEventListener('abort', abort, { once: true })
    })
}

function capResponse(response: Response, maxResponseBytes: number): Response {
    const declaredLength = response.headers.get('content-length')
    if (declaredLength && Number(declaredLength) > maxResponseBytes) {
        void response.body?.cancel()
        throw new McpTransportError('response_too_large', 'MCP response exceeded the configured byte limit.')
    }
    if (!response.body) return response

    const reader = response.body.getReader()
    let receivedBytes = 0
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            const chunk = await reader.read()
            if (chunk.done) {
                controller.close()
                return
            }
            receivedBytes += chunk.value.byteLength
            if (receivedBytes > maxResponseBytes) {
                await reader.cancel()
                controller.error(new McpTransportError('response_too_large', 'MCP response exceeded the configured byte limit.'))
                return
            }
            controller.enqueue(chunk.value)
        },
        async cancel(reason) {
            await reader.cancel(reason)
        }
    })

    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    })
}

function normalizeError(error: unknown, signal?: AbortSignal): McpTransportError {
    if (error instanceof McpTransportError) return error
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return new McpTransportError('aborted', 'MCP request was cancelled.')
    }
    if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
        return new McpTransportError('timeout', 'MCP request timed out.')
    }
    if (error instanceof StreamableHTTPError) {
        if (error.code === 401 || error.code === 403) {
            return new McpTransportError('unauthorized', 'MCP server rejected delegated authorization.')
        }
        if (error.code === 429) {
            return new McpTransportError('rate_limited', 'MCP server rate limit was exceeded.')
        }
    }
    if (error instanceof SyntaxError || error instanceof McpError) {
        return new McpTransportError('malformed_response', 'MCP server returned an invalid protocol response.')
    }
    return new McpTransportError('transport', 'MCP transport request failed.')
}

export class McpHttpClient {
    private readonly client = new Client({ name: 'tlc-multi-agent-assist', version: '0.1.0' })
    private readonly transport: StreamableHTTPClientTransport
    private readonly timeoutMs: number
    private initialized = false
    private disposed = false

    constructor(options: McpHttpClientOptions) {
        const serverUrl = new URL(options.serverUrl)
        if (serverUrl.protocol !== 'https:' && serverUrl.protocol !== 'http:') {
            throw new TypeError('MCP server URL must use HTTP or HTTPS.')
        }
        this.timeoutMs = requirePositiveInteger(options.timeoutMs ?? defaultTimeoutMs, 'timeoutMs')
        const maxResponseBytes = requirePositiveInteger(
            options.maxResponseBytes ?? defaultMaxResponseBytes,
            'maxResponseBytes'
        )
        const maxRetryAfterMs = requirePositiveInteger(
            options.maxRetryAfterMs ?? defaultMaxRetryAfterMs,
            'maxRetryAfterMs'
        )
        const fetchImplementation = options.fetch ?? globalThis.fetch

        const authenticatedFetch: typeof fetch = async (input, init) => {
            const token = await options.accessTokenProvider()
            if (!token.trim()) throw new McpTransportError('unauthorized', 'Delegated authorization is unavailable.')
            const headers = new Headers(init?.headers)
            headers.set('authorization', `Bearer ${token}`)
            const requestInit = { ...init, headers }
            let response = await fetchImplementation(input, requestInit)
            if (response.status === 429) {
                const retryDelay = Math.min(parseRetryAfter(response.headers.get('retry-after')), maxRetryAfterMs)
                await response.body?.cancel()
                await waitForRetry(retryDelay, init?.signal)
                response = await fetchImplementation(input, requestInit)
                if (response.status === 429) {
                    await response.body?.cancel()
                    throw new McpTransportError(
                        'rate_limited',
                        'MCP server rate limit was exceeded.',
                        429,
                        Math.min(parseRetryAfter(response.headers.get('retry-after')), maxRetryAfterMs)
                    )
                }
            }
            return capResponse(response, maxResponseBytes)
        }

        this.transport = new StreamableHTTPClientTransport(serverUrl, { fetch: authenticatedFetch })
    }

    async initialize(signal?: AbortSignal): Promise<void> {
        this.assertUsable()
        if (this.initialized) return
        try {
            await this.client.connect(this.transport as Transport, this.requestOptions(signal))
            this.initialized = true
        } catch (error) {
            throw normalizeError(error, signal)
        }
    }

    async listTools(signal?: AbortSignal): ReturnType<Client['listTools']> {
        this.assertInitialized()
        try {
            return await this.client.listTools(undefined, this.requestOptions(signal))
        } catch (error) {
            throw normalizeError(error, signal)
        }
    }

    async callTool(
        name: string,
        args: Record<string, unknown>,
        signal?: AbortSignal
    ): ReturnType<Client['callTool']> {
        this.assertInitialized()
        try {
            return await this.client.callTool(
                { name, arguments: args },
                undefined,
                this.requestOptions(signal)
            )
        } catch (error) {
            throw normalizeError(error, signal)
        }
    }

    async dispose(): Promise<void> {
        if (this.disposed) return
        this.disposed = true
        this.initialized = false
        try {
            await this.client.close()
        } catch {
            throw new McpTransportError('transport', 'MCP transport disposal failed.')
        }
    }

    private requestOptions(signal?: AbortSignal) {
        return {
            timeout: this.timeoutMs,
            maxTotalTimeout: this.timeoutMs,
            ...(signal ? { signal } : {})
        }
    }

    private assertUsable(): void {
        if (this.disposed) throw new McpTransportError('disposed', 'MCP client has been disposed.')
    }

    private assertInitialized(): void {
        this.assertUsable()
        if (!this.initialized) throw new McpTransportError('transport', 'MCP client is not initialized.')
    }
}

export * from './pool.js'