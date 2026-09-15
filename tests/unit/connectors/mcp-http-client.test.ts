import { describe, expect, it, vi } from 'vitest'
import { McpHttpClient, McpTransportError } from '../../../packages/connectors/mcp/index.js'

const initializeResult = {
    jsonrpc: '2.0',
    result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1.0.0' }
    }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init
    })
}

function protocolResponse(init?: RequestInit): Response {
    if (init?.method === 'DELETE') return new Response(null, { status: 200 })
    const request = JSON.parse(String(init?.body)) as { id?: string | number }
    if (request.id === undefined) return new Response(null, { status: 202 })
    return jsonResponse({ ...initializeResult, id: request.id })
}

describe('McpHttpClient transport boundaries', () => {
    it('injects delegated authorization without retaining it in errors', async () => {
        const token = 'delegated-secret-token'
        const requestHeaders: Headers[] = []
        const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
            requestHeaders.push(new Headers(init?.headers))
            return protocolResponse(init)
        })
        const client = new McpHttpClient({
            serverUrl: 'https://mcp.example.test',
            accessTokenProvider: async () => token,
            fetch: fetchMock
        })

        await client.initialize()

        expect(requestHeaders[0]?.get('authorization')).toBe(`Bearer ${token}`)
        await client.dispose()
    })

    it('retries one rate-limited request and honors a zero Retry-After', async () => {
        let rateLimited = false
        const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
            if (!rateLimited) {
                rateLimited = true
                return new Response('busy and sensitive', {
                    status: 429,
                    headers: { 'retry-after': '0' }
                })
            }
            return protocolResponse(init)
        })
        const client = new McpHttpClient({
            serverUrl: 'https://mcp.example.test',
            accessTokenProvider: async () => 'token',
            fetch: fetchMock
        })

        await client.initialize()

        expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
        expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(fetchMock.mock.calls[0]?.[1]?.body)
        await client.dispose()
    })

    it('returns bounded retry metadata when rate limiting persists', async () => {
        const client = new McpHttpClient({
            serverUrl: 'https://mcp.example.test',
            accessTokenProvider: async () => 'token',
            maxRetryAfterMs: 50,
            fetch: async () => new Response('sensitive throttling detail', {
                status: 429,
                headers: { 'retry-after': '60' }
            })
        })

        await expect(client.initialize()).rejects.toMatchObject({
            code: 'rate_limited',
            status: 429,
            retryAfterMs: 50
        })
    })

    it('normalizes authorization errors without returning the response body', async () => {
        const sensitiveBody = 'raw-secret-response-body'
        const client = new McpHttpClient({
            serverUrl: 'https://mcp.example.test',
            accessTokenProvider: async () => 'token',
            fetch: async () => new Response(sensitiveBody, { status: 401 })
        })

        const error = await client.initialize().catch((caught: unknown) => caught)

        expect(error).toBeInstanceOf(McpTransportError)
        expect(error).toMatchObject({ code: 'unauthorized' })
        expect(String(error)).not.toContain(sensitiveBody)
    })

    it('rejects malformed protocol responses with a static error', async () => {
        const client = new McpHttpClient({
            serverUrl: 'https://mcp.example.test',
            accessTokenProvider: async () => 'token',
            fetch: async () => new Response('{not-json', {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        })

        await expect(client.initialize()).rejects.toMatchObject({ code: 'malformed_response' })
    })

    it('enforces the response byte cap even without Content-Length', async () => {
        const client = new McpHttpClient({
            serverUrl: 'https://mcp.example.test',
            accessTokenProvider: async () => 'token',
            maxResponseBytes: 32,
            fetch: async () => new Response(JSON.stringify(initializeResult), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        })

        await expect(client.initialize()).rejects.toMatchObject({ code: 'response_too_large' })
    })

    it('normalizes caller cancellation and rejects use after disposal', async () => {
        const controller = new AbortController()
        controller.abort()
        const client = new McpHttpClient({
            serverUrl: 'https://mcp.example.test',
            accessTokenProvider: async () => 'token',
            fetch: async (_input, init) => {
                if (init?.signal?.aborted) throw new DOMException('secret abort reason', 'AbortError')
                return jsonResponse(initializeResult)
            }
        })

        await expect(client.initialize(controller.signal)).rejects.toMatchObject({ code: 'aborted' })
        await client.dispose()
        await expect(client.initialize()).rejects.toMatchObject({ code: 'disposed' })
    })
})