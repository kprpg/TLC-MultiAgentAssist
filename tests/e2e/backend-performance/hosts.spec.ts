import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test, _electron as electron, type Page } from '@playwright/test'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { z } from 'zod'
import { createTeamsHandler } from '../../../apps/teams/src/app.js'
import { TeamsAuthorizationError } from '../../../apps/teams/src/authentication.js'
import { buildWebApiHandler } from '../../../apps/web/src/app.js'
import { buildLiveDataProvider } from '../../../apps/vscode-extension/src/live-provider-core.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import type { ResponseEnvelope } from '../../../apps/vscode-extension/src/message-contracts.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { createSampleWorkflowHost } from '../../../packages/orchestrator/workflows/index.js'
import type { ApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { portfolioIndexSchema, portfolioWorkspaceSchema, contractVersion, mcemResponseSchema, agentTaskResponseSchema } from '../../../packages/common/contracts/index.js'
import { seDomainDefinitions } from '../../../packages/common/configuration/se-domains.js'
import { createControlledLiveBackend, performanceAccountId, performanceOpportunityId, performanceSource } from '../../fixtures/performance/backend.js'

type Host = 'teams' | 'web' | 'desktop' | 'extension'
type Journey = 'workspace-baseline' | 'workspace-aggregate' | 'index-baseline' | 'index-aggregate' | 'discovery' | 'mcem' | 'guidance'
declare global {
  interface Window {
    invokePerformanceBridge(message: unknown): Promise<ResponseEnvelope>
    performanceBridgeCall(method: string, input: unknown): Promise<unknown>
  }
}

const sourceDelayMs = 40
const trialCount = 3
const cleanup: Array<() => Promise<void> | void> = []
test.afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  cleanup.push(() => new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No isolated performance listener.')
  return `http://127.0.0.1:${address.port}`
}

async function sourceFixture() {
  const accounts = Array.from({ length: 3 }, (_, index) => ({
    accountid: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name: `Synthetic account ${index + 1}`
  }))
  const opportunities = accounts.flatMap((account, index) => Array.from({ length: 3 }, (_, offset) => ({
    opportunityid: `20000000-0000-4000-8000-${String(index * 3 + offset + 1).padStart(12, '0')}`,
    _parentaccountid_value: account.accountid, name: `Synthetic opportunity ${index * 3 + offset + 1}`,
    estimatedvalue: 100, msp_activesalesstage: 3,
    msp_technicalcapability: seDomainDefinitions.infra.technicalCapabilityCodes[0],
    '@odata.etag': 'W/"synthetic-version"'
  })))
  let reads = 0
  let writes = 0
  const origin = await listen((request, response) => {
    void (async () => {
      if (request.url === '/') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Isolated bridge fixture</title>'); return }
      if (request.method !== 'GET') { writes++; response.statusCode = 405; response.end('Read-only fixture.'); return }
      reads++
      await delay(sourceDelayMs)
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const entity = url.pathname.split('/').at(-1)
      let value: unknown
      if (entity === 'WhoAmI') value = { UserId: '30000000-0000-4000-8000-000000000001' }
      else if (entity === 'msp_dealteams') value = { value: opportunities.map((item) => ({ _msp_parentopportunityid_value: item.opportunityid })) }
      else if (entity === 'accounts') value = { value: accounts }
      else if (entity === 'opportunities') value = { value: opportunities }
      else if (entity === 'teamtemplates') value = { value: [] }
      else if (entity === 'msp_engagementmilestones') value = { value: [{
        msp_engagementmilestoneid: '40000000-0000-4000-8000-000000000001',
        msp_name: 'Synthetic validation milestone', msp_milestonedate: '2027-01-01', '@odata.etag': 'W/"synthetic-milestone"'
      }] }
      else { response.statusCode = 404; value = { error: 'Unexpected performance source read.' } }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(value))
    })().catch((error: unknown) => { response.statusCode = 500; response.end(String(error)) })
  })
  return { origin, reset: () => { reads = 0; writes = 0 }, metrics: () => ({ reads, writes }) }
}

function servicesFor(backend: ReturnType<typeof createControlledLiveBackend>): ApplicationServices {
  const disabled = async (): Promise<never> => { throw new Error('This fixture permits portfolio reads and deterministic guidance only.') }
  return {
    orchestrator: backend.core, workflows: createSampleWorkflowHost(disabled), workflowScopes: new Map(),
    sellerDashboard: { invoke: disabled },
    seReporting: { invoke: disabled },
    stagePipelineReview: { invoke: disabled },
    meetings: { proposeMeetingChangeSet: disabled, applyMeetingChangeSet: disabled },
    acquireTranscripts: disabled, resolveMeeting: disabled, listTranscriptSources: disabled, listRecentMeetings: disabled, resolveRecentMeeting: disabled, proposeTranscript: disabled,
    refreshSource: () => backend.msx.refresh(),
    withReadContext: (action) => backend.core.withReadContext(action),
    withReviewedVersions: disabled, dispose: async () => undefined
  }
}

