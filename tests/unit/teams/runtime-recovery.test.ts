import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startTeamsServer } from '../../../apps/teams/src/server.js'
import { samplePrincipal } from '../../../apps/teams/src/app.js'
import { principalPartition } from '../../../packages/orchestrator/collaboration/principal.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() } finally { vi.restoreAllMocks() } })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tlc-teams-recovery-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const environment = {
    TLC_TEAMS_MODE: 'sample', TLC_TEAMS_RUNTIME_PROFILE: 'local',
    TLC_TEAMS_HOST: '127.0.0.1', TLC_TEAMS_PORT: '0', TLC_TEAMS_DATA_DIR: directory
  }
  async function start() {
    const application = await startTeamsServer(environment)
    cleanups.push(() => application.close())
    const address = application.server.address()
    if (!address || typeof address === 'string') throw new Error('Missing sample listener.')
    const origin = `http://127.0.0.1:${address.port}`
    const get = (path: string) => fetch(`${origin}/api/teams/${path}`)
    const post = (path: string, input: unknown) => fetch(`${origin}/api/teams/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input)
    })
    return { application, get, post }
  }
  return { start }
}

describe('ordinary local runtime stop and recovery', () => {
  it('logs safe metadata rather than prompts, source notes, tokens or private data-directory names', async () => {
    const logs: string[] = []
    vi.spyOn(console, 'info').mockImplementation((...values: unknown[]) => { logs.push(values.map(String).join(' ')) })
    vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => { logs.push(values.map(String).join(' ')) })
    const { start } = await fixture()
    const { post, application } = await start()
    const accounts = await (await post('operations/listAccounts', {})).json() as Array<{ id: string }>
    const opportunities = await (await post('operations/listOpportunities', { accountId: accounts[0]!.id })).json() as Array<{ id: string }>
    const opportunityId = opportunities[0]!.id
    expect((await post('operations/runAgentTask', {
      contractVersion: '1.2', capability: 'account-pulse', accountId: accounts[0]!.id, opportunityId,
      prompt: 'synthetic-private-prompt-do-not-log'
    })).status).toBe(200)
    expect((await post('actions/preview', {
      operation: 'updateOpportunity', input: { opportunityId, update: { comments: 'synthetic-private-note-do-not-log' } }
    })).status).toBe(200)
    expect((await post('operations/listAccounts', { token: 'synthetic-token-do-not-log' })).status).toBe(400)
    await application.close()
    const output = logs.join('\n')
    expect(output).toContain('profile=local state=sqlite')
    expect(output).toContain('invalid_request POST operations')
    expect(output).not.toMatch(/synthetic-private-|synthetic-token|tlc-teams-recovery-/)
  })
  it('stops idempotently, reopens durable admission/sample writes, and never resets on a runtime restart', async () => {
    const { start } = await fixture()
    const first = await start()
    const accounts = await (await first.post('operations/listAccounts', {})).json() as Array<{ id: string }>
    const opportunities = await (await first.post('operations/listOpportunities', { accountId: accounts[0]!.id })).json() as Array<{ id: string }>
    const opportunityId = opportunities[0]!.id
    const preview = await (await first.post('actions/preview', {
      operation: 'updateOpportunity', input: { opportunityId, update: { comments: 'Persisted sanitized laptop restart check' } }
    })).json() as { id: string; digest: string }
    expect(await (await first.post('actions/commit', {
      contractVersion: '1.0', id: preview.id, digest: preview.digest, reason: 'Reviewed sanitized fixture'
    })).json()).toMatchObject({ state: 'confirmed' })
    await first.post('lifecycle', { contractVersion: '1.0', command: 'pause' })
    await first.application.close()
    await first.application.close()
    const second = await start()
    expect(await (await second.get('lifecycle')).json()).toMatchObject({ state: 'paused', generation: 1 })
    expect(await (await second.post('operations/getOpportunityContext', { opportunityId })).json()).toMatchObject({
      opportunity: { comments: 'Persisted sanitized laptop restart check' }
    })
    expect((await second.post('operations/workflows.start', {})).status).toBe(409)
  })

  it('retains an interrupted dispatch as effect-unknown and does not replay it after restart', async () => {
    const { start } = await fixture()
    const first = await start()
    const accounts = await (await first.post('operations/listAccounts', {})).json() as Array<{ id: string }>
    const opportunities = await (await first.post('operations/listOpportunities', { accountId: accounts[0]!.id })).json() as Array<{ id: string }>
    const opportunityId = opportunities[0]!.id
    const before = await (await first.post('operations/getOpportunityContext', { opportunityId })).json()
    const preview = await (await first.post('actions/preview', {
      operation: 'updateOpportunity', input: { opportunityId, update: { comments: 'Must not replay on restart' } }
    })).json() as { id: string; digest: string }
    const partition = principalPartition(samplePrincipal)
    const row = await first.application.store.read(partition, `action:${preview.id}`)
    if (!row || !row.value || typeof row.value !== 'object') throw new Error('Missing reviewed action fixture.')
    await first.application.store.replace(partition, `action:${preview.id}`, row.revision, {
      ...row.value, claimed: true, claimedAt: new Date().toISOString()
    })
    await first.application.close()
    const second = await start()
    const activity = await (await second.get('activity')).json() as { actions: unknown[] }
    expect(activity.actions).toContainEqual(expect.objectContaining({ id: preview.id, state: 'effect-unknown' }))
    expect((await second.post('actions/commit', {
      contractVersion: '1.0', id: preview.id, digest: preview.digest, reason: 'Never repeat unknown effect'
    })).status).toBe(500)
    expect(await (await second.post('operations/getOpportunityContext', { opportunityId })).json()).toEqual(before)
  })
})
