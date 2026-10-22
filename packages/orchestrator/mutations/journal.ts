import { z } from 'zod'
import {
  defaultCachePolicy, mutationReceiptSchema, mutationReviewSchema, type MutationFailureCode, type MutationReceipt, type MutationReview
} from '../../common/contracts/cache-sync.js'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'

const recordSchema = z.object({
  review: mutationReviewSchema.omit({ before: true }),
  beforeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  revisionTokens: z.record(z.string(), z.string()),
  claimed: z.boolean(),
  approval: z.object({ reason: z.string().trim().min(3).max(1000), confirmedAt: z.string().datetime() }).strict().optional(),
  receipt: mutationReceiptSchema.optional()
}).strict()
export type MutationJournalRecord = z.infer<typeof recordSchema>
const activeSchema = z.array(z.object({ id: z.string().uuid(), recordKeys: z.array(z.string()) }).strict()).max(100)
const expirySchema = z.array(z.string().uuid()).max(200)
const daysSchema = z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400)

export class MutationJournalError extends Error {
  constructor(readonly code: 'capacity' | 'review-expired' | 'review-changed' | 'storage-unavailable', message: string) {
    super(message); this.name = 'MutationJournalError'
  }
}

export class MutationJournal {
  constructor(readonly store: ScopedDocumentStore, private readonly now = Date.now) {}

  async prepare(partition: string, review: MutationReview, beforeDigest: string, revisionTokens: Record<string, string>): Promise<void> {
    const { before: _before, ...safeReview } = review
    void _before
    const record = recordSchema.parse({ review: safeReview, beforeDigest, revisionTokens, claimed: false })
    await this.indexExpiry(partition, review.id, review.expiresAt)
    if (Date.parse(review.expiresAt) <= this.now()) throw new MutationJournalError('review-expired', 'The source review expired before it could be persisted.')
    if (!await this.store.insert(partition, `mutation:${review.id}`, record)) throw new MutationJournalError('review-changed', 'The mutation review already exists.')
  }

  async read(partition: string, id: string): Promise<{ record: MutationJournalRecord; revision: number }> {
    const row = await this.store.read(partition, `mutation:${id}`)
    if (!row) throw new MutationJournalError('review-expired', 'The mutation review is unavailable or expired.')
    return { record: recordSchema.parse(row.value), revision: row.revision }
  }

  async claim(partition: string, id: string, digest: string, reason = 'Confirmed exact reviewed source intent'): Promise<{ claimed: boolean; receipt: MutationReceipt }> {
    const { record, revision } = await this.read(partition, id)
    if (record.review.digest !== digest) throw new MutationJournalError('review-changed', 'The exact reviewed change is required.')
    if (record.receipt) return { claimed: false, receipt: record.receipt }
    if (Date.parse(record.review.expiresAt) <= this.now()) throw new MutationJournalError('review-expired', 'The review expired. Prepare a fresh review.')
    await this.reserve(partition, id, record.review.recordKeys)
    const time = new Date(this.now()).toISOString()
    const expired = Date.parse(record.review.expiresAt) <= this.now()
    const receipt = mutationReceiptSchema.parse({
      contractVersion: '1.0', id, operation: record.review.operation, state: expired ? 'failed-before-send' : 'accepted',
      ...(expired ? { code: 'review-expired' } : {}),
      acceptedAt: time, updatedAt: time, recordKeys: record.review.recordKeys
    })
    if (!await this.store.replace(partition, `mutation:${id}`, revision, recordSchema.parse({
      ...record, claimed: true, receipt, approval: { reason, confirmedAt: time }
    }))) {
      const row = await this.store.read(partition, `mutation:${id}`)
      if (!row) {
        await this.release(partition, id)
        throw new MutationJournalError('review-expired', 'The review expired while it was being admitted.')
      }
      const current = { record: recordSchema.parse(row.value) }
      if (!current.record.receipt) throw new MutationJournalError('review-changed', 'Another request changed this review.')
      return { claimed: false, receipt: current.record.receipt }
    }
    if (expired) await this.release(partition, id)
    return { claimed: !expired, receipt }
  }

