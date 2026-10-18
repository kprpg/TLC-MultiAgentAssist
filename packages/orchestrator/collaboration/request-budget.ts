import { z } from 'zod'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import { principalPartition, requireRole, type ExecutionPrincipal } from './principal.js'

export class RequestQuotaError extends Error {
  constructor() { super('The per-user request quota is exhausted. Retry after the current window.'); this.name = 'RequestQuotaError' }
}
const counterSchema = z.object({ window: z.number().int(), count: z.number().int().nonnegative() }).strict()
export class UserRequestBudget {
  constructor(private readonly store: ScopedDocumentStore, private readonly now = Date.now) {}
  async consume(principal: ExecutionPrincipal, category: string, limit: number): Promise<void> {
    requireRole(principal, 'TLC.Teams.User')
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !/^[a-z-]{1,30}$/.test(category)) throw new Error('The request quota configuration is invalid.')
    const partition = principalPartition(principal)
    const key = `quota:${category}`
    const window = Math.floor(this.now() / 60_000)
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await this.store.read(partition, key)
      const old = row ? counterSchema.parse(row.value) : { window, count: 0 }
      const count = old.window === window ? old.count : 0
      if (count >= limit) throw new RequestQuotaError()
      const value = { window, count: count + 1 }
      if (row ? await this.store.replace(partition, key, row.revision, value) : await this.store.insert(partition, key, value)) return
    }
    throw new RequestQuotaError()
  }
}
