import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity'
import { resolve } from 'node:path'
import type { AgentCapability } from '../../../packages/common/index.js'
import { resolveFoundryEnvironmentPath, loadFoundryEnvironment } from '../../../packages/common/configuration/foundry-environment.js'
import { LiveMsxConnector, msxWriteMetadataFromEnvironment } from '../../../packages/connectors/msx/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { createFoundryOpenAIClient, FoundryPromptAgent } from '../../../packages/connectors/foundry/index.js'
import { ThinSliceOrchestrator, type AgentTaskContext, type TaskAgentRegistry } from '../../../packages/orchestrator/index.js'
import type { AuthenticatedRequest, WebRuntime } from './app.js'

export interface HostedRuntimeOptions {
    environment?: NodeJS.ProcessEnv
    workingDirectory?: string
}

export async function createHostedRuntimeFactory(options: HostedRuntimeOptions = {}) {
    const environment = options.environment ?? process.env
    const workingDirectory = options.workingDirectory ?? process.cwd()
    const foundryEnvironment = await loadFoundryEnvironment(resolveFoundryEnvironmentPath(environment, workingDirectory))
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