async function protocolPage(host: Host, page: Page, source: string) {
  let tokenCalls = 0
  const createBackend = (cached: boolean) => createControlledLiveBackend(source, cached, () => { tokenCalls++ })
  let backend = createBackend(host !== 'teams')
  let services = servicesFor(backend)
  let logicalCalls = 0
  const reset = () => { tokenCalls = 0; backend = createBackend(host !== 'teams'); services = servicesFor(backend); logicalCalls = 0 }
  if (host === 'desktop') {
    const userData = await mkdtemp(join(tmpdir(), 'tlc-backend-performance-'))
    cleanup.push(() => rm(userData, { recursive: true, force: true }))
    const app = await electron.launch({
      args: [resolve('test-results', 'backend-performance-host', 'main.cjs'), `--user-data-dir=${userData}`],
      env: { ...process.env, TLC_PERFORMANCE_UPSTREAM: source }
    })
    cleanup.push(() => app.close())
    const renderer = await app.firstWindow()
    await renderer.waitForFunction(() => Boolean(window.tlc))
    return { page: renderer, reset: () => app.evaluate(() => globalThis.tlcPerformanceFixture.reset()),
      metrics: () => app.evaluate(() => globalThis.tlcPerformanceFixture.metrics()) }
  }
  if (host === 'extension') {
    await page.exposeFunction('invokePerformanceBridge', async (message: unknown) => {
      logicalCalls++
      return routeBridgeMessage(buildLiveDataProvider({
        orchestrator: backend.core, host: services.workflows, account: 'synthetic-user', dispose: async () => undefined
      }), message)
    })
    await page.addInitScript(() => {
      Object.defineProperty(window, 'acquireVsCodeApi', { value: () => ({
        getState: () => undefined, setState: () => undefined,
        postMessage: (message: unknown) => {
          if (message && typeof message === 'object' && 'kind' in message && message.kind === 'request') {
            void window.invokePerformanceBridge(message).then((response) => window.postMessage(response, window.location.origin))
          }
        }
      }) })
    })
    await page.goto(source)
    const bridge = transpileModule(await readFile(resolve('apps', 'vscode-extension', 'src', 'webview', 'bridge.ts'), 'utf8'), {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext }
    }).outputText
    await page.addScriptTag({ type: 'module', content: `${bridge}\nwindow.performanceBridgeCall = request;` })
    await page.waitForFunction(() => typeof window.performanceBridgeCall === 'function')
    return { page, reset, metrics: () => ({ tokenCalls, logicalCalls }) }
  }
  const store = new SqliteDocumentStore()
  cleanup.push(() => store.close())
  const configuration = {
    mode: 'live' as const, origin: '', tenantId: '77777777-7777-4777-8777-777777777777',
    apiClientId: '11111111-1111-4111-8111-111111111111', spaClientId: '22222222-2222-4222-8222-222222222222',
    botClientId: '33333333-3333-4333-8333-333333333333', apiCredential: 'synthetic-disabled', botCredential: 'synthetic-disabled',
    msxResource: performanceSource, mcpScope: `${performanceSource}/mcp.tools`, environmentId: 'performance-fixture'
  }
  const teams = createTeamsHandler({
    configuration, store, resolveServices: async () => services,
    authenticate: async (token) => {
      if (token !== 'synthetic-page') throw new TeamsAuthorizationError()
      return {
        key: 'synthetic-performance-user', mode: 'live', tenantId: configuration.tenantId,
        environmentId: configuration.environmentId, userId: '99999999-9999-4999-8999-999999999999', roles: ['TLC.Teams.User']
      }
    },
    authority: { verify: async () => { throw new Error('No publication authority is permitted in this fixture.') } }
  })
  const web = buildWebApiHandler({
    authenticate: () => ({ accessToken: 'synthetic-source', clientPrincipal: 'synthetic-user', userEmail: 'synthetic@example.test' }),
    createRuntime: () => {
      backend = createBackend(true)
      return Object.assign(backend.core, {
        listMeetingTranscripts: async () => [], getMeetingTranscript: async () => null,
        proposeMeetingChangeSet: async () => { throw new Error('Not permitted.') }, applyMeetingChangeSet: async () => { throw new Error('Not permitted.') }
      })
    }
  })
  const origin = await listen((request, response) => {
    if (request.url === '/') { response.end('<!doctype html><title>Isolated host protocol benchmark</title>'); return }
    logicalCalls++
    void (host === 'teams' ? teams(request, response) : web(request, response)).catch((error: unknown) => {
      response.statusCode = 500; response.end(String(error))
    })
  })
  configuration.origin = origin
  await page.goto(origin)
  return { page, reset, metrics: () => ({ tokenCalls, logicalCalls }) }
}

