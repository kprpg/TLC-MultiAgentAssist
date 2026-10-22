import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTeamsDataModeRouter } from '../../../apps/teams/src/data-mode-router.js'
import { createTeamsHandler } from '../../../apps/teams/src/app.js'
import { TeamsAuthorizationError } from '../../../apps/teams/src/authentication.js'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import { actionPreviewSchema } from '../../../packages/common/contracts/collaboration.js'
import type { TeamsLiveConfiguration } from '../../../apps/teams/src/configuration.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const sample = await createSampleApplicationServices({ dataPath: ':memory:' })
  const live = await createSampleApplicationServices({ dataPath: ':memory:' })
  cleanup.push(() => sample.dispose(), () => live.dispose())
  const sampleStore = new SqliteDocumentStore()
  const liveStore = new SqliteDocumentStore()
  cleanup.push(() => sampleStore.close(), () => liveStore.close())
  const livePrincipal: ExecutionPrincipal = {
    key: 'live-fixture', mode: 'live', tenantId: 'tenant', environmentId: 'environment', userId: 'user',
    roles: ['TLC.Teams.User', 'TLC.Teams.Writer']
  }
  const configuration: TeamsLiveConfiguration = {
    mode: 'live', origin: 'https://localhost:3978', tenantId: '77777777-7777-4777-8777-777777777777',
    apiClientId: '11111111-1111-4111-8111-111111111111', spaClientId: '22222222-2222-4222-8222-222222222222',
    botClientId: '33333333-3333-4333-8333-333333333333', apiCredential: 'offline-fixture', botCredential: 'offline-fixture',
    msxResource: 'https://example.crm.dynamics.com', mcpScope: 'https://example.crm.dynamics.com/mcp.tools', environmentId: 'fixture'
  }
  const authority = { verify: async () => ({ revision: 'fixture', canConfigure: true, canPublish: true, audienceEligible: true }) }
  const liveResolver = vi.fn(async () => live)
  const sampleResolver = vi.fn(async () => sample)
  const liveHandler = createTeamsHandler({
    configuration, store: liveStore, authority, resolveServices: liveResolver,
    authenticate: async (token) => {
      if (token !== 'live-fixture-token') throw new TeamsAuthorizationError()
      return livePrincipal
    }
  })
  const sampleHandler = createTeamsHandler({
    configuration: { mode: 'sample', origin: configuration.origin, environmentId: 'sample' },
    store: sampleStore, authority, resolveServices: sampleResolver
  })
  const router = createTeamsDataModeRouter({ configuration, initialMode: 'sample', live: liveHandler, sample: sampleHandler })
  const server = createServer((request, response) => { void router(request, response) })
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  cleanup.push(() => new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable.')
  const base = `http://127.0.0.1:${address.port}`
  const post = (path: string, body: unknown, liveToken = false) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(liveToken ? { authorization: 'Bearer live-fixture-token' } : {}) },
    body: JSON.stringify(body)
  })
  return { sample, live, post, base, sampleResolver, liveResolver }
}

describe('isolated Teams Sample and Live API routing', () => {
  it('serves Sample through canonical SQLite services without invoking Live and keeps Live authorization mandatory', async () => {
    const { post, base, sampleResolver, liveResolver } = await fixture()
    const modes = await (await fetch(base + '/api/teams/modes')).json()
    expect(modes).toMatchObject({ contractVersion: '1.0', initialMode: 'sample', runtimeMode: 'live', availableModes: ['sample', 'live'] })
    const sample = await post('/api/teams/sample/operations/listAccounts', {})
    expect(sample.status).toBe(200)
    expect(sampleResolver).toHaveBeenCalled()
    expect(liveResolver).not.toHaveBeenCalled()
    expect((await post('/api/teams/live/operations/listAccounts', {})).status).toBe(401)
    expect(liveResolver).not.toHaveBeenCalled()
    expect((await post('/api/teams/live/operations/listAccounts', {}, true)).status).toBe(200)
    expect(liveResolver).toHaveBeenCalledTimes(1)
  })
  it('keeps Sample edits and approval records out of Live while repeatedly switching on one running server', async () => {
    const { post, sample, live, liveResolver } = await fixture()
    const account = (await sample.orchestrator.listAccounts())[0]!
    const opportunity = (await sample.orchestrator.listOpportunities(account.id))[0]!
    const liveBefore = await live.orchestrator.getOpportunitySnapshot(opportunity.id)
    const preview = actionPreviewSchema.parse(await (await post('/api/teams/sample/actions/preview', {
      operation: 'updateOpportunity', input: { opportunityId: opportunity.id, update: { comments: 'Sample-only edit' } }
    })).json())
    const approval = { contractVersion: '1.0', id: preview.id, digest: preview.digest, reason: 'Explicit sample-only review' }
    const wrongMode = await post('/api/teams/live/actions/commit', approval, true)
    expect(wrongMode.status).toBeGreaterThanOrEqual(400)
    expect(await live.orchestrator.getOpportunitySnapshot(opportunity.id)).toEqual(liveBefore)
    expect(await (await post('/api/teams/sample/actions/commit', approval)).json()).toMatchObject({ state: 'confirmed' })
    for (let index = 0; index < 3; index++) {
      expect((await post('/api/teams/live/operations/listAccounts', {}, true)).status).toBe(200)
      const read = await post('/api/teams/sample/operations/getOpportunityContext', { opportunityId: opportunity.id })
      expect(await read.json()).toMatchObject({ opportunity: { comments: 'Sample-only edit' } })
    }
    expect(liveResolver).toHaveBeenCalledTimes(4)
  })
})
