import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { buildWebApiHandler } from './app.js'
import { assertLoopbackHost, createAzureCliAuthentication } from './authentication.js'
import { buildStaticHandler, setSecurityHeaders } from './hosting.js'
import { listenWebServer } from './listener.js'
import { createHostedRuntimeFactory } from './runtime.js'

const port = parsePort(process.env['PORT'])
const mode = resolveWebHostMode(process.env)
const host = process.env['HOST']?.trim() || (mode === 'easy-auth' ? '0.0.0.0' : '127.0.0.1')
if (mode === 'azure-cli') assertLoopbackHost(host)
const staticRoot = resolve(process.env['TLC_WEB_STATIC_ROOT']?.trim() || 'apps/desktop/dist/revamp')
const createRuntime = mode === 'sample'
    ? () => { throw new Error('Live APIs are disabled in sample mode.') }
    : await createHostedRuntimeFactory()
const serveStatic = buildStaticHandler(staticRoot, mode === 'sample' ? 'sample' : 'live')
const handleApi = buildWebApiHandler({
    createRuntime,
    ...(mode === 'azure-cli' ? { authenticate: createAzureCliAuthentication() } : {}),
    ...(mode !== 'easy-auth' ? { shutdown: closeLocalServer } : {}),
    onError: (error, correlationId) => {
        console.error(`[web-api] ${correlationId}`, error instanceof Error ? error.message : error)
    }
})

const server = createServer(async (request, response) => {
    setSecurityHeaders(response)
    try {
        if (await handleApi(request, response)) return
        await serveStatic(request, response)
    } catch (error) {
        console.error('[web-static]', error instanceof Error ? error.message : error)
        response.statusCode = 500
        response.end('The web application could not be loaded.')
    }
})

async function closeLocalServer(): Promise<void> {
    await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose())
    })
}

try {
    await listenWebServer(server, port, host)
    console.info(`TLC web host (${mode}) listening on http://${host}:${port}`)
} catch (error) {
    console.error(`[web-host] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
}

export type WebHostMode = 'sample' | 'azure-cli' | 'easy-auth'

export function resolveWebHostMode(environment: NodeJS.ProcessEnv): WebHostMode {
    const configuredMode = environment['TLC_WEB_MODE']?.trim().toLowerCase()
    if (configuredMode === 'sample' || configuredMode === 'azure-cli' || configuredMode === 'easy-auth') {
        return configuredMode
    }
    if (configuredMode) throw new Error('TLC_WEB_MODE must be sample, azure-cli, or easy-auth.')
    return environment['WEBSITE_SITE_NAME'] ? 'easy-auth' : 'sample'
}

function parsePort(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? '8080', 10)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error('PORT must be a valid TCP port.')
    return parsed
}