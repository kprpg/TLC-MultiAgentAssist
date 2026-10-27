import { afterEach, describe, expect, it, vi } from 'vitest'
const { responses, completions } = vi.hoisted(() => ({ responses: vi.fn(), completions: vi.fn() }))
vi.mock('@azure/ai-projects', () => ({
  AIProjectClient: vi.fn(function () { return { getOpenAIClient: () => ({
    responses: { create: responses }, chat: { completions: { create: completions } },
    withOptions() { return this }
  }) } })
}))
import environmentJson from '../../../config/foundry.environment.default.json' with { type: 'json' }
import { foundryEnvironmentSchema } from '../../../packages/common/configuration/foundry-environment.js'
import { SampleInference } from '../../../packages/orchestrator/sample-inference.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { createSampleTaskAgents } from '../../../packages/orchestrator/task-agents.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { FixtureMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { createSampleSeReportingHost } from '../../../packages/orchestrator/se-reporting/sample.js'
import { emptySeNarratives } from '../../../packages/common/fixtures/se-reporting.js'
import { resolveSampleInferenceMode } from '../../../packages/common/contracts/inference.js'
import { contractVersion } from '../../../packages/common/contracts/version.js'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { createWorkingSessionService, DownloadStore, zipOutput } from '../../../packages/orchestrator/working-session/index.js'
import type { AgentTaskStreamEvent } from '../../../packages/common/contracts/index.js'
import { InferenceAdmissionError } from '../../../packages/connectors/foundry/sample-budget.js'

afterEach(() => vi.resetAllMocks())
const configuration = foundryEnvironmentSchema.parse(environmentJson)
function runtime() {
  return new SampleInference({
    environment: { TLC_AI_MODE: 'foundry' }, credential: { getToken: vi.fn() },
    loadEnvironment: async () => configuration, onFallback: vi.fn()
  })
}

describe('sample data with real inference', () => {
  it('defaults sample AI to Foundry and keeps explicit offline mode network-free', async () => {
    expect(resolveSampleInferenceMode({})).toBe('foundry')
    const loadEnvironment = vi.fn()
    const prepareCredential = vi.fn()
    const inference = new SampleInference({ environment: { TLC_AI_MODE: 'sample' }, loadEnvironment, prepareCredential })
    const result = await inference.run(async () => 'online', () => 'offline')
    expect(result).toMatchObject({ value: 'offline', execution: { requested: 'sample', provider: 'sample', state: 'complete' } })
    expect(loadEnvironment).not.toHaveBeenCalled()
    expect(prepareCredential).not.toHaveBeenCalled()
    expect(() => resolveSampleInferenceMode({ TLC_AI_MODE: 'typo' })).toThrow()
  })

  it('preserves a quota denial wrapped by the SDK as an explicit offline fallback reason', async () => {
    const result = await runtime().run(async () => {
      throw new Error('Connection error', { cause: new InferenceAdmissionError('quota', 'Synthetic quota denial') })
    }, () => 'local')
    expect(result).toMatchObject({ execution: { provider: 'sample', state: 'fallback', reason: 'quota' } })
  })

  it('retries failed Foundry initialization instead of caching offline fallback for the session', async () => {
    const loadEnvironment = vi.fn().mockRejectedValueOnce(new Error('Synthetic initialization failure')).mockResolvedValue(configuration)
    const inference = new SampleInference({
      environment: { TLC_AI_MODE: 'foundry' }, credential: { getToken: vi.fn() },
      loadEnvironment, onFallback: vi.fn()
    })
    expect(await inference.run(async () => 'online', () => 'offline')).toMatchObject({
      value: 'offline', execution: { state: 'fallback' }
    })
    expect(await inference.run(async () => 'online', () => 'offline')).toMatchObject({
      value: 'online', execution: { provider: 'foundry', state: 'complete' }
    })
    expect(loadEnvironment).toHaveBeenCalledTimes(2)
    inference.close()
  })

  it('does not invoke the model when cancelled while Foundry initialization is pending', async () => {
    let completeInitialization: ((value: typeof configuration) => void) | undefined
    const initialized = new Promise<typeof configuration>((resolve) => { completeInitialization = resolve })
    const inference = new SampleInference({
      environment: { TLC_AI_MODE: 'foundry' }, credential: { getToken: vi.fn() },
      loadEnvironment: () => initialized, onFallback: vi.fn()
    })
    const online = vi.fn(async () => 'online')
    const offline = vi.fn(() => 'offline')
    const controller = new AbortController()
    const pending = inference.run(online, offline, controller.signal)
    controller.abort(new Error('Synthetic cancellation during sign-in'))
    if (!completeInitialization) throw new Error('Foundry initialization did not start.')
    completeInitialization(configuration)
    await expect(pending).rejects.toThrow('Synthetic cancellation during sign-in')
    expect(online).not.toHaveBeenCalled()
    expect(offline).not.toHaveBeenCalled()
    inference.close()
  })

  it('does not invoke the model or fall back when cancelled during interactive credential preparation', async () => {
    let completeSignIn: (() => void) | undefined
    const signedIn = new Promise<void>((resolve) => { completeSignIn = resolve })
    const prepareCredential = vi.fn(() => signedIn)
    const inference = new SampleInference({
      environment: { TLC_AI_MODE: 'foundry' }, credential: { getToken: vi.fn() },
      loadEnvironment: async () => configuration, prepareCredential, onFallback: vi.fn()
    })
    const online = vi.fn(async () => 'online')
    const offline = vi.fn(() => 'offline')
    const controller = new AbortController()
    const pending = inference.run(online, offline, controller.signal)
    await vi.waitFor(() => expect(prepareCredential).toHaveBeenCalledOnce())
    controller.abort(new Error('Synthetic cancellation during sign-in'))
    if (!completeSignIn) throw new Error('Credential preparation did not start.')
    completeSignIn()
    await expect(pending).rejects.toThrow('Synthetic cancellation during sign-in')
    expect(online).not.toHaveBeenCalled()
    expect(offline).not.toHaveBeenCalled()
    inference.close()
  })

  it('keeps each sample model setting independent of a disabled working-session deployment', () => {
    const inference = new SampleInference({ environment: { TLC_AI_MODE: 'foundry', TLC_WORKING_SESSION_MODEL: 'off' } })
    expect(() => inference.modelName('TLC_WORKING_SESSION_MODEL')).toThrow('disabled or unconfigured')
    expect(inference.modelName('TLC_MEETING_MODEL')).toBeTruthy()
    expect(inference.modelName('TLC_SE_REPORTING_MODEL')).not.toBe('off')
  })

  it('calls every real named agent over sample context with versioned result provenance', async () => {
    responses.mockResolvedValue({ output_text: 'Grounded model response.' })
    const inference = runtime()
    const msx = new FixtureMsxConnector()
    const core = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), inference.taskAgents(createSampleTaskAgents()))
    const account = (await msx.listAccounts())[0]!
    const opportunity = (await msx.listOpportunities(account.id))[0]!
    for (const capability of ['mcem-coach', 'account-pulse', 'risk-solution-play', 'pursuit-executive'] as const) {
      const result = await core.runAgentTask({ contractVersion, capability, accountId: account.id, opportunityId: opportunity.id, prompt: 'Review sample evidence.' })
      expect(result).toMatchObject({ contractVersion: '1.3', mode: 'sample', inference: { provider: 'foundry', state: 'complete' } })
    }
    expect(responses).toHaveBeenCalledTimes(4)
    expect(responses.mock.calls.map(([request]) => request.agent_reference.name).sort()).toEqual(
      ['tlc-mcem-coach', 'tlc-account-pulse', 'tlc-risk-solution-play', 'tlc-pursuit-executive'].sort())
  })

  it('labels non-streamed provider failure and never treats cancellation as fallback', async () => {
    responses.mockRejectedValue(new Error('Do not expose this private provider detail.'))
    const inference = runtime()
    const msx = new FixtureMsxConnector()
    const core = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), inference.taskAgents(createSampleTaskAgents()))
    const account = (await msx.listAccounts())[0]!
    const opportunity = (await msx.listOpportunities(account.id))[0]!
    const result = await core.runAgentTask({ contractVersion, capability: 'account-pulse', accountId: account.id, opportunityId: opportunity.id, prompt: 'Review sample evidence.' })
    expect(result).toMatchObject({ state: 'partial', inference: { provider: 'sample', state: 'fallback', reason: 'provider' } })
    expect(result.content).toContain('Offline/sample fallback')
    expect(result.content).not.toContain('private provider')
    const abort = new AbortController()
    abort.abort()
    await expect(inference.run(async () => 'real', () => 'fallback', abort.signal)).rejects.toThrow()
  })

  it('replaces failed streamed text with a labeled local draft and rejects invalid account context before calling Foundry', async () => {
    responses.mockImplementationOnce(async function* () {
      yield { type: 'response.output_text.delta', delta: 'UNACCEPTED-PARTIAL-MODEL-TEXT' }
      yield { type: 'response.failed' }
    })
    const inference = runtime()
    const msx = new FixtureMsxConnector()
    const core = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), inference.taskAgents(createSampleTaskAgents()))
    const account = (await msx.listAccounts())[0]!
    const opportunity = (await msx.listOpportunities(account.id))[0]!
    const events: AgentTaskStreamEvent[] = []
    await core.runAgentTaskStream({ contractVersion, capability: 'account-pulse', accountId: account.id, opportunityId: opportunity.id, prompt: 'Review sample evidence.' }, (event) => events.push(event))
    const final = events.find((event) => event.type === 'complete')
    expect(final).toMatchObject({ type: 'complete', response: { state: 'partial', inference: { state: 'fallback', provider: 'sample' } } })
    if (final?.type !== 'complete') throw new Error('Expected a completed fallback.')
    expect(final.response.content).not.toContain('UNACCEPTED-PARTIAL-MODEL-TEXT')
    responses.mockClear()
    await expect(core.runAgentTask({ contractVersion, capability: 'account-pulse', accountId: 'not-the-selected-account', opportunityId: opportunity.id, prompt: 'Review sample evidence.' })).rejects.toThrow('does not belong')
    expect(responses).not.toHaveBeenCalled()
  })

  it('uses real structured meeting extraction over SQLite and labels the deterministic fallback', async () => {
    const store = new LocalStore()
    try {
      const connector = new LocalStoreMsxConnector(store)
      const transcript = (await connector.listMeetingTranscripts('opp-grid-modernization'))[0]!
      const inference = runtime()
      completions.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ signals: [], newMilestones: [], unmappedSignals: [] }) } }] })
      const request = { opportunityId: 'opp-grid-modernization', transcriptId: transcript.id }
      const actual = await connector.proposeMeetingChangeSet(request, inference.meetingExtractor())
      expect(actual).toMatchObject({ contractVersion: '1.3', inference: { provider: 'foundry', state: 'complete' } })
      completions.mockRejectedValueOnce(new Error('provider unavailable'))
      const fallback = await connector.proposeMeetingChangeSet(request, inference.meetingExtractor())
      expect(fallback).toMatchObject({ inference: { provider: 'sample', state: 'fallback' } })
      expect(fallback.slots.length + fallback.unmappedSignals.length).toBeGreaterThan(0)
      expect(completions).toHaveBeenCalledTimes(2)
    } finally { store.close() }
  })

  it('uses real working-session topic/template inference while keeping source lookups local', async () => {
    const inference = runtime()
    const output = new DownloadStore()
    const service = createWorkingSessionService({
      mode: 'sample', inference, openOutput: async (name) => zipOutput(output, 'sample', name),
      fetcher: async () => { throw new Error('Sample working sessions must not search live sources.') }
    })
    completions.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
      topic: 'Azure Storage proof of concept', domain: 'Storage', azureServices: ['Azure Storage'],
      deckQueries: ['Azure Storage'], learnQueries: ['Azure Storage overview'],
      iacScenario: 'A minimal storage account', confidence: 'high', evidence: ['Storage pilot']
    }) } }] })
    const topic = await service.deriveTopic({ contractVersion: '1.0', opportunityId: 'sample', opportunityName: 'Storage pilot', milestoneName: 'Proof of concept' })
    expect(topic).toMatchObject({ inference: { provider: 'foundry', state: 'complete' }, topic: { basis: 'model' } })
    completions.mockRejectedValueOnce(new Error('provider unavailable'))
    const prepared = await service.prepare({
      contractVersion: '1.0', opportunityId: 'sample', opportunityName: 'Storage pilot', milestoneName: 'Proof of concept',
      topic: topic.topic, deliverables: { decks: false, learn: false, iac: true }
    })
    expect(prepared).toMatchObject({ mode: 'sample', inference: { provider: 'sample', state: 'fallback' } })
    expect(prepared.gaps.some((gap) => gap.message.includes('Offline/sample fallback'))).toBe(true)
    expect(prepared.files.some((file) => file.path.endsWith('main.bicep'))).toBe(true)
    expect(completions).toHaveBeenCalledTimes(2)
  })

  it('does not apply sample provider/fallback policy to a live working-session service', async () => {
    const inference = runtime()
    const run = vi.spyOn(inference, 'run')
    const output = new DownloadStore()
    const service = createWorkingSessionService({ mode: 'live', inference, openOutput: async (name) => zipOutput(output, 'test', name) })
    const result = await service.deriveTopic({ contractVersion: '1.0', opportunityId: 'sample', opportunityName: 'SQL pilot', milestoneName: 'Proof of concept' })
    expect(result).toMatchObject({ contractVersion: '1.0', mode: 'live', topic: { basis: 'rules' } })
    expect(result).not.toHaveProperty('inference')
    expect(run).not.toHaveBeenCalled()
  })

  it('synthesizes sample reporting without enabling live collection or publication', async () => {
    responses.mockResolvedValue({ output_text: JSON.stringify({ ...emptySeNarratives(), qualifying_evidence_ids: [] }) })
    const host = createSampleSeReportingHost({ inference: runtime() })
    const result = await host.invoke({
      contractVersion: '1.0', operation: 'run', profileId: 'sample-manager', period: '2026-10', pillar: 'infra',
      allowUnavailable: [], confirmed: true
    })
    expect(result).toMatchObject({ kind: 'state', mode: 'sample', contractVersion: '1.3', inference: { provider: 'foundry', state: 'complete' } })
    expect(responses).toHaveBeenCalledOnce()
  })
})
