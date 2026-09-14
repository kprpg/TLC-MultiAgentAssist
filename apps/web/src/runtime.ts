import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity'
import { resolve } from 'node:path'
import { loadDataverseEntityMap, loadMcpServerRegistry, loadMcpToolPolicy, type AgentCapability } from '../../../packages/common/index.js'
import { loadFoundryEnvironmentFromEnvironment } from '../../../packages/common/configuration/foundry-environment.js'
import { LiveMsxConnector, msxWriteMetadataFromEnvironment } from '../../../packages/connectors/msx/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { createFoundryOpenAIClient, FoundryPromptAgent } from '../../../packages/connectors/foundry/index.js'
import { ThinSliceOrchestrator, type AgentTaskContext, type TaskAgentRegistry } from '../../../packages/orchestrator/index.js'
import { createConfiguredWorkflowHost, type WorkflowHost } from '../../../packages/orchestrator/workflows/index.js'
import type { AuthenticatedRequest, WebRuntime } from './app.js'

export interface HostedRuntimeOptions {
    environment?: NodeJS.ProcessEnv
    workingDirectory?: string
}

export async function createHostedRuntimeFactory(options: HostedRuntimeOptions = {}) {
    const environment = options.environment ?? process.env
    const workingDirectory = options.workingDirectory ?? process.cwd()
    const foundryEnvironment = await loadFoundryEnvironmentFromEnvironment(environment, workingDirectory)
    const managedIdentityClientId = environment['AZURE_CLIENT_ID']?.trim()
    const foundryCredential = environment['WEBSITE_SITE_NAME']
        ? managedIdentityClientId
            ? new ManagedIdentityCredential(managedIdentityClientId)
            : new ManagedIdentityCredential()
        : new AzureCliCredential({
            tenantId: foundryEnvironment.authentication.foundryTenantId,
            processTimeoutInMs: 30_000
        })
    const foundryClient = createFoundryOpenAIClient(foundryEnvironment.foundry.projectEndpoint, foundryCredential)
    const bindings = foundryEnvironment.foundry.agents
    const agentBindings: Record<AgentCapability, typeof bindings.accountPulse> = {
        'account-pulse': bindings.accountPulse,
        'mcem-coach': bindings.mcemCoach,
        'pursuit-executive': bindings.pursuitExecutive,
        'risk-solution-play': bindings.riskSolutionPlay
    }
    const taskAgents = Object.fromEntries(Object.entries(agentBindings).map(([capability, binding]) => [capability, {
        version: 'active',
        agent: new FoundryPromptAgent<AgentTaskContext>({
            projectEndpoint: foundryEnvironment.foundry.projectEndpoint,
            agentName: binding.name,
            requestTimeoutMs: foundryEnvironment.foundry.requestTimeoutMs,
            credential: foundryCredential,
            openAIClient: foundryClient
        })
    }])) as TaskAgentRegistry
    const guidance = new LocalPdfMcemGuidanceConnector(
        resolve(workingDirectory, environment['TLC_MCEM_GUIDANCE_PATH']?.trim() || 'docs/knowledge/MCEM Overview.pdf')
    )

    return ({ accessToken }: AuthenticatedRequest): WebRuntime => {
        const msx = new LiveMsxConnector({ getAccessToken: async () => accessToken }, fetch, undefined, undefined, msxWriteMetadataFromEnvironment(environment))
        return new ThinSliceOrchestrator(msx, guidance, taskAgents)
    }
}

export async function createHostedWorkflowHostResolver(options: HostedRuntimeOptions = {}) {
    const environment = options.environment ?? process.env
    const workingDirectory = options.workingDirectory ?? process.cwd()
    const [registry, policy, entityMap] = await Promise.all([
        loadMcpServerRegistry(resolve(workingDirectory, 'config/mcp.servers.json')),
        loadMcpToolPolicy(resolve(workingDirectory, 'config/mcp.tool-policy.json')),
        loadDataverseEntityMap(resolve(workingDirectory, 'config/dataverse.entity-map.json'))
    ])
    const hosts = new Map<string, {
        host: WorkflowHost
        dispose(): Promise<void>
        token: { value: string }
        lastUsed: number
    }>()

    return async (authentication: AuthenticatedRequest): Promise<WorkflowHost> => {
        const principalKey = authentication.clientPrincipal
        const existing = hosts.get(principalKey)
        if (existing) {
            existing.token.value = authentication.accessToken
            existing.lastUsed = Date.now()
            return existing.host
        }

        await evictOldestWorkflowHost(hosts)
        const token = { value: authentication.accessToken }
        const msx = new LiveMsxConnector({ getAccessToken: async () => token.value }, fetch, undefined, undefined, msxWriteMetadataFromEnvironment(environment))
        let delegatedScope: Promise<{ delegatedUserAccountIds: string[]; delegatedUserOpportunityIds: string[] }> | undefined
        const configured = createConfiguredWorkflowHost({
            registry,
            policy,
            entityMap,
            getAccessToken: async () => token.value,
            resolveDelegatedScope: () => {
                delegatedScope ??= resolveMsxScope(msx)
                return delegatedScope
            }
        })
        hosts.set(principalKey, { host: configured.host, dispose: configured.dispose, token, lastUsed: Date.now() })
        return configured.host
    }
}

export async function evictOldestWorkflowHost<T extends { lastUsed: number; dispose(): Promise<void> }>(
    hosts: Map<string, T>,
    maximumSize = 100
): Promise<void> {
    if (hosts.size < maximumSize) return
    const oldest = [...hosts.entries()].sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0]
    if (!oldest) return
    hosts.delete(oldest[0])
    await oldest[1].dispose()
}

async function resolveMsxScope(msx: LiveMsxConnector) {
    const accounts = await msx.listAccounts()
    const opportunities = (await Promise.all(accounts.map(({ id }) => msx.listOpportunities(id)))).flat()
    return {
        delegatedUserAccountIds: accounts.map(({ id }) => id),
        delegatedUserOpportunityIds: opportunities.map(({ id }) => id)
    }
}