async function journey(page: Page, host: Host, action: Journey) {
  return page.evaluate(async ({ host, action, accountId, opportunityId, version }) => {
    const invoke = async (name: string): Promise<unknown> => {
      if (host === 'desktop') {
        const bridge = window.tlc
        if (!bridge) throw new Error('Production preload bridge missing.')
        if (name === 'listAccounts') return bridge.listAccounts()
        if (name === 'listOpportunities') return bridge.listOpportunities(accountId)
        if (name === 'listMilestones') return bridge.listMilestones(opportunityId)
        if (name === 'getPortfolioIndex') return bridge.getPortfolioIndex({ contractVersion: '1.0' })
        if (name === 'getPortfolioWorkspace') return bridge.getPortfolioWorkspace({ contractVersion: '1.0', accountId, opportunityId })
        if (name === 'discoverOpportunities') return bridge.discoverOpportunities('infra')
        if (name === 'runMcemCoach') return bridge.runMcemCoach({ contractVersion: version, accountId, opportunityId, prompt: 'Review current evidence.' })
        if (name === 'runAgentTask') return bridge.runAgentTask({ contractVersion: version, accountId, opportunityId, capability: 'account-pulse', prompt: 'Summarize current stage and risks.' })
      }
      let input: Record<string, unknown> = name === 'getPortfolioIndex' ? { contractVersion: '1.0' }
        : name === 'getPortfolioWorkspace' ? { contractVersion: '1.0', accountId, opportunityId }
          : name === 'listOpportunities' ? { accountId } : name === 'listMilestones' ? { opportunityId }
            : name === 'discoverOpportunities' ? { domain: 'infra' } : {}
      if (name === 'runMcemCoach' || name === 'runAgentTask') input = {
        ...(host === 'extension' ? {} : { contractVersion: version }), accountId, opportunityId,
        ...(name === 'runAgentTask' ? { capability: 'account-pulse', prompt: 'Summarize current stage and risks.' }
          : host === 'extension' ? {} : { prompt: 'Review current evidence.' })
      }
      if (host === 'extension') return window.performanceBridgeCall(name, input)
      const webPaths: Record<string, string> = {
        listAccounts: '/api/accounts', listOpportunities: `/api/accounts/${accountId}/opportunities`,
        listMilestones: `/api/opportunities/${opportunityId}/milestones`,
        getPortfolioIndex: '/api/portfolio/index', getPortfolioWorkspace: '/api/portfolio/workspace',
        discoverOpportunities: '/api/discover/infra', runMcemCoach: '/api/mcem-coach', runAgentTask: '/api/agent-task'
      }
      const post = host === 'teams' || ['getPortfolioIndex', 'getPortfolioWorkspace', 'runMcemCoach', 'runAgentTask'].includes(name)
      const response = await fetch(host === 'teams' ? `/api/teams/operations/${name}` : webPaths[name]!, {
        method: post ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', ...(host === 'teams' ? { authorization: 'Bearer synthetic-page' } : {}) },
        ...(post ? { body: JSON.stringify(input) } : {})
      })
      if (!response.ok) throw new Error(`Controlled ${host} ${name} failed with HTTP ${response.status}.`)
      return response.json()
    }
    const started = performance.now()
    let value: unknown
    if (action === 'workspace-baseline') {
      const accounts = await invoke('listAccounts')
      const opportunities = await invoke('listOpportunities')
      const milestones = await invoke('listMilestones')
      value = { contractVersion: '1.0', accounts, opportunities, milestones, selectedAccountId: accountId, selectedOpportunityId: opportunityId }
    } else if (action === 'index-baseline') {
      const accounts = await invoke('listAccounts')
      if (!Array.isArray(accounts)) throw new Error('Invalid baseline accounts.')
      const groups = await Promise.all(accounts.map(async (account: unknown) => {
        if (!account || typeof account !== 'object' || !('id' in account) || typeof account.id !== 'string') throw new Error('Invalid baseline account.')
        if (host === 'desktop') return window.tlc!.listOpportunities(account.id)
        if (host === 'extension') return window.performanceBridgeCall('listOpportunities', { accountId: account.id })
        const response = await fetch(host === 'teams' ? '/api/teams/operations/listOpportunities' : `/api/accounts/${account.id}/opportunities`, {
          method: host === 'teams' ? 'POST' : 'GET',
          headers: { 'content-type': 'application/json', ...(host === 'teams' ? { authorization: 'Bearer synthetic-page' } : {}) },
          ...(host === 'teams' ? { body: JSON.stringify({ accountId: account.id }) } : {})
        })
        if (!response.ok) throw new Error(`Baseline account fan-out failed with HTTP ${response.status}.`)
        return response.json()
      }))
      value = { contractVersion: '1.0', accounts, opportunities: groups.flat() }
    } else {
      value = await invoke(action === 'workspace-aggregate' ? 'getPortfolioWorkspace' : action === 'index-aggregate' ? 'getPortfolioIndex'
        : action === 'discovery' ? 'discoverOpportunities' : action === 'mcem' ? 'runMcemCoach' : 'runAgentTask')
    }
    return { value, durationMs: performance.now() - started }
  }, { host, action, accountId: performanceAccountId, opportunityId: performanceOpportunityId, version: contractVersion })
}

