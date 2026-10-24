import { beforeEach, describe, expect, it, vi } from 'vitest'

const { responsesCreate } = vi.hoisted(() => ({ responsesCreate: vi.fn() }))
vi.mock('@azure/ai-projects', () => ({
    AIProjectClient: vi.fn(function () {
        return { getOpenAIClient: () => ({ responses: { create: responsesCreate } }) }
    })
}))

import foundryEnvironmentDefault from '../../../config/foundry.environment.default.json' with { type: 'json' }
import { foundryEnvironmentSchema } from '../../../packages/common/configuration/foundry-environment.js'
import { createFoundryOpenAIClient } from '../../../packages/connectors/foundry/index.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { FixtureMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { contractVersion, workflowAgentCapabilityValues } from '../../../packages/common/contracts/index.js'
import { ThinSliceOrchestrator, serializeAgentContext, type AgentTaskContext, type TaskAgentRegistry } from '../../../packages/orchestrator/index.js'
import { createFoundryTaskAgents } from '../../../packages/orchestrator/task-agents.js'
import { createDesktopTaskAgents } from '../../../apps/desktop/electron/main/task-agents.js'
import { buildFoundryTaskAgents } from '../../../apps/vscode-extension/src/live-provider.js'

const credential = { getToken: vi.fn() }
const environment = foundryEnvironmentSchema.parse(foundryEnvironmentDefault)
const rawComment = 'RAW-OPPORTUNITY-COMMENT-ALREADY-IN-EVIDENCE'

async function canonicalContext(): Promise<AgentTaskContext> {
    const msx = new FixtureMsxConnector()
    let captured: AgentTaskContext | undefined
    const capture: TaskAgentRegistry = Object.fromEntries(workflowAgentCapabilityValues.map((capability) => [capability, {
        version: 'capture',
        agent: { invoke: async (context: AgentTaskContext) => { captured = context; return '## Summary\n\nCaptured.' } }
    }]))
    const orchestrator = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), capture)
    const account = (await msx.listAccounts())[0]!
    const opportunity = (await msx.listOpportunities(account.id))[0]!
    await orchestrator.runAgentTask({
        contractVersion, capability: 'account-pulse', accountId: account.id, opportunityId: opportunity.id, prompt: 'What next?'
    })
    if (!captured) throw new Error('The orchestrator did not build an agent context.')
    return {
        ...captured,
        opportunityContext: { ...captured.opportunityContext, opportunity: { ...captured.opportunityContext.opportunity, comments: rawComment } }
    }
}

function hosts(): Array<[string, () => TaskAgentRegistry | undefined]> {
    const client = () => createFoundryOpenAIClient(environment.foundry.projectEndpoint, credential)
    return [
        ['shared factory (Web, shared runtime)', () => createFoundryTaskAgents(environment, credential, client())],
        ['Desktop factory', () => createDesktopTaskAgents({ environment, credential, client: client(), sample: () => ({}) as TaskAgentRegistry })],
        ['VS Code factory', () => buildFoundryTaskAgents(credential)]
    ]
}

async function modelInputs(registry: TaskAgentRegistry, context: AgentTaskContext): Promise<string[]> {
    responsesCreate.mockReset()
    responsesCreate.mockResolvedValue({ output_text: 'grounded' })
    for (const capability of workflowAgentCapabilityValues) await registry[capability]!.agent.invoke(context)
    return responsesCreate.mock.calls.map(([request]) => (request as { input: string }).input)
}

describe('agent composition parity across actual host factories', () => {
    beforeEach(() => responsesCreate.mockReset())

    it.each(hosts())('%s sends the shared evidence-aware model input for every capability', async (_name, build) => {
        const context = await canonicalContext()
        const registry = build()
        if (!registry) throw new Error('The host did not build a Foundry registry.')
        const inputs = await modelInputs(registry, context)
        expect(inputs).toHaveLength(workflowAgentCapabilityValues.length)
        for (const input of inputs) {
            expect(input).toBe(serializeAgentContext(context))
            expect(input).not.toContain(rawComment)
            expect(input).not.toBe(JSON.stringify(context))
        }
    })

    it('produces identical model input and capability coverage through every host', async () => {
        const context = await canonicalContext()
        const results = await Promise.all(hosts().map(async ([, build]) => {
            const registry = build()
            if (!registry) throw new Error('The host did not build a Foundry registry.')
            return { capabilities: Object.keys(registry).sort(), versions: Object.values(registry).map((entry) => entry!.version), inputs: await modelInputs(registry, context) }
        }))
        for (const result of results.slice(1)) expect(result).toEqual(results[0])
    })

    it('keeps the Desktop sample registry host-specific and offline when no Foundry environment exists', () => {
        const sample = { 'account-pulse': { version: 'sample-v2', agent: { invoke: async () => 'sample' } } } as TaskAgentRegistry
        const registry = createDesktopTaskAgents({ sample: () => sample })
        expect(registry).toBe(sample)
        expect(responsesCreate).not.toHaveBeenCalled()
    })
})
