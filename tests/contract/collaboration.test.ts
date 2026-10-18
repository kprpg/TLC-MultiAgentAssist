import { describe, expect, it } from 'vitest'
import { actionApprovalSchema, actionPreviewSchema, collaborationVersion, contextBindingSchema, collaborationLifecycleCommandSchema, collaborationLifecycleSchema } from '../../packages/common/contracts/collaboration.js'

describe('versioned collaboration boundaries', () => {
  it('versions admission status and commands without accepting client-supplied authority or generations', () => {
    expect(collaborationLifecycleSchema.parse({
      contractVersion: collaborationVersion, state: 'paused', generation: 1, acceptingNewWork: false
    })).toMatchObject({ state: 'paused' })
    const command = { contractVersion: collaborationVersion, command: 'resume' }
    expect(collaborationLifecycleCommandSchema.parse(command)).toEqual(command)
    expect(() => collaborationLifecycleCommandSchema.parse({ ...command, userId: 'different-user' })).toThrow()
    expect(() => collaborationLifecycleCommandSchema.parse({ ...command, generation: 0 })).toThrow()
    expect(() => collaborationLifecycleCommandSchema.parse({ ...command, contractVersion: '2.0' })).toThrow()
  })
  it('uses its own explicit version and rejects unknown authority fields', () => {
    expect(collaborationVersion).toBe('1.0')
    const binding = { contractVersion: collaborationVersion, id: 'binding', kind: 'channel', accountId: 'account', contextId: 'context', revision: 1 }
    expect(contextBindingSchema.parse(binding)).toEqual(binding)
    expect(() => contextBindingSchema.parse({ ...binding, isOwner: true })).toThrow()
  })
  it('requires exact actor-independent server intent references, digest and review reason', () => {
    const preview = { contractVersion: collaborationVersion, id: 'intent', operation: 'updateOpportunity', digest: 'a'.repeat(64), expiresAt: '2026-10-17T23:59:00.000Z', input: { opportunityId: 'opp', update: { comments: 'Reviewed' } }, state: 'awaiting-approval' }
    expect(actionPreviewSchema.parse(preview).state).toBe('awaiting-approval')
    expect(() => actionPreviewSchema.parse({ ...preview, digest: 'no' })).toThrow()
    expect(actionApprovalSchema.parse({ contractVersion: collaborationVersion, id: 'intent', digest: 'a'.repeat(64), reason: 'Reviewed the evidence' })).toBeTruthy()
    expect(() => actionApprovalSchema.parse({ contractVersion: collaborationVersion, id: 'intent', digest: 'a'.repeat(64), reason: 'x', approvedBy: 'someone-else' })).toThrow()
  })
})
