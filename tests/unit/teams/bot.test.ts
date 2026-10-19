import { afterEach, describe, expect, it, vi } from 'vitest'
import { routeTeamsCommand, assertActivityActor } from '../../../apps/teams/src/bot-commands.js'
import { createSampleApplicationServices, type ApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'

const user: ExecutionPrincipal = { key: 't:u', tenantId: 't', userId: 'u', environmentId: 'env', roles: ['TLC.Teams.User'], mode: 'sample' }
const services: ApplicationServices[] = []
afterEach(async () => { for (const service of services.splice(0)) await service.dispose() })
async function fixture() { const service = await createSampleApplicationServices(); services.push(service); return service }

describe('deterministic Teams conversational transport', () => {
  it('binds the authenticated API user to the signed activity actor', () => {
    expect(() => assertActivityActor(user, { userId: 'u', tenantId: 't' })).not.toThrow()
    expect(() => assertActivityActor(user, { userId: 'other', tenantId: 't' })).toThrow()
    expect(() => assertActivityActor(user, { userId: 'u', tenantId: 'other' })).toThrow()
    expect(() => assertActivityActor(user, {})).toThrow()
  })
  it('keeps source data private and does not attempt channel-scope SSO', async () => {
    const service = await fixture()
    const read = vi.spyOn(service.orchestrator, 'listAccounts')
    const reply = await routeTeamsCommand({ conversationType: 'channel', text: 'accounts', principal: user }, service, 'https://tlc.example.com')
    expect(reply.text).toMatch(/private/i)
    expect(read).not.toHaveBeenCalled()
    const group = await routeTeamsCommand({ conversationType: 'groupChat', text: 'accounts', principal: user }, service, 'https://tlc.example.com')
    expect(group.text).toMatch(/private/i)
    expect(read).not.toHaveBeenCalled()
  })
  it('uses the shared account operation for personal messages and does not execute mutation commands', async () => {
    const service = await fixture()
    const reply = await routeTeamsCommand({ conversationType: 'personal', text: 'accounts', principal: user }, service, 'https://tlc.example.com')
    expect(reply.text).toContain((await service.orchestrator.listAccounts())[0]!.name)
    const write = vi.spyOn(service.orchestrator, 'updateOpportunity')
    expect((await routeTeamsCommand({ conversationType: 'personal', text: 'update opportunity arbitrary', principal: user }, service, 'https://tlc.example.com')).text).toMatch(/review/i)
    expect(write).not.toHaveBeenCalled()
  })
})
