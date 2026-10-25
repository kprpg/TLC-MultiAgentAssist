import { createServer, type Server } from 'node:http'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { createTeamsHandler } from '../../../apps/teams/src/app.js'
import { createTeamsWorkingSessionHost } from '../../../apps/teams/src/working-session.js'
import { loadTeamsConfiguration } from '../../../apps/teams/src/configuration.js'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { workingSessionPrepareRequestSchema, workingSessionResultSchema, workingSessionTopicResponseSchema } from '../../../packages/common/contracts/working-session.js'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function start(withWorkingSession = true) {
  const services = await createSampleApplicationServices()
  cleanups.push(() => services.dispose())
  const store = new SqliteDocumentStore()
  cleanups.push(() => store.close())
  const handler = createTeamsHandler({
    configuration: loadTeamsConfiguration({}), store, resolveServices: async () => services,
    ...(withWorkingSession ? { workingSession: createTeamsWorkingSessionHost({ mode: 'sample' }) } : {}),
    authority: { verify: async () => ({ revision: 'sample-policy', canConfigure: true, canPublish: true, audienceEligible: true }) }
  })
  const server: Server = createServer((request, response) => { void handler(request, response) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const post = (path: string, value: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  const account = (await services.orchestrator.listAccounts())[0]!
  const opportunity = (await services.orchestrator.listOpportunities(account.id))[0]!
  return { base, post, opportunity }
}

describe('Teams working-session routes', () => {
  it('derives a topic, prepares a zip folder and serves it back to the same user', async () => {
    const { base, post, opportunity } = await start()
    const topicRequest = { contractVersion: '1.0', opportunityId: opportunity.id, opportunityName: opportunity.name, milestoneName: 'POC' }
    const topic = workingSessionTopicResponseSchema.parse(await (await post('/api/teams/working-session/topic', topicRequest)).json()).topic
    const request = workingSessionPrepareRequestSchema.parse({ ...topicRequest, topic, deliverables: { decks: false, learn: true, iac: true } })
    const result = workingSessionResultSchema.parse(await (await post('/api/teams/working-session/prepare', request)).json())
    expect(result.delivery.kind).toBe('download')
    if (result.delivery.kind !== 'download') return
    const download = await fetch(`${base}/api/teams/working-session/download/${result.delivery.downloadId}`)
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('application/zip')
    const zip = await JSZip.loadAsync(Buffer.from(await download.arrayBuffer()))
    expect(Object.keys(zip.files).some((name) => name.endsWith('/iac/main.bicep'))).toBe(true)
  })

  it('requires access to the opportunity and a strict request, and is absent when not configured', async () => {
    const { post, opportunity, base } = await start()
    const valid = { contractVersion: '1.0', opportunityId: opportunity.id, opportunityName: opportunity.name, milestoneName: 'POC' }
    expect((await post('/api/teams/working-session/topic', { ...valid, opportunityId: 'unknown-opportunity' })).status).toBeGreaterThanOrEqual(400)
    expect((await post('/api/teams/working-session/topic', { ...valid, extra: 1 })).status).toBe(400)
    expect((await fetch(`${base}/api/teams/working-session/download/not-a-uuid`)).status).toBe(404)
    const bare = await start(false)
    expect((await bare.post('/api/teams/working-session/topic', valid)).status).toBe(404)
  })
})
