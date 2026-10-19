import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { CollaborationService } from '../../../packages/orchestrator/collaboration/contexts.js'
import { PublicationService } from '../../../packages/orchestrator/collaboration/publications.js'
import { ReviewedActionService } from '../../../packages/orchestrator/collaboration/reviewed-actions.js'
import { collaborationVersion } from '../../../packages/common/contracts/collaboration.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'

const user: ExecutionPrincipal = { tenantId: 't', userId: 'u', key: 't:u', environmentId: 'env', mode: 'sample', roles: ['TLC.Teams.User', 'TLC.Teams.ContextAdmin', 'TLC.Teams.Publisher'] }
const stores: SqliteDocumentStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })

describe('server-generated reviewed shared publications', () => {
  it('requires exact approved source/policy and only delivers once; shared readers are independently verified', async () => {
    const store = new SqliteDocumentStore(); stores.push(store)
    let audienceEligible = true
    let sourceTitle = 'Authorized opportunity'
    const contexts = new CollaborationService(store, {
      verify: async () => ({ revision: 'v1', canConfigure: true, canPublish: true, audienceEligible })
    }, async () => undefined)
    const binding = await contexts.bind(user, { kind: 'channel', contextId: 'channel', accountId: 'account', opportunityId: 'opp' })
    const deliver = vi.fn().mockResolvedValue({ messageId: 'message' })
    const publications = new PublicationService(store, contexts, async () => ({
      title: sourceTitle, text: 'Stage 2; one milestone', sourceRecordIds: ['opp']
    }), deliver)
    const actions = new ReviewedActionService(store, {
      authorize: (principal, _operation, input) => publications.authorize(principal, input),
      execute: (principal, _operation, input) => publications.execute(principal, input)
    })
    const input = await publications.prepareInput(user, binding.id)
    const preview = await actions.prepare(user, 'publishSummary', input)
    expect(deliver).not.toHaveBeenCalled()
    const approval = { contractVersion: collaborationVersion, id: preview.id, digest: preview.digest, reason: 'Reviewed exact FTE disclosure' }
    sourceTitle = 'Changed after review'
    await expect(actions.commit(user, approval)).rejects.toThrow(/changed/i)
    sourceTitle = 'Authorized opportunity'
    const result = await actions.commit(user, approval)
    expect(result.state).toBe('confirmed')
    await actions.commit(user, approval)
    expect(deliver).toHaveBeenCalledTimes(1)
    const shared = result.result as { sharedId: string }
    expect(await publications.readShared({ ...user, userId: 'viewer', roles: ['TLC.Teams.User'] }, shared.sharedId)).toMatchObject({ title: sourceTitle })
    await expect(publications.readShared(user, shared.sharedId, { stage: true })).rejects.toThrow(/meeting audience/i)
    audienceEligible = false
    await expect(publications.readShared(user, shared.sharedId)).rejects.toThrow(/audience/i)
  })
})
