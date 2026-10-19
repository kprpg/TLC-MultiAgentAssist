import { z } from 'zod'
import type { AccountVisibility } from '../../common/contracts/portfolio.js'
import type { PortfolioPreferences, PortfolioPreferenceStore } from './portfolio-preferences.js'
import type { ScopedDocumentStore } from './scoped-document-store.js'

const schema = z.object({
  manualAccountIds: z.array(z.string().min(1)), hiddenAccountIds: z.array(z.string().min(1)),
  revision: z.number().int().nonnegative()
}).strict()
const empty = (): PortfolioPreferences => ({ manualAccountIds: [], hiddenAccountIds: [], revision: 0 })

export class ScopedPortfolioPreferenceStore implements PortfolioPreferenceStore {
  constructor(private readonly store: ScopedDocumentStore, private readonly partition: string) {}
  async read(userKey: string): Promise<PortfolioPreferences> {
    const row = await this.store.read(this.partition, `portfolio:${userKey}`)
    return row ? schema.parse(row.value) : empty()
  }
  async addAccount(userKey: string, accountId: string): Promise<PortfolioPreferences> {
    return this.update(userKey, (value) => ({ ...value, manualAccountIds: [...new Set([...value.manualAccountIds, accountId])].sort() }))
  }
  async setVisibility(userKey: string, accountId: string, visibility: AccountVisibility): Promise<PortfolioPreferences> {
    return this.update(userKey, (value) => ({
      ...value, hiddenAccountIds: visibility === 'hidden'
        ? [...new Set([...value.hiddenAccountIds, accountId])].sort() : value.hiddenAccountIds.filter((id) => id !== accountId)
    }))
  }
  private async update(userKey: string, change: (current: PortfolioPreferences) => PortfolioPreferences): Promise<PortfolioPreferences> {
    const key = `portfolio:${userKey}`
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await this.store.read(this.partition, key)
      const current = row ? schema.parse(row.value) : empty()
      const value = change(current)
      value.revision = current.revision + 1
      if (row ? await this.store.replace(this.partition, key, row.revision, value) : await this.store.insert(this.partition, key, value)) return value
    }
    throw new Error('Portfolio preferences changed concurrently. Refresh before retrying.')
  }
}
