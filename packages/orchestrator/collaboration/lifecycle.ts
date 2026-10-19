import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  collaborationVersion, collaborationLifecycleSchema, collaborationLifecycleCommandSchema,
  type CollaborationLifecycleStatus
} from '../../common/contracts/collaboration.js'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import { principalPartition, requireRole, type ExecutionPrincipal, type PrincipalIdentity } from './principal.js'

const storedSchema = z.object({
  state: z.enum(['active', 'paused', 'retired']),
  changedAt: z.iso.datetime()
}).strict()
const key = 'collaboration-admission'

export class CollaborationAdmissionError extends Error {
  constructor(readonly code: 'collaboration_paused' | 'collaboration_retired' | 'new_work_disabled' | 'collaboration_context_changed') {
    super(code.replaceAll('_', ' '))
    this.name = 'CollaborationAdmissionError'
  }
}

export class CollaborationLifecycle {
  constructor(private readonly store: ScopedDocumentStore, private readonly acceptNewWork = true) {}

  async readIdentity(identity: PrincipalIdentity): Promise<CollaborationLifecycleStatus> {
    const row = await this.store.read(principalPartition(identity), key)
    const state = row ? storedSchema.parse(row.value).state : 'active'
    return collaborationLifecycleSchema.parse({
      contractVersion: collaborationVersion, state, generation: row?.revision ?? 0,
      acceptingNewWork: this.acceptNewWork && state === 'active'
    })
  }
  async status(principal: ExecutionPrincipal): Promise<CollaborationLifecycleStatus> {
    requireRole(principal, 'TLC.Teams.User')
    return this.readIdentity(principal)
  }
  async assertReadable(principal: ExecutionPrincipal): Promise<void> {
    if ((await this.status(principal)).state === 'retired') throw new CollaborationAdmissionError('collaboration_retired')
  }
  async assertGeneration(principal: ExecutionPrincipal, generation: number): Promise<void> {
    const status = await this.status(principal)
    if (status.state === 'retired') throw new CollaborationAdmissionError('collaboration_retired')
    if (status.generation !== generation) throw new CollaborationAdmissionError('collaboration_context_changed')
  }
  async assertActive(principal: ExecutionPrincipal): Promise<CollaborationLifecycleStatus> {
    const status = await this.status(principal)
    if (status.state !== 'active') throw new CollaborationAdmissionError(status.state === 'paused' ? 'collaboration_paused' : 'collaboration_retired')
    if (!status.acceptingNewWork) throw new CollaborationAdmissionError('new_work_disabled')
    return status
  }
  async set(principal: ExecutionPrincipal, rawCommand: unknown): Promise<CollaborationLifecycleStatus> {
    requireRole(principal, 'TLC.Teams.User')
    const command = collaborationLifecycleCommandSchema.shape.command.parse(rawCommand)
    await this.change(principal, command === 'resume' ? 'active' : command === 'retire' ? 'retired' : 'paused')
    return this.status(principal)
  }
  async deactivate(identity: PrincipalIdentity): Promise<void> {
    await this.change(identity, 'retired')
  }
  private async change(identity: PrincipalIdentity, state: z.infer<typeof storedSchema>['state']): Promise<void> {
    const partition = principalPartition(identity)
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await this.store.read(partition, key)
      const previous = row ? storedSchema.parse(row.value).state : 'active'
      if (previous === state || previous === 'retired' && state === 'paused') return
      const changedAt = new Date().toISOString()
      const value = { state, changedAt }
      const changed = row ? await this.store.replace(partition, key, row.revision, value) : await this.store.insert(partition, key, value)
      if (!changed) continue
      if (!await this.store.insert(partition, `lifecycle-event:${changedAt}:${randomUUID()}`, {
        state, generation: (row?.revision ?? 0) + 1, occurredAt: changedAt
      })) throw new Error('The admission change was applied but its audit confirmation is unavailable.')
      return
    }
    throw new Error('Collaboration admission changed concurrently. Refresh its current status.')
  }
}
