import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { collaborationVersion, contextBindingSchema, type ContextBinding } from '../../common/contracts/collaboration.js'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import { requireRole, type ExecutionPrincipal } from './principal.js'

export interface ContextAuthority {
  verify(principal: ExecutionPrincipal, context: { kind: ContextBinding['kind']; contextId: string }): Promise<{
    revision: string; canConfigure: boolean; canPublish: boolean; audienceEligible: boolean
  }>
}
const bindInput = z.object({
  kind: z.enum(['channel', 'chat', 'meeting']),
  contextId: z.string().min(1).max(500),
  accountId: z.string().min(1).max(200),
  opportunityId: z.string().min(1).max(200).optional()
}).strict()

export class CollaborationService {
  constructor(
    private readonly store: ScopedDocumentStore,
    private readonly authority: ContextAuthority,
    private readonly readAccount: (principal: ExecutionPrincipal, accountId: string, opportunityId?: string) => Promise<void>
  ) {}
  private partition(principal: ExecutionPrincipal): string {
    return `${principal.tenantId}:${principal.environmentId}:bindings`
  }
  async bind(principal: ExecutionPrincipal, raw: unknown): Promise<ContextBinding> {
    requireRole(principal, 'TLC.Teams.ContextAdmin')
    const input = bindInput.parse(raw)
    const access = await this.authority.verify(principal, input)
    if (!access.canConfigure) throw new Error('Configuring this context is not authorized.')
    await this.readAccount(principal, input.accountId, input.opportunityId)
    const binding = contextBindingSchema.parse({ contractVersion: collaborationVersion, id: randomUUID(), ...input, revision: 1 })
    if (!await this.store.insert(this.partition(principal), `binding:${binding.id}`, binding)) {
      throw new Error('The context binding could not be saved.')
    }
    return binding
  }
  private async load(principal: ExecutionPrincipal, id: string): Promise<ContextBinding> {
    const row = await this.store.read(this.partition(principal), `binding:${id}`)
    if (!row) throw new Error('The context binding is unavailable.')
    return contextBindingSchema.parse(row.value)
  }
  async get(principal: ExecutionPrincipal, id: string): Promise<ContextBinding> {
    requireRole(principal, 'TLC.Teams.User')
    const binding = await this.load(principal, id)
    await this.authority.verify(principal, binding)
    await this.readAccount(principal, binding.accountId, binding.opportunityId)
    return binding
  }
  async admitPublication(principal: ExecutionPrincipal, id: string) {
    requireRole(principal, 'TLC.Teams.Publisher')
    const binding = await this.load(principal, id)
    const access = await this.authority.verify(principal, binding)
    if (!access.canPublish) throw new Error('Publishing to this context is not authorized.')
    if (!access.audienceEligible) throw new Error('The shared audience is not approved for internal business information.')
    await this.readAccount(principal, binding.accountId, binding.opportunityId)
    return { binding, policyRevision: access.revision }
  }
  async admitSharedView(principal: ExecutionPrincipal, id: string) {
    requireRole(principal, 'TLC.Teams.User')
    const binding = await this.load(principal, id)
    const access = await this.authority.verify(principal, binding)
    if (!access.audienceEligible) throw new Error('The shared audience is no longer approved.')
    return { binding, policyRevision: access.revision }
  }
}
