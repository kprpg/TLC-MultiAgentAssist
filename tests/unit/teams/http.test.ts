import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTeamsHandler } from '../../../apps/teams/src/app.js'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { loadTeamsConfiguration } from '../../../apps/teams/src/configuration.js'
import { collaborationVersion } from '../../../packages/common/contracts/collaboration.js'
import { contractVersion } from '../../../packages/common/contracts/version.js'
import JSZip from 'jszip'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function start(acceptNewWork = true) {
  const services = await createSampleApplicationServices()
  cleanups.push(() => services.dispose())
  const store = new SqliteDocumentStore()
  cleanups.push(() => store.close())
  const handler = createTeamsHandler({
    configuration: loadTeamsConfiguration({}), store, resolveServices: async () => services, acceptNewWork,
    authority: { verify: async () => ({ revision: 'sample-policy', canConfigure: true, canPublish: true, audienceEligible: true }) }
  })
  const server: Server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
  const base = `http://127.0.0.1:${address.port}`
  const post = (path: string, value: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) })
  return { services, store, base, post }
}

describe('Teams same-origin verified operation boundary', () => {
  it('pauses new effects, preserves reads and cancellation, and requires a fresh review after resume', async () => {
    const { services, base, post } = await start()
    const account = (await services.orchestrator.listAccounts())[0]!
    const opportunity = (await services.orchestrator.listOpportunities(account.id))[0]!
    const before = await services.orchestrator.getOpportunitySnapshot(opportunity.id)
    const input = { opportunityId: opportunity.id, update: { comments: 'Must not survive pause' } }
    const preview = await (await post('/api/teams/actions/preview', { operation: 'updateOpportunity', input })).json() as { id: string; digest: string }
    const approval = { contractVersion: collaborationVersion, ...preview, reason: 'Reviewed before pausing' }
    const exactApproval = { contractVersion: approval.contractVersion, id: approval.id, digest: approval.digest, reason: approval.reason }
    expect(await (await post('/api/teams/lifecycle', { contractVersion: collaborationVersion, command: 'pause' })).json()).toMatchObject({ state: 'paused', acceptingNewWork: false })
    expect((await post('/api/teams/actions/commit', exactApproval)).status).toBe(409)
    expect((await post('/api/teams/operations/listAccounts', {})).status).toBe(200)
    expect((await post('/api/teams/operations/runAgentTask', {
      contractVersion: '1.2', capability: 'account-pulse', accountId: account.id, opportunityId: opportunity.id, prompt: 'Show guidance'
    })).status).toBe(409)
    expect(await (await post('/api/teams/lifecycle', { contractVersion: collaborationVersion, command: 'resume' })).json()).toMatchObject({ state: 'active', generation: 2 })
    const stale = await post('/api/teams/actions/commit', exactApproval)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'action_review_stale' })
    expect(await services.orchestrator.getOpportunitySnapshot(opportunity.id)).toEqual(before)
    expect((await fetch(base + '/api/teams/lifecycle')).status).toBe(200)
  })

  it('enforces operator read-only admission independently of a user resume', async () => {
    const { post } = await start(false)
    expect(await (await post('/api/teams/lifecycle', { contractVersion: collaborationVersion, command: 'resume' })).json()).toMatchObject({ acceptingNewWork: false })
    expect((await post('/api/teams/operations/listAccounts', {})).status).toBe(200)
    const blocked = await post('/api/teams/operations/workflows.start', {})
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toMatchObject({ error: 'new_work_disabled' })
    expect((await post('/api/teams/meetings/acquire', {})).status).toBe(409)
  })
  it('returns explicit sample/session data and preserves the current core account output', async () => {
    const { base, post, services } = await start()
    const session = await fetch(base + '/api/teams/session')
    expect(session.status).toBe(200)
    expect(session.headers.get('cache-control')).toBe('no-store')
    expect(await session.json()).toMatchObject({ contractVersion: collaborationVersion, mode: 'sample' })
    const response = await post('/api/teams/operations/listAccounts', {})
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(await services.orchestrator.listAccounts())
  })
  it('blocks direct mutations and requires reviewed server-owned intents', async () => {
    const { services, post } = await start()
    const account = (await services.orchestrator.listAccounts())[0]!
    const opportunity = (await services.orchestrator.listOpportunities(account.id))[0]!
    const input = { opportunityId: opportunity.id, update: { comments: 'Review required' } }
    expect((await post('/api/teams/operations/updateOpportunity', input)).status).toBe(403)
    const previewResponse = await post('/api/teams/actions/preview', { operation: 'updateOpportunity', input })
    expect(previewResponse.status).toBe(200)
    const preview = await previewResponse.json() as { id: string; digest: string }
    const approval = { contractVersion: collaborationVersion, id: preview.id, digest: preview.digest, reason: 'Reviewed exact source target' }
    const committed = await post('/api/teams/actions/commit', approval)
    expect(await committed.json()).toMatchObject({ state: 'confirmed' })
    expect(await (await post('/api/teams/actions/commit', approval)).json()).toMatchObject({ state: 'confirmed' })
  })
  it('rejects cross-origin, malformed and oversized requests without leaking internals', async () => {
    const { base, post } = await start()
    expect((await post('/api/teams/operations/listAccounts', {}, { origin: 'https://evil.example.com', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post('/api/teams/operations/listAccounts', { unknown: true })).status).toBe(400)
    const invalid = await fetch(base + '/api/teams/operations/listAccounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' })
    expect(invalid.status).toBe(400)
    expect((await post('/api/teams/operations/listAccounts', { padding: 'x'.repeat(1_048_577) })).status).toBe(413)
    const unknown = await post('/api/teams/operations/__proto__', {})
    expect(unknown.status).toBe(404)
    expect(await unknown.text()).not.toContain('node_modules')
  })
  it('never falls through to sample for a missing or invalid live token', async () => {
    const store = new SqliteDocumentStore()
    cleanups.push(() => store.close())
    const resolver = vi.fn()
    const handler = createTeamsHandler({
      configuration: { mode: 'sample', origin: 'http://127.0.0.1:3978', environmentId: 'sample' },
      store, resolveServices: resolver,
      authenticate: async () => { throw new Error('Authorization denied') },
      authority: { verify: async () => { throw new Error('No authority') } }
    })
    const server = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => { server.close(() => resolve()) }))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing address')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/teams/session`)
    expect(response.status).toBe(401)
    expect(resolver).not.toHaveBeenCalled()
  })
  it('automatically acquires a canonical sample transcript, retains its draft server-side, and blocks proposal injection', async () => {
    const { services, post } = await start()
    let source: { opportunityId: string; transcriptId: string; meetingType: 'customer' | 'internal' } | undefined
    for (const account of await services.orchestrator.listAccounts()) {
      for (const opportunity of await services.orchestrator.listOpportunities(account.id)) {
        const first = (await services.listTranscriptSources(opportunity.id))[0]
        if (first) { source = { opportunityId: opportunity.id, transcriptId: first.id, meetingType: first.meetingType }; break }
      }
      if (source) break
    }
    expect(source).toBeDefined()
    const selected = source!
    const before = await services.orchestrator.getOpportunitySnapshot(selected.opportunityId)
    const response = await post('/api/teams/meetings/acquire', {
      meetingId: selected.transcriptId, opportunityId: selected.opportunityId, meetingType: selected.meetingType
    })
    expect(response.status).toBe(200)
    const result = await response.json() as { status: { id: string; state: string }; proposals: unknown[] }
    expect(result.status.state).toBe('ready')
    expect(result.proposals.length).toBeGreaterThan(0)
    expect(await services.orchestrator.getOpportunitySnapshot(selected.opportunityId)).toEqual(before)
    const injected = await post('/api/teams/actions/preview', {
      operation: 'applyMeetingChangeSet', input: { proposal: result.proposals[0], approval: {} }
    })
    expect(injected.status).toBe(403)
    expect((await post('/api/teams/meetings/review', { acquisitionId: result.status.id })).status).toBe(200)
  })
  it('exports an authorized Word response and an unsent email draft without sending mail', async () => {
    const { services, post } = await start()
    const account = (await services.orchestrator.listAccounts())[0]!
    const opportunity = (await services.orchestrator.listOpportunities(account.id))[0]!
    const document = {
      contractVersion, responseTitle: 'Reviewed TLC result', responseMarkdown: '## Summary\n\nGrounded result.',
      generatedAt: '2026-10-17T20:00:00.000Z'
    }
    const response = await post('/api/teams/documents/export', { opportunityId: opportunity.id, document })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('wordprocessingml')
    const zip = await JSZip.loadAsync(await response.arrayBuffer())
    expect(await zip.file('word/document.xml')!.async('string')).toContain('Grounded result.')
    const email = await post('/api/teams/documents/email', {
      opportunityId: opportunity.id,
      draft: { contractVersion, recipients: ['reviewer@example.com'], subject: 'Review this TLC draft', responseTitle: document.responseTitle, responseMarkdown: document.responseMarkdown }
    })
    expect(email.status).toBe(200)
    expect(await email.text()).toContain('X-Unsent: 1')
  })
  it('resolves message-extension references only through the owner partition and a fresh source lookup', async () => {
    const { services, store, base } = await start()
    const account = (await services.orchestrator.listAccounts())[0]!
    await store.insert('sample:sample:sample-user', 'reference:private-reference', { accountId: account.id, query: account.name })
    const response = await fetch(base + '/api/teams/references/private-reference')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: account.id, name: account.name })
    expect((await fetch(base + '/api/teams/references/another-user-reference')).status).toBe(403)
  })
})
