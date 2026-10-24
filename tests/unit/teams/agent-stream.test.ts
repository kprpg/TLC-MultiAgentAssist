import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createTeamsHandler } from '../../../apps/teams/src/app.js'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { loadTeamsConfiguration } from '../../../apps/teams/src/configuration.js'
import { collaborationVersion } from '../../../packages/common/contracts/collaboration.js'
import { agentTaskStreamEventSchema, contractVersion } from '../../../packages/common/contracts/index.js'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function start() {
  const services = await createSampleApplicationServices()
  cleanups.push(() => services.dispose())
  const store = new SqliteDocumentStore()
  cleanups.push(() => store.close())
  const handler = createTeamsHandler({
    configuration: loadTeamsConfiguration({}), store, resolveServices: async () => services, acceptNewWork: true,
    authority: { verify: async () => ({ revision: 'sample-policy', canConfigure: true, canPublish: true, audienceEligible: true }) }
  })
  const server: Server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
  const post = (path: string, value: unknown) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  return { services, post }
}

describe('Teams agent stream', () => {
  it('streams the instant draft then a validated authoritative response as NDJSON', async () => {
    const { services, post } = await start()
    const account = (await services.orchestrator.listAccounts())[0]!
    const opportunity = (await services.orchestrator.listOpportunities(account.id))[0]!
    const response = await post('/api/teams/agent-stream', {
      contractVersion, capability: 'account-pulse', accountId: account.id, opportunityId: opportunity.id, prompt: 'Show guidance'
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    const events = (await response.text()).split('\n').filter(Boolean).map((line) => agentTaskStreamEventSchema.parse(JSON.parse(line)))
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['context', 'complete']))
    expect(events.at(-1)).toMatchObject({ type: 'complete', response: { capability: 'account-pulse' } })
  })

  it('applies the same validation and lifecycle admission as the operation endpoint', async () => {
    const { services, post } = await start()
    const account = (await services.orchestrator.listAccounts())[0]!
    const opportunity = (await services.orchestrator.listOpportunities(account.id))[0]!
    const input = { contractVersion, capability: 'account-pulse', accountId: account.id, opportunityId: opportunity.id, prompt: 'Show guidance' }
    expect((await post('/api/teams/agent-stream', { ...input, prompt: 'x' })).status).toBe(400)
    await post('/api/teams/lifecycle', { contractVersion: collaborationVersion, command: 'pause' })
    expect((await post('/api/teams/agent-stream', input)).status).toBe(409)
  })
})