  async transition(partition: string, id: string, update: Pick<MutationReceipt, 'state'> & Partial<Pick<MutationReceipt, 'code'>>): Promise<MutationReceipt> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { record, revision } = await this.read(partition, id)
      if (!record.receipt) throw new MutationJournalError('review-changed', 'The mutation was not admitted.')
      if (['confirmed', 'reconciled-current-state'].includes(record.receipt.state)) return record.receipt
      const receipt = mutationReceiptSchema.parse({ ...record.receipt, ...update, updatedAt: new Date(this.now()).toISOString() })
      if (!await this.store.replace(partition, `mutation:${id}`, revision, { ...record, receipt })) continue
      if (!['accepted', 'dispatching', 'effect-unknown'].includes(receipt.state)) await this.release(partition, id)
      return receipt
    }
    throw new MutationJournalError('storage-unavailable', 'The durable mutation receipt could not be updated.')
  }

  async failBeforeSend(partition: string, id: string, code: MutationFailureCode): Promise<MutationReceipt> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { record, revision } = await this.read(partition, id)
      if (record.receipt) return record.receipt
      const time = new Date(this.now()).toISOString()
      const receipt = mutationReceiptSchema.parse({ contractVersion: '1.0', id, operation: record.review.operation,
        state: 'failed-before-send', code, acceptedAt: time, updatedAt: time, recordKeys: record.review.recordKeys })
      if (!await this.store.replace(partition, `mutation:${id}`, revision, { ...record, claimed: true, receipt })) continue
      await this.release(partition, id)
      return receipt
    }
    throw new MutationJournalError('storage-unavailable', 'The source admission outcome could not be recorded.')
  }

  async pending(partition: string): Promise<MutationReceipt[]> {
    const row = await this.store.read(partition, 'mutation:active')
    const active = activeSchema.parse(row?.value ?? [])
    const receipts: MutationReceipt[] = []
    for (const entry of active) {
      const row = await this.store.read(partition, `mutation:${entry.id}`)
      if (!row) { await this.release(partition, entry.id); continue }
      const record = recordSchema.parse(row.value)
      if (record.receipt && ['accepted', 'dispatching', 'effect-unknown'].includes(record.receipt.state)) receipts.push(record.receipt)
      else if (!record.receipt) {
        const at = new Date(this.now()).toISOString()
        receipts.push({ contractVersion: '1.0', id: entry.id, operation: record.review.operation,
          state: 'effect-unknown', acceptedAt: at, updatedAt: at, recordKeys: entry.recordKeys, code: 'outcome-unconfirmed' })
      } else await this.release(partition, entry.id)
    }
    return receipts
  }

  async prune(partition: string): Promise<void> {
    if (!this.store.delete) throw new MutationJournalError('storage-unavailable', 'The journal cannot enforce conditional retention.')
    const manifest = await this.store.read(partition, 'mutation:expiry-days')
    const days = daysSchema.parse(manifest?.value ?? [])
    const today = new Date(this.now()).toISOString().slice(0, 10)
    for (const day of days.filter((value) => value <= today)) {
      const count = await this.store.read(partition, `mutation:expiry-count:${day}`)
      const pages = z.number().int().min(0).parse(count?.value ?? 0)
      for (let page = 0; page < pages; page++) {
        const key = `mutation:expiry:${day}:${page}`
        const bucket = await this.store.read(partition, key)
        if (!bucket) continue
        const ids = expirySchema.parse(bucket.value)
        const retained: string[] = []
        for (const id of ids) {
          const row = await this.store.read(partition, `mutation:${id}`)
          if (!row) { if (day >= today) retained.push(id); continue }
          const { review, receipt, claimed } = recordSchema.parse(row.value)
          const expired = !claimed && Date.parse(review.expiresAt) <= this.now()
            || receipt !== undefined && ['confirmed', 'reconciled-current-state', 'failed-before-send', 'conflict'].includes(receipt.state)
              && Date.parse(receipt.updatedAt) + defaultCachePolicy.confirmedRetentionMs <= this.now()
          if (!expired || !await this.store.delete(partition, `mutation:${id}`, row.revision)) retained.push(id)
          else await this.release(partition, id)
        }
        await this.store.replace(partition, key, bucket.revision, retained)
      }
    }
    const emptyDays: string[] = []
    for (const day of days.filter((value) => value < today)) {
      const countKey = `mutation:expiry-count:${day}`
      const count = await this.store.read(partition, countKey)
      const pages = z.number().int().nonnegative().parse(count?.value ?? 0)
      let empty = true
      for (let page = 0; page < pages; page++) {
        const key = `mutation:expiry:${day}:${page}`
        const bucket = await this.store.read(partition, key)
        if (bucket && (expirySchema.parse(bucket.value).length || !await this.store.delete(partition, key, bucket.revision))) empty = false
      }
      if (empty && (!count || await this.store.delete(partition, countKey, count.revision))) emptyDays.push(day)
    }
    if (manifest && emptyDays.length) {
      await this.store.replace(partition, 'mutation:expiry-days', manifest.revision, days.filter((day) => !emptyDays.includes(day)))
    }
  }

  private async reserve(partition: string, id: string, recordKeys: string[]): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const row = await this.store.read(partition, 'mutation:active')
      const active = activeSchema.parse(row?.value ?? [])
      if (active.some((entry) => entry.id === id)) return
      if (active.some((entry) => entry.recordKeys.some((key) => recordKeys.includes(key)))) {
        throw new MutationJournalError('capacity', 'This record has pending work. Resolve it before another write.')
      }
      if (active.length >= 100) throw new MutationJournalError('capacity', 'The unresolved operation limit has been reached.')
      let running = 0
      for (const entry of active) {
        const current = await this.store.read(partition, `mutation:${entry.id}`)
        if (!current) { await this.release(partition, entry.id); continue }
        const receipt = recordSchema.parse(current.value).receipt
        if (!receipt || ['accepted', 'dispatching'].includes(receipt.state)) running++
      }
      if (running >= defaultCachePolicy.maxConcurrentWrites) throw new MutationJournalError('capacity', 'Two independent writes are already in progress.')
      const value = [...active, { id, recordKeys }]
      if (row ? await this.store.replace(partition, 'mutation:active', row.revision, value)
        : await this.store.insert(partition, 'mutation:active', value)) return
    }
    throw new MutationJournalError('capacity', 'Another write is being admitted. Try again after it completes.')
  }

  private async release(partition: string, id: string): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const row = await this.store.read(partition, 'mutation:active')
      if (!row) return
      const active = activeSchema.parse(row.value)
      if (await this.store.replace(partition, 'mutation:active', row.revision, active.filter((entry) => entry.id !== id))) return
    }
    throw new MutationJournalError('storage-unavailable', 'The completed mutation index could not be updated.')
  }

  private async indexExpiry(partition: string, id: string, expiresAt: string): Promise<void> {
    const day = expiresAt.slice(0, 10)
    for (let attempt = 0; attempt < 12; attempt++) {
      const manifest = await this.store.read(partition, 'mutation:expiry-days')
      const days = daysSchema.parse(manifest?.value ?? [])
      const updated = daysSchema.parse([...new Set([...days, day])].sort())
      if (manifest ? await this.store.replace(partition, 'mutation:expiry-days', manifest.revision, updated)
        : await this.store.insert(partition, 'mutation:expiry-days', updated)) break
      if (attempt === 11) throw new MutationJournalError('storage-unavailable', 'Receipt retention could not be indexed.')
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const countKey = `mutation:expiry-count:${day}`
      const count = await this.store.read(partition, countKey)
      const pages = z.number().int().nonnegative().parse(count?.value ?? 0)
      const page = Math.max(0, pages - 1)
      const key = `mutation:expiry:${day}:${page}`
      const bucket = await this.store.read(partition, key)
      const ids = expirySchema.parse(bucket?.value ?? [])
      if (ids.includes(id)) return
      if (ids.length < 200) {
        if (!count) {
          if (!await this.store.insert(partition, countKey, 1)) continue
        }
        if (bucket ? await this.store.replace(partition, key, bucket.revision, [...ids, id])
          : await this.store.insert(partition, key, [id])) {
          await this.publishExpiry(partition, day, page + 1)
          return
        }
      } else if (count) {
        await this.store.replace(partition, countKey, count.revision, pages + 1)
      }
    }
    throw new MutationJournalError('storage-unavailable', 'Receipt retention capacity could not be reserved.')
  }

  private async publishExpiry(partition: string, day: string, minimumPages: number): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const key = `mutation:expiry-count:${day}`
      const row = await this.store.read(partition, key)
      const pages = Math.max(z.number().int().nonnegative().parse(row?.value ?? 0), minimumPages)
      if (row ? await this.store.replace(partition, key, row.revision, pages) : await this.store.insert(partition, key, pages)) {
        for (let publish = 0; publish < 12; publish++) {
          const manifest = await this.store.read(partition, 'mutation:expiry-days')
          const days = daysSchema.parse(manifest?.value ?? [])
          const updated = daysSchema.parse([...new Set([...days, day])].sort())
          if (manifest ? await this.store.replace(partition, 'mutation:expiry-days', manifest.revision, updated)
            : await this.store.insert(partition, 'mutation:expiry-days', updated)) return
        }
        break
      }
    }
    throw new MutationJournalError('storage-unavailable', 'Receipt retention could not be published.')
  }
}
