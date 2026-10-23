import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  actionApprovalSchema, actionPreviewSchema, actionReceiptSchema, collaborationVersion,
  type ActionPreview, type ActionReceipt
} from '../../common/contracts/collaboration.js'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import { principalPartition, requireRole, type ExecutionPrincipal } from './principal.js'

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  const json = JSON.stringify(value)
  if (json === undefined) throw new Error('A reviewed value is not serializable.')
  return json
}

const recordSchema = z.object({
  preview: actionPreviewSchema,
  before: z.unknown(),
  claimed: z.boolean(),
  claimedAt: z.iso.datetime().optional(),
  approval: actionApprovalSchema.optional(),
  receipt: actionReceiptSchema.optional()
}).strict()

interface ActionOptions {
  authorize(principal: ExecutionPrincipal, operation: string, input: Record<string, unknown>): Promise<unknown>
  execute(principal: ExecutionPrincipal, operation: string, input: Record<string, unknown>, before: unknown): Promise<unknown>
  now?: () => number
}

export class ActionReviewStaleError extends Error {
  constructor() { super('Source state or policy changed. Refresh the preview.'); this.name = 'ActionReviewStaleError' }
}
export class ActionDispatchPreventedError extends Error {
  constructor() { super('Dispatch was prevented before any external effect.'); this.name = 'ActionDispatchPreventedError' }
}

export class ReviewedActionService {
  private readonly now: () => number
  constructor(private readonly store: ScopedDocumentStore, private readonly options: ActionOptions) {
    this.now = options.now ?? Date.now
  }
  private checkRole(principal: ExecutionPrincipal, operation: string): void {
    requireRole(principal, ['addAccount', 'setAccountVisibility'].includes(operation)
      ? 'TLC.Teams.User' : ['publishSummary', 'publishSeReporting'].includes(operation) ? 'TLC.Teams.Publisher' : 'TLC.Teams.Writer')
  }
  async prepare(principal: ExecutionPrincipal, operation: string, input: Record<string, unknown>): Promise<ActionPreview> {
    this.checkRole(principal, operation)
    const before = await this.options.authorize(principal, operation, input)
    const id = randomUUID()
    const expiresAt = new Date(this.now() + 300_000).toISOString()
    const digest = createHash('sha256').update(canonicalJson({ partition: principalPartition(principal), id, operation, input, before, expiresAt })).digest('hex')
    const preview = actionPreviewSchema.parse({ contractVersion: collaborationVersion, id, operation, input, before, digest, expiresAt, state: 'awaiting-approval' })
    if (!await this.store.insert(principalPartition(principal), `action:${id}`, { preview, before, claimed: false })) {
      throw new Error('The reviewed action could not be persisted.')
    }
    return preview
  }
  async commit(principal: ExecutionPrincipal, rawApproval: unknown): Promise<ActionReceipt> {
    const approval = actionApprovalSchema.parse(rawApproval)
    const partition = principalPartition(principal)
    const key = `action:${approval.id}`
    const stored = await this.store.read(partition, key)
    if (!stored) throw new Error('The reviewed action is unavailable for this user.')
    const record = recordSchema.parse(stored.value)
    const { preview } = record
    this.checkRole(principal, preview.operation)
    if (approval.digest !== preview.digest) throw new Error('The review digest changed. Refresh the preview.')
    if (record.receipt) {
      await this.options.authorize(principal, preview.operation, preview.input)
      return record.receipt
    }
    if (record.claimed) throw new Error('The action outcome is unconfirmed; do not repeat it.')
    if (Date.parse(preview.expiresAt) <= this.now()) throw new Error('The review expired. Refresh the preview.')
    const current = await this.options.authorize(principal, preview.operation, preview.input)
    if (canonicalJson(current) !== canonicalJson(record.before)) throw new ActionReviewStaleError()
    const claimed = { ...record, claimed: true, claimedAt: new Date(this.now()).toISOString(), approval }
    if (!await this.store.replace(partition, key, stored.revision, claimed)) {
      throw new Error('Another request claimed this action. Check Activity instead of repeating it.')
    }
    let receipt: ActionReceipt
    try {
      const result = await this.options.execute(principal, preview.operation, preview.input, record.before)
      const uncertainRollback = result !== null && typeof result === 'object' && 'state' in result && result.state === 'rolled-back'
      receipt = actionReceiptSchema.parse({
        contractVersion: collaborationVersion, id: preview.id, operation: preview.operation,
        state: uncertainRollback ? 'effect-unknown' : 'confirmed', occurredAt: new Date(this.now()).toISOString(),
        ...(uncertainRollback ? {} : { result })
      })
    } catch (error) {
      receipt = actionReceiptSchema.parse({
        contractVersion: collaborationVersion, id: preview.id, operation: preview.operation,
        state: error instanceof ActionDispatchPreventedError ? 'failed-before-send' : 'effect-unknown', occurredAt: new Date(this.now()).toISOString()
      })
    }
    if (!await this.store.replace(partition, key, stored.revision + 1, { ...claimed, receipt })) {
      throw new Error('The action receipt is unconfirmed. Do not repeat the operation.')
    }
    return receipt
  }
  async list(principal: ExecutionPrincipal): Promise<Array<ActionPreview | ActionReceipt>> {
    const rows = await this.store.list(principalPartition(principal), 'action:', 100)
    return rows.map((row) => {
      const record = recordSchema.parse(row.value)
      if (record.receipt) return record.receipt
      if (record.claimed) return actionReceiptSchema.parse({
        contractVersion: collaborationVersion, id: record.preview.id, operation: record.preview.operation,
        state: 'effect-unknown', occurredAt: record.claimedAt ?? record.preview.expiresAt
      })
      return record.preview
    })
  }
}
