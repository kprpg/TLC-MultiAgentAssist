import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isCliConfiguration, loadTeamsConfiguration } from '../../../apps/teams/src/configuration.js'
import { createNativeConnection } from '../../../apps/teams/src/native-connection.js'
import { prepareOwnerDirectory } from '../../../apps/teams/src/local-owner-control.js'
import { temporaryRoot } from './test-temp-root.js'

const folders: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

async function fixture(writeMode: 'read-only' | 'reviewed') {
  const directory = await mkdtemp(join(temporaryRoot, 'tlc-cli-transport-'))
  folders.push(directory)
  const owner = join(directory, 'owner')
  await prepareOwnerDirectory(owner)
  const configuration = loadTeamsConfiguration({
    TLC_TEAMS_MODE: 'live', TLC_TEAMS_AUTH_MODE: 'local-azure-cli',
    TLC_TEAMS_ORIGIN: 'https://localhost:3978', TLC_TEAMS_CLI_WRITE_MODE: writeMode,
    TLC_TEAMS_TENANT_ID: '77777777-7777-4777-8777-777777777777',
    TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com', TLC_TEAMS_ENVIRONMENT_ID: 'offline-cli'
  })
  if (!isCliConfiguration(configuration)) throw new Error('Invalid CLI fixture.')
  const transport = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', transport)
  const connection = await createNativeConnection(configuration, { TLC_TEAMS_OWNER_DIRECTORY: owner })
  return { connection, transport }
}

describe.skipIf(process.platform !== 'win32')('explicit CLI source transport write policy', () => {
  it('blocks source mutations independently of the HTTP action gate in read-only mode', async () => {
    const { connection, transport } = await fixture('read-only')
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      expect(() => connection.fetchImplementation('https://example.crm.dynamics.com/api/data/v9.2/opportunities', { method }))
        .toThrow('native resource unavailable')
    }
    expect(transport).not.toHaveBeenCalled()
    expect(connection.provider.identity()).toBeUndefined()
  }, 40_000)
  it('allows the existing connector verbs only in explicit reviewed mode and retains timeout/cancellation', async () => {
    const { connection, transport } = await fixture('reviewed')
    const controller = new AbortController()
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      await connection.fetchImplementation('https://example.crm.dynamics.com/api/data/v9.2/opportunities', { method, signal: controller.signal })
    }
    expect(transport.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST', 'PATCH', 'DELETE'])
    const signal = transport.mock.calls.at(-1)?.[1]?.signal
    controller.abort()
    expect(signal?.aborted).toBe(true)
    expect(connection.provider.identity()).toBeUndefined()
  }, 40_000)
})
