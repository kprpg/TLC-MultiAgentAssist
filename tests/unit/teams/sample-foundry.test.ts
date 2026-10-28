import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { startTeamsServer } from '../../../apps/teams/src/server.js'
import { AgentResultView } from '../../../apps/teams/src/client/result-view.js'
import { agentTaskResponseSchema, contractVersion, workflowAgentCapabilityValues, workflowContractVersion, workflowRunSchema } from '../../../packages/common/contracts/index.js'
import { SampleInference } from '../../../packages/orchestrator/sample-inference.js'
import type { TokenCredential } from '@azure/core-auth'
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTeamsSampleInference } from '../../../apps/teams/src/runtime-resources.js'
import { workflowRunViewSchema } from '../../../packages/common/contracts/workflow-output.js'
import { workflowResultsViewSchema } from '../../../packages/common/contracts/workflow-membership.js'

const { responsesCreate, constructClient } = vi.hoisted(() => ({
  responsesCreate: vi.fn(), constructClient: vi.fn<(credential: TokenCredential) => void>()
}))
vi.mock('@azure/ai-projects', () => ({
  AIProjectClient: vi.fn(function (_endpoint: string, credential: TokenCredential) {
    constructClient(credential)
    return { getOpenAIClient: () => ({ responses: { create: responsesCreate }, withOptions() { return this } }) }
  })
}))

const foundry = {
  schemaVersion: 1, environment: 'synthetic',
  authentication: {
    mode: 'azure-cli', expectedUserDomain: '@example.test',
    foundryTenantId: '77777777-7777-4777-8777-777777777777',
    scopes: { foundry: ['https://ai.azure.com/.default'], msx: ['https://synthetic.crm.dynamics.com/.default'], graph: ['https://graph.microsoft.com/.default'] }
  },
  foundry: {
    projectEndpoint: 'https://synthetic.services.ai.azure.com/api/projects/test', requestTimeoutMs: 1000,
    agents: Object.fromEntries(['accountPulse', 'mcemCoach', 'pursuitExecutive', 'riskSolutionPlay'].map((name) => [
      name, { name, type: 'prompt', protocol: 'responses' }
    ]))
  }
}
const active: Array<Awaited<ReturnType<typeof startTeamsServer>>> = []
afterEach(async () => {
  try { for (const app of active.splice(0)) await app.close() }
  finally { vi.restoreAllMocks(); responsesCreate.mockReset(); constructClient.mockClear() }
})

