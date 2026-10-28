import { beforeEach, describe, expect, it, vi } from 'vitest'

const { responsesCreate } = vi.hoisted(() => ({ responsesCreate: vi.fn() }))
vi.mock('@azure/ai-projects', () => ({
    AIProjectClient: vi.fn(function () {
        return { getOpenAIClient: () => ({ responses: { create: responsesCreate }, withOptions() { return this } }) }
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
import { createLocalStoreDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { SampleInference } from '../../../packages/orchestrator/sample-inference.js'
import { AIProjectClient } from '@azure/ai-projects'
import type { AccessToken, TokenCredential } from '@azure/core-auth'
import type { AgentTaskStreamEvent } from '../../../packages/common/contracts/index.js'

const credential = { getToken: vi.fn<TokenCredential['getToken']>() }
const token: AccessToken = { token: 'synthetic-foundry-token', expiresOnTimestamp: Date.now() + 3_600_000 }
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
    beforeEach(() => {
        responsesCreate.mockReset()
        vi.mocked(AIProjectClient).mockClear()
        credential.getToken.mockReset().mockResolvedValue(token)
    })

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
        const results: Array<{ capabilities: string[]; versions: string[]; inputs: string[] }> = []
        for (const [, build] of hosts()) {
            const registry = build()
            if (!registry) throw new Error('The host did not build a Foundry registry.')
            results.push({ capabilities: Object.keys(registry).sort(), versions: Object.values(registry).map((entry) => entry!.version), inputs: await modelInputs(registry, context) })
        }
        for (const result of results.slice(1)) expect(result).toEqual(results[0])
    })

    it('keeps the Desktop sample registry host-specific and offline when no Foundry environment exists', () => {
        const sample = { 'account-pulse': { version: 'sample-v2', agent: { invoke: async () => 'sample' } } } as TaskAgentRegistry
        const registry = createDesktopTaskAgents({ sample: () => sample })
        expect(registry).toBe(sample)
        expect(responsesCreate).not.toHaveBeenCalled()
    })

    it('routes Desktop hybrid composition through the shared sample inference without altering the live factory', async () => {
        const inference = new SampleInference({ environment: { TLC_AI_MODE: 'foundry' }, credential, loadEnvironment: async () => environment })
        const registry = createDesktopTaskAgents({ inference, sample: () => ({
            'account-pulse': { version: 'offline', agent: { invoke: async () => 'offline' } }
        }) })
        const context = await canonicalContext()
        responsesCreate.mockResolvedValue({ output_text: 'real sample response' })
        const result = await registry['account-pulse']!.infer!(context)
        expect(result).toMatchObject({ execution: { provider: 'foundry', state: 'complete' } })
        const [request] = responsesCreate.mock.calls.at(-1)!
        expect(request).toMatchObject({ agent_reference: { name: 'tlc-account-pulse' } })
    })

    it('uses the supplied Foundry identity in the actual VS Code SQLite provider without requesting source tokens', async () => {
        vi.stubEnv('TLC_AI_MODE', 'foundry')
        const provider = createLocalStoreDataProvider({ foundryCredential: credential })
        try {
            await provider.listAccounts()
            expect(credential.getToken).not.toHaveBeenCalled()
            responsesCreate.mockResolvedValue({ output_text: 'real sample response' })
            for (const capability of workflowAgentCapabilityValues) {
                const result = await provider.runAgentTask(capability, 'account-contoso', 'opp-grid-modernization', 'Review this sample.')
                expect(result).toMatchObject({ mode: 'sample', inference: { provider: 'foundry', state: 'complete' } })
            }
            expect(AIProjectClient).toHaveBeenCalledWith(environment.foundry.projectEndpoint, credential)
            expect(credential.getToken.mock.calls.map(([scope]) => scope)).toEqual(
                workflowAgentCapabilityValues.map(() => 'https://ai.azure.com/.default'))
            expect(provider.getSourceToken).toBeUndefined()
        } finally { await provider.dispose(); vi.unstubAllEnvs() }
    })

    it('does not spend the VS Code sample model timeout waiting for interactive Foundry sign-in', async () => {
        vi.stubEnv('TLC_AI_MODE', 'foundry')
        vi.useFakeTimers()
        let completeSignIn: ((value: AccessToken | null) => void) | undefined
        credential.getToken.mockImplementationOnce(() => new Promise((resolve) => { completeSignIn = resolve }))
        responsesCreate.mockImplementation(async function* () {
            yield { type: 'response.output_text.delta', delta: 'Real sample guidance.' }
            yield { type: 'response.completed' }
        })
        const provider = createLocalStoreDataProvider({ foundryCredential: credential })
        try {
            if (!provider.runAgentTaskStream) throw new Error('The sample provider must support streamed guidance.')
            const events: AgentTaskStreamEvent[] = []
            const pending = provider.runAgentTaskStream('account-pulse', 'account-contoso', 'opp-grid-modernization',
                'Review this sample.', (event) => events.push(event))
            await vi.advanceTimersByTimeAsync(environment.foundry.requestTimeoutMs + 1)
            expect(credential.getToken).toHaveBeenCalledOnce()
            expect(responsesCreate).not.toHaveBeenCalled()
            if (!completeSignIn) throw new Error('Foundry sign-in did not start.')
            completeSignIn(token)
            await pending
            expect(events.find((event) => event.type === 'complete')).toMatchObject({
                response: { inference: { provider: 'foundry', state: 'complete' }, content: expect.stringContaining('Real sample guidance.') }
            })
            expect(events.some((event) => event.type === 'error')).toBe(false)
        } finally { await provider.dispose(); vi.useRealTimers(); vi.unstubAllEnvs() }
    })

    it.each([null, new Error('User did not consent to login.')])('allows VS Code sample sign-in to be retried after denial %s', async (denial) => {
        vi.stubEnv('TLC_AI_MODE', 'foundry')
        if (denial instanceof Error) credential.getToken.mockRejectedValueOnce(denial)
        else credential.getToken.mockResolvedValueOnce(denial)
        responsesCreate.mockResolvedValue({ output_text: 'Real sample guidance after sign-in.' })
        const provider = createLocalStoreDataProvider({ foundryCredential: credential })
        try {
            const first = await provider.runAgentTask('account-pulse', 'account-contoso', 'opp-grid-modernization', 'Review this sample.')
            expect(first).toMatchObject({ inference: { provider: 'sample', state: 'fallback', reason: 'authentication' } })
            expect(responsesCreate).not.toHaveBeenCalled()
            const second = await provider.runAgentTask('account-pulse', 'account-contoso', 'opp-grid-modernization', 'Review this sample.')
            expect(second).toMatchObject({ inference: { provider: 'foundry', state: 'complete' } })
            expect(credential.getToken).toHaveBeenCalledTimes(2)
            if (denial instanceof Error) credential.getToken.mockRejectedValueOnce(denial)
            else credential.getToken.mockResolvedValueOnce(denial)
            responsesCreate.mockClear()
            const renewalDenied = await provider.runAgentTask('account-pulse', 'account-contoso', 'opp-grid-modernization', 'Review this sample.')
            expect(renewalDenied).toMatchObject({ inference: { provider: 'sample', state: 'fallback', reason: 'authentication' } })
            expect(responsesCreate).not.toHaveBeenCalled()
            const renewed = await provider.runAgentTask('account-pulse', 'account-contoso', 'opp-grid-modernization', 'Review this sample.')
            expect(renewed).toMatchObject({ inference: { provider: 'foundry', state: 'complete' } })
            expect(credential.getToken).toHaveBeenCalledTimes(4)
        } finally { await provider.dispose(); vi.unstubAllEnvs() }
    })
})
