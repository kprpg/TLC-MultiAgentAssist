import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ContextBinding } from '../../common/contracts/collaboration.js'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import type { CollaborationService } from './contexts.js'
import type { ExecutionPrincipal } from './principal.js'
import { canonicalJson } from './reviewed-actions.js'

export const sharedProjectionSchema = z.object({
  title: z.string().min(1).max(200),
  text: z.string().min(1).max(4000),
  sourceRecordIds: z.array(z.string().min(1)).min(1).max(100)
}).strict()
export type SharedProjection = z.infer<typeof sharedProjectionSchema>
const inputSchema = z.object({
  bindingId: z.string().min(1), sharedId: z.uuid(),
  policyRevision: z.string().min(1), bindingRevision: z.number().int().positive(),
  checkedAt: z.iso.datetime(), projection: sharedProjectionSchema
}).strict()

export class PublicationService {
  constructor(
    private readonly store: ScopedDocumentStore,
    private readonly contexts: CollaborationService,
    private readonly readProjection: (principal: ExecutionPrincipal, binding: ContextBinding) => Promise<SharedProjection>,
    private readonly deliver: (principal: ExecutionPrincipal, binding: ContextBinding, projection: SharedProjection) => Promise<unknown>
  ) {}
  private partition(principal: ExecutionPrincipal) { return `${principal.tenantId}:${principal.environmentId}:shared` }
  async prepareInput(principal: ExecutionPrincipal, bindingId: string): Promise<Record<string, unknown>> {
    const admission = await this.contexts.admitPublication(principal, bindingId)
    const projection = sharedProjectionSchema.parse(await this.readProjection(principal, admission.binding))
    return inputSchema.parse({
      bindingId, sharedId: randomUUID(), policyRevision: admission.policyRevision, bindingRevision: admission.binding.revision,
      checkedAt: new Date().toISOString(), projection
    })
  }
  async authorize(principal: ExecutionPrincipal, raw: unknown) {
    const input = inputSchema.parse(raw)
    const admission = await this.contexts.admitPublication(principal, input.bindingId)
    if (admission.policyRevision !== input.policyRevision || admission.binding.revision !== input.bindingRevision) {
      throw new Error('The disclosure policy or binding changed. Refresh the shared preview.')
    }
    const current = sharedProjectionSchema.parse(await this.readProjection(principal, admission.binding))
    if (canonicalJson(current) !== canonicalJson(input.projection)) throw new Error('The source summary changed. Refresh the shared preview.')
    return { policyRevision: admission.policyRevision, binding: admission.binding, projection: current }
  }
  async execute(principal: ExecutionPrincipal, raw: unknown) {
    const input = inputSchema.parse(raw)
    const admission = await this.authorize(principal, input)
    const artifact = { bindingId: input.bindingId, projection: input.projection, checkedAt: input.checkedAt, policyRevision: input.policyRevision }
    if (!await this.store.insert(this.partition(principal), `shared:${input.sharedId}`, artifact)) {
      throw new Error('The shared artifact already exists. Do not repeat publication.')
    }
    const delivery = await this.deliver(principal, admission.binding, input.projection)
    return { sharedId: input.sharedId, delivery }
  }
  async readShared(principal: ExecutionPrincipal, sharedId: string, options: { stage?: boolean } = {}) {
    const row = await this.store.read(this.partition(principal), `shared:${sharedId}`)
    if (!row) throw new Error('The approved shared artifact is unavailable.')
    const artifact = z.object({
      bindingId: z.string(), projection: sharedProjectionSchema, checkedAt: z.iso.datetime(), policyRevision: z.string()
    }).strict().parse(row.value)
    const admission = await this.contexts.admitSharedView(principal, artifact.bindingId)
    if (options.stage && admission.binding.kind !== 'meeting') throw new Error('A channel audience does not authorize the current meeting audience.')
    if (admission.policyRevision !== artifact.policyRevision) throw new Error('The shared disclosure policy changed.')
    return { ...artifact.projection, checkedAt: artifact.checkedAt }
  }
}