async function fixture(aiMode?: 'sample' | 'foundry') {
  const original = globalThis.fetch
  const outbound = vi.spyOn(globalThis, 'fetch')
  outbound.mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname !== '127.0.0.1') throw new Error('Sample tests prohibit live source access.')
    return original(input, init)
  })
  responsesCreate.mockResolvedValue({ output_text: 'Grounded Foundry sample response.' })
  const app = await startTeamsServer({
    TLC_TEAMS_MODE: 'sample', TLC_TEAMS_ORIGIN: 'http://127.0.0.1:3978',
    TLC_TEAMS_HOST: '127.0.0.1', TLC_TEAMS_PORT: '0',
    TLC_TEAMS_STATE_PATH: ':memory:', TLC_TEAMS_SAMPLE_PATH: ':memory:',
    TLC_FOUNDRY_ENV_BASE64: Buffer.from(JSON.stringify(foundry)).toString('base64'),
    ...(aiMode ? { TLC_AI_MODE: aiMode } : {})
  })
  active.push(app)
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Expected the sample listener.')
  return {
    app, outbound,
    post: async (operation: string, input: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/teams/operations/${operation}`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: app.configuration.origin }, body: JSON.stringify(input)
      })
      expect(response.status).toBe(200)
      return response.json()
    }
  }
}

describe('Teams actual sample server with shared Foundry inference', () => {
  it('defaults to lazy Foundry and supports three successive prompts for all four agents without live business reads', async () => {
    const { post, app } = await fixture()
    const close = vi.spyOn(SampleInference.prototype, 'close')
    expect(await post('getInferenceMode', {})).toBe('foundry')
    await post('listAccounts', {})
    expect(constructClient).not.toHaveBeenCalled()
    for (const capability of workflowAgentCapabilityValues) {
      for (let prompt = 0; prompt < 3; prompt++) {
        const result = agentTaskResponseSchema.parse(await post('runAgentTask', {
          contractVersion, capability, accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', prompt: `Synthetic sample request ${prompt}`
        }))
        expect(result.inference).toMatchObject({ provider: 'foundry', state: 'complete' })
        expect(renderToStaticMarkup(createElement(AgentResultView, { result }))).toContain('Sample data / Foundry AI')
      }
    }
    expect(responsesCreate).toHaveBeenCalledTimes(12)
    expect(constructClient).toHaveBeenCalledOnce()
    await app.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps explicit offline mode credential-free and never constructs a model client', async () => {
    const { post } = await fixture('sample')
    expect(await post('getInferenceMode', {})).toBe('sample')
    const result = agentTaskResponseSchema.parse(await post('runAgentTask', {
      contractVersion, capability: 'account-pulse', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', prompt: 'Review sanitized evidence.'
    }))
    expect(result).toMatchObject({ mode: 'sample', agentVersion: 'sample-v1' })
    expect(result.inference).toBeUndefined()
    expect(constructClient).not.toHaveBeenCalled()
    expect(responsesCreate).not.toHaveBeenCalled()
  })

  it('serves the real membership-view HTTP operation without starting model inference', async () => {
    const { post } = await fixture('sample')
    const run = workflowRunSchema.parse(await post('workflows.start', {
      contractVersion: workflowContractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: { asOf: '2026-10-27' }
    }))
    const request = { contractVersion: workflowContractVersion, runId: run.runId }
    await expect.poll(async () => workflowRunViewSchema.parse(await post('workflows.get', request)).run.status).toBe('completed')
    const all = workflowResultsViewSchema.parse(await post('workflows.view', { ...request, filter: 'all' }))
    const mine = workflowResultsViewSchema.parse(await post('workflows.view', { ...request, filter: 'mine' }))
    expect(all).toMatchObject({ state: 'ready', totalItems: 2, visibleItems: 2 })
    expect(mine).toMatchObject({ state: 'ready', totalItems: 2, visibleItems: 2 })
    expect(all.eligibility.every((item) => item.eligible)).toBe(true)
    expect(constructClient).not.toHaveBeenCalled()
    expect(responsesCreate).not.toHaveBeenCalled()
  })

  it('labels authentication fallback visibly and permits a later successful invocation', async () => {
    const { post } = await fixture('foundry')
    responsesCreate.mockRejectedValueOnce(Object.assign(new Error('Synthetic authentication failure'), { status: 401 }))
    const input = { contractVersion, capability: 'account-pulse', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', prompt: 'Review sanitized evidence.' }
    const failed = agentTaskResponseSchema.parse(await post('runAgentTask', input))
    expect(failed.inference).toMatchObject({ provider: 'sample', state: 'fallback', reason: 'authentication' })
    expect(renderToStaticMarkup(createElement(AgentResultView, { result: failed }))).toContain('Offline/sample fallback')
    expect(agentTaskResponseSchema.parse(await post('runAgentTask', input)).inference).toMatchObject({ provider: 'foundry', state: 'complete' })
  })

  it('honors an explicit Azure runtime profile without borrowing the local CLI identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tlc-teams-sample-profile-'))
    const managedIdentity = vi.spyOn(ManagedIdentityCredential.prototype, 'getToken').mockResolvedValue({
      token: 'synthetic-workload-token', expiresOnTimestamp: Date.now() + 3600_000
    })
    const cli = vi.spyOn(AzureCliCredential.prototype, 'getToken').mockRejectedValue(new Error('The local CLI must not be used.'))
    const inference = createTeamsSampleInference({
      profile: 'azure', state: { kind: 'sqlite', path: ':memory:' }, samplePath: ':memory:'
    }, {
      TLC_AI_MODE: 'foundry', HOME: root,
      TLC_FOUNDRY_ENV_BASE64: Buffer.from(JSON.stringify(foundry)).toString('base64')
    })
    try {
      expect(constructClient).not.toHaveBeenCalled()
      const result = await inference.run(async () => {
        const credential = constructClient.mock.calls[0]?.[0]
        if (!credential) throw new Error('Expected the lazy workload credential.')
        await credential.getToken('https://ai.azure.com/.default')
        return 'foundry'
      }, () => 'offline')
      expect(result.execution).toMatchObject({ provider: 'foundry', state: 'complete' })
      expect(managedIdentity).toHaveBeenCalledOnce()
      expect(cli).not.toHaveBeenCalled()
    } finally { inference.close(); await rm(root, { recursive: true, force: true }) }
  })
})