const median = (values: number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!

for (const host of ['teams', 'web', 'desktop', 'extension'] as const) {
  test(`${host}: backend round trips reduce work and controlled workspace latency without changing results`, async ({ page }, testInfo) => {
    const source = await sourceFixture()
    const protocol = await protocolPage(host, page, source.origin)
    const records: Array<{ journey: Journey; durationMs: number; sourceReads: number; tokenProviderCalls: number; logicalCalls: number }> = []
    for (let trial = 0; trial < trialCount; trial++) {
      for (const pair of [['workspace-baseline', 'workspace-aggregate'], ['index-baseline', 'index-aggregate']] as const) {
        let previous: unknown
        let aggregated: unknown
        const order = trial % 2 === 0 ? pair : [pair[1], pair[0]]
        for (const action of order) {
          await protocol.reset(); source.reset()
          const result = await journey(protocol.page, host, action)
          const parsed = action.startsWith('workspace') ? portfolioWorkspaceSchema.parse(result.value) : portfolioIndexSchema.parse(result.value)
          if (action.endsWith('baseline')) previous = parsed
          else aggregated = parsed
          const metrics = await protocol.metrics()
          const upstream = source.metrics()
          expect(upstream.writes).toBe(0)
          expect(metrics.tokenCalls).toBe(upstream.reads)
          if (action === 'workspace-aggregate') { expect(upstream.reads).toBe(6); expect(metrics.logicalCalls).toBe(1) }
          if (action === 'index-aggregate') { expect(upstream.reads).toBe(5); expect(metrics.logicalCalls).toBe(1) }
          if (action === 'workspace-baseline') expect(upstream.reads).toBe(host === 'teams' ? 16 : host === 'web' ? 17 : 7)
          if (action === 'index-baseline') expect(metrics.logicalCalls).toBe(4)
          records.push({ journey: action, durationMs: result.durationMs, sourceReads: upstream.reads, tokenProviderCalls: metrics.tokenCalls, logicalCalls: metrics.logicalCalls })
        }
        expect(aggregated).toEqual(previous)
      }
    }
    for (const action of ['discovery', 'mcem', 'guidance'] as const) {
      await protocol.reset(); source.reset()
      const result = await journey(protocol.page, host, action)
      if (action === 'mcem') expect(mcemResponseSchema.parse(result.value).mode).toBe('live')
      else if (action === 'guidance') expect(agentTaskResponseSchema.parse(result.value).mode).toBe('live')
      else expect(z.array(z.object({ accountId: z.string() })).parse(result.value)).toHaveLength(9)
      expect(source.metrics()).toEqual({ reads: 6, writes: 0 })
      const metrics = await protocol.metrics()
      expect(metrics.tokenCalls).toBe(6)
      records.push({ journey: action, durationMs: result.durationMs, sourceReads: 6, tokenProviderCalls: metrics.tokenCalls, logicalCalls: metrics.logicalCalls })
    }
    const baseline = median(records.filter((item) => item.journey === 'workspace-baseline').map((item) => item.durationMs))
    const optimized = median(records.filter((item) => item.journey === 'workspace-aggregate').map((item) => item.durationMs))
    expect(optimized).toBeLessThan(baseline)
    const evidence = {
      host, fixture: { accounts: 3, opportunities: 9, perSourceReadDelayMs: sourceDelayMs, trials: trialCount },
      workspaceMedianMs: { baseline: Math.round(baseline), optimized: Math.round(optimized) },
      records: records.map((item) => ({ ...item, durationMs: Math.round(item.durationMs) })),
      limits: 'Loopback synthetic reads and injected identity; no tenant, real credential acquisition, model or native UI rendering latency measured.'
    }
    console.log(JSON.stringify(evidence))
    await testInfo.attach(`${host}-backend-performance.json`, { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' })
  })
}
