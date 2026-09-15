import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { McpHttpClient } from '../../packages/connectors/mcp/index.js'

type JsonRpcRequest = {
    jsonrpc: '2.0'
    id?: string | number
    method: string
    params?: Record<string, unknown>
}

const openClients: McpHttpClient[] = []
const openServers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
    await Promise.all(openClients.splice(0).map(async (client) => client.dispose().catch(() => undefined)))
    await Promise.all(openServers.splice(0).map(async (server) => {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }))
})

async function readJson(request: IncomingMessage): Promise<JsonRpcRequest> {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonRpcRequest
}

function sendJson(response: ServerResponse, body: unknown): void {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
}

async function startFixture(
    handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<string> {
    const server = createServer((request, response) => {
        void handler(request, response)
    })
    openServers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind to TCP.')
    return `http://127.0.0.1:${address.port}/mcp`
}

describe('McpHttpClient Streamable HTTP integration', () => {
    it('initializes, lists tools, calls a tool, and sends delegated authorization', async () => {
        const authorizationHeaders: Array<string | undefined> = []
        const serverUrl = await startFixture(async (request, response) => {
            authorizationHeaders.push(request.headers.authorization)
            if (request.method === 'DELETE') {
                response.writeHead(200).end()
                return
            }
            if (request.method !== 'POST') {
                response.writeHead(405).end()
                return
            }
            const message = await readJson(request)
            if (message.id === undefined) {
                response.writeHead(202).end()
                return
            }
            if (message.method === 'initialize') {
                sendJson(response, {
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        protocolVersion: '2025-06-18',
                        capabilities: { tools: {} },
                        serverInfo: { name: 'fixture', version: '1.0.0' }
                    }
                })
                return
            }
            if (message.method === 'tools/list') {
                sendJson(response, {
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        tools: [{
                            name: 'echo',
                            description: 'Echo fixture input.',
                            inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
                        }]
                    }
                })
                return
            }
            sendJson(response, {
                jsonrpc: '2.0',
                id: message.id,
                result: { content: [{ type: 'text', text: 'fixture-result' }] }
            })
        })
        const client = new McpHttpClient({
            serverUrl,
            accessTokenProvider: async () => 'fixture-token'
        })
        openClients.push(client)

        await client.initialize()
        const tools = await client.listTools()
        const result = await client.callTool('echo', { text: 'hello' })

        expect(tools.tools.map((tool) => tool.name)).toEqual(['echo'])
        expect(result.content).toEqual([{ type: 'text', text: 'fixture-result' }])
        expect(authorizationHeaders.length).toBeGreaterThanOrEqual(3)
        expect(authorizationHeaders.every((header) => header === 'Bearer fixture-token')).toBe(true)
    })

    it('normalizes an initialization timeout', async () => {
        const serverUrl = await startFixture(async (_request, response) => {
            response.on('error', () => undefined)
            await new Promise<void>((resolve) => response.on('close', resolve))
        })
        const client = new McpHttpClient({
            serverUrl,
            accessTokenProvider: async () => 'fixture-token',
            timeoutMs: 25
        })
        openClients.push(client)

        await expect(client.initialize()).rejects.toMatchObject({ code: 'timeout' })
    })
})