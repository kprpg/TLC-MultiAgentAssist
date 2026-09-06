import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z, ZodError } from 'zod'
import {
    accountSchema,
    agentTaskRequestSchema,
    agentTaskResponseSchema,
    emailComposeRequestSchema,
    exportResponseRequestSchema,
    mcemRequestSchema,
    mcemResponseSchema,
    milestoneSchema,
    opportunitySchema,
    type Account,
    type AgentTaskRequest,
    type AgentTaskResponse,
    type McemRequest,
    type McemResponse,
    type Milestone,
    type Opportunity
} from '../../../packages/common/index.js'
import { createOutlookDraftMessage } from '../../desktop/electron/main/outlook-compose.js'
import { createResponseDocumentBuffer } from '../../desktop/electron/main/response-document.js'

const accountIdSchema = z.string().min(1).max(200)
const maximumBodyBytes = 1_048_576

export interface WebRuntime {
    listAccounts(): Promise<Account[]>
    listOpportunities(accountId: string): Promise<Opportunity[]>
    listMilestones(opportunityId: string): Promise<Milestone[]>
    runMcemCoach(request: McemRequest): Promise<McemResponse>
    runAgentTask(request: AgentTaskRequest): Promise<AgentTaskResponse>
}

export interface AuthenticatedRequest {
    accessToken: string
    clientPrincipal: string
    userEmail: string
}

export interface WebApiOptions {
    createRuntime(authentication: AuthenticatedRequest): Promise<WebRuntime> | WebRuntime
    authenticate?(request: IncomingMessage): Promise<AuthenticatedRequest> | AuthenticatedRequest
    shutdown?(): Promise<void> | void
    onError?(error: unknown, correlationId: string): void
}

export function buildWebApiHandler(options: WebApiOptions) {
    return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return false

        const correlationId = randomUUID()
        response.setHeader('x-correlation-id', correlationId)
        response.setHeader('cache-control', 'no-store')

        try {
            if (request.method === 'GET' && url.pathname === '/api/health') {
                sendJson(response, 200, { status: 'ready' })
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/exit' && options.shutdown) {
                assertSameOriginMutation(request)
                sendJson(response, 202, { state: 'exiting' })
                setImmediate(() => {
                    Promise.resolve(options.shutdown?.()).catch((error: unknown) => options.onError?.(error, correlationId))
                })
                return true
            }

            const authentication = await (options.authenticate ?? readEasyAuthAuthentication)(request)
            assertSameOriginMutation(request)

            if (request.method === 'GET' && url.pathname === '/api/me') {
                sendJson(response, 200, { email: authentication.userEmail })
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/open-email-compose') {
                const input = emailComposeRequestSchema.parse(await readJsonBody(request))
                const fileName = safeEmailFileName(input.subject)
                response.statusCode = 200
                response.setHeader('content-type', 'message/rfc822; charset=utf-8')
                response.setHeader('content-disposition', `attachment; filename="${fileName}"`)
                response.setHeader('x-tlc-file-name', fileName)
                response.end(createOutlookDraftMessage(input), 'utf8')
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/export-agent-response') {
                const input = exportResponseRequestSchema.parse(await readJsonBody(request))
                const document = await createResponseDocumentBuffer(input)
                const fileName = safeDocumentFileName(input.responseTitle)
                response.statusCode = 200
                response.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                response.setHeader('content-disposition', `attachment; filename="${fileName}"`)
                response.setHeader('x-tlc-file-name', fileName)
                response.end(document)
                return true
            }

            const runtime = await options.createRuntime(authentication)

            if (request.method === 'GET' && url.pathname === '/api/accounts') {
                sendJson(response, 200, accountSchema.array().parse(await runtime.listAccounts()))
                return true
            }

            const opportunitiesMatch = /^\/api\/accounts\/([^/]+)\/opportunities$/.exec(url.pathname)
            if (request.method === 'GET' && opportunitiesMatch) {
                const accountId = accountIdSchema.parse(decodeURIComponent(opportunitiesMatch[1]!))
                sendJson(response, 200, opportunitySchema.array().parse(await runtime.listOpportunities(accountId)))
                return true
            }

            const milestonesMatch = /^\/api\/opportunities\/([^/]+)\/milestones$/.exec(url.pathname)
            if (request.method === 'GET' && milestonesMatch) {
                const opportunityId = accountIdSchema.parse(decodeURIComponent(milestonesMatch[1]!))
                sendJson(response, 200, milestoneSchema.array().parse(await runtime.listMilestones(opportunityId)))
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/mcem-coach') {
                const input = mcemRequestSchema.parse(await readJsonBody(request))
                sendJson(response, 200, mcemResponseSchema.parse(await runtime.runMcemCoach(input)))
                return true
            }

            if (request.method === 'POST' && url.pathname === '/api/agent-task') {
                const input = agentTaskRequestSchema.parse(await readJsonBody(request))
                sendJson(response, 200, agentTaskResponseSchema.parse(await runtime.runAgentTask(input)))
                return true
            }

            sendJson(response, 404, { error: 'The requested API route was not found.', correlationId })
            return true
        } catch (error) {
            const statusCode = error instanceof HttpError ? error.statusCode : error instanceof ZodError ? 400 : 500
            options.onError?.(error, correlationId)
            const message = statusCode === 500
                ? 'The server could not complete the request.'
                : error instanceof Error ? error.message : 'The request is invalid.'
            sendJson(response, statusCode, { error: message, correlationId })
            return true
        }
    }
}

function safeDocumentFileName(title: string): string {
    const safeTitle = Array.from(title, (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character)
        .join('').replace(/[. ]+$/g, '').slice(0, 120).trim()
    return `${safeTitle || 'TLC-agent-response'}.docx`
}

export function readEasyAuthAuthentication(request: IncomingMessage): AuthenticatedRequest {
    const accessToken = singleHeader(request, 'x-ms-token-aad-access-token')
    const clientPrincipal = singleHeader(request, 'x-ms-client-principal')
    const userEmail = singleHeader(request, 'x-ms-client-principal-name')
    if (!accessToken || !clientPrincipal || !userEmail) {
        throw new HttpError(401, 'Sign in with Microsoft Entra ID to access live data.')
    }
    return { accessToken, clientPrincipal, userEmail }
}

function assertSameOriginMutation(request: IncomingMessage): void {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? '')) return
    const fetchSite = singleHeader(request, 'sec-fetch-site')
    if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
        throw new HttpError(403, 'Cross-origin API requests are not allowed.')
    }
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
    const value = request.headers[name]
    return Array.isArray(value) ? value[0] : value
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        throw new HttpError(415, 'The request body must use application/json.')
    }

    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > maximumBodyBytes) throw new HttpError(413, 'The request body is too large.')
        chunks.push(buffer)
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
        throw new HttpError(400, 'The request body is not valid JSON.')
    }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.statusCode = statusCode
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify(payload))
}

class HttpError extends Error {
    constructor(readonly statusCode: number, message: string) {
        super(message)
    }
}

function safeEmailFileName(subject: string): string {
    const safeSubject = Array.from(subject, (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character)
        .join('').replace(/[. ]+$/g, '').slice(0, 120).trim()
    return `${safeSubject || 'TLC-agent-response'}.eml`
}