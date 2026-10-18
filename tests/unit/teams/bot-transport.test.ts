import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import express from 'express'
import { describe, expect, it, vi } from 'vitest'
import { EncryptedSdkState } from '../../../apps/teams/src/credential-state.js'
import { registerTeamsBot } from '../../../apps/teams/src/bot.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { loadTeamsConfiguration } from '../../../apps/teams/src/configuration.js'

describe('encrypted bot credential-state boundary', () => {
  it('never persists plaintext credentials, reopens with the same key, and fails closed on key mismatch', async () => {
    const store = new SqliteDocumentStore()
    try {
      const key = Buffer.alloc(32, 7)
      const state = new EncryptedSdkState(store, 'bot-credentials', key)
      await state.set('user-context', { token: 'sensitive-test-token' })
      expect(await new EncryptedSdkState(store, 'bot-credentials', key).get('user-context')).toEqual({ token: 'sensitive-test-token' })
      const persisted = await store.read('bot-credentials', createHash('sha256').update('user-context').digest('hex'))
      expect(JSON.stringify(persisted)).not.toContain('sensitive-test-token')
      await expect(new EncryptedSdkState(store, 'bot-credentials', Buffer.alloc(32, 8)).get('user-context')).rejects.toThrow()
      await state.delete('user-context')
      expect(await state.get('user-context')).toBeUndefined()
    } finally { store.close() }
  })
})

describe('real Teams SDK ingress', () => {
  it('rejects unauthenticated activity before resolving any business runtime', async () => {
    const configuration = loadTeamsConfiguration({
      TLC_TEAMS_MODE: 'live', TLC_TEAMS_ORIGIN: 'https://tlc.example.com',
      TLC_TEAMS_TENANT_ID: '11111111-1111-4111-8111-111111111111',
      TLC_TEAMS_API_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
      TLC_TEAMS_SPA_CLIENT_ID: '33333333-3333-4333-8333-333333333333',
      TLC_TEAMS_BOT_CLIENT_ID: '44444444-4444-4444-8444-444444444444',
      TLC_TEAMS_API_CREDENTIAL: 'test-api-credential', TLC_TEAMS_BOT_CREDENTIAL: 'test-bot-credential',
      TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com', TLC_TEAMS_MCP_SCOPE: 'https://example.crm.dynamics.com/mcp.tools',
      TLC_TEAMS_STORAGE_URL: 'https://example.table.core.windows.net', TLC_TEAMS_ENVIRONMENT_ID: 'test'
    })
    if (configuration.mode !== 'live') throw new Error('Test configuration mismatch')
    const web = express()
    const store = new SqliteDocumentStore()
    const resolveServices = vi.fn()
    const transport = await registerTeamsBot({ web, configuration, store, stateKey: Buffer.alloc(32, 7), resolveServices })
    const server = createServer(web)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      expect(transport.bot.options.dangerouslyAllowUnauthenticatedRequests).toBe(false)
      expect(transport.bot.options.telemetry).toEqual({ agent365: false })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing listener')
      const response = await fetch(`http://127.0.0.1:${address.port}/api/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'message', text: 'accounts', from: { aadObjectId: 'pretend-user' } })
      })
      expect(response.status).toBe(401)
      expect(resolveServices).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
      store.close()
    }
  })
})
