import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { buildWebApiHandler } from './app.js'
import { assertLoopbackHost, createAzureCliAuthentication, createSampleAuthentication } from './authentication.js'
import { buildStaticHandler, setSecurityHeaders } from './hosting.js'
import { listenWebServer } from './listener.js'
import { createHostedRuntimeFactory, createHostedWorkflowHostResolver } from './runtime.js'
import { createSampleWorkflowHost } from '../../../packages/orchestrator/workflows/index.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator, type AgentTaskContext, type TaskAgentRegistry } from '../../../packages/orchestrator/index.js'
import type { AgentCapability } from '../../../packages/common/index.js'

const port = parsePort(process.env['PORT'])
const mode = resolveWebHostMode(process.env)
const host = process.env['HOST']?.trim() || (mode === 'easy-auth' ? '0.0.0.0' : '127.0.0.1')
if (mode === 'azure-cli') assertLoopbackHost(host)
const staticRoot = resolve(process.env['TLC_WEB_STATIC_ROOT']?.trim() || 'apps/desktop/dist/revamp')
const sampleMsx = mode === 'sample' ? new FixtureMsxConnector() : undefined
const sampleRuntime = sampleMsx
    ? new ThinSliceOrchestrator(
        sampleMsx,
        new LocalPdfMcemGuidanceConnector(resolve('docs/knowledge/MCEM Overview.pdf')),
        createSampleTaskAgents()
    )
    : undefined
const createRuntime = sampleRuntime
    ? () => sampleRuntime
    : await createHostedRuntimeFactory()
const sampleWorkflowHost = sampleMsx ? createSampleWorkflowHost(async () => {
    const accounts = await sampleMsx.listAccounts()
    const opportunities = (await Promise.all(accounts.map((account) => sampleMsx.listOpportunities(account.id)))).flat()
    return {
        accountIds: accounts.map((account) => account.id),
        opportunityIds: opportunities.map((opportunity) => opportunity.id)
    }
}) : undefined
const resolveWorkflowHost = sampleWorkflowHost ? () => sampleWorkflowHost : await createHostedWorkflowHostResolver()
const authenticate = mode === 'sample'
    ? createSampleAuthentication()
    : mode === 'azure-cli' ? createAzureCliAuthentication() : undefined
const serveStatic = buildStaticHandler(staticRoot, mode === 'sample' ? 'sample' : 'live')
const handleApi = buildWebApiHandler({
    createRuntime,
    resolveWorkflowHost,
    ...(authenticate ? { authenticate } : {}),
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

function createSampleTaskAgents(): TaskAgentRegistry {
    const capabilities: AgentCapability[] = ['account-pulse', 'mcem-coach', 'pursuit-executive', 'risk-solution-play']
    return Object.fromEntries(capabilities.map((capability) => [capability, {
        version: 'web-sample-v1',
        agent: {
            invoke: async (context: AgentTaskContext) =>
                `## ${capability.replaceAll('-', ' ')}\n\nSample guidance for **${context.opportunity.name}**.\n\n${context.prompt}`
        }
    }])) as TaskAgentRegistry
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