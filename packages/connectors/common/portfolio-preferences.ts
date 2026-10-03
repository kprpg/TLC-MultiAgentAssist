import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { AccountVisibility } from '../../common/index.js'

const preferencesSchema = z.object({
  manualAccountIds: z.array(z.string().min(1)),
  hiddenAccountIds: z.array(z.string().min(1)),
  revision: z.number().int().nonnegative()
}).strict()

const preferencesFileSchema = z.record(z.string().min(1), preferencesSchema)

export type PortfolioPreferences = z.infer<typeof preferencesSchema>

export interface PortfolioPreferenceStore {
  read(userKey: string): Promise<PortfolioPreferences>
  addAccount(userKey: string, accountId: string): Promise<PortfolioPreferences>
  setVisibility(userKey: string, accountId: string, visibility: AccountVisibility): Promise<PortfolioPreferences>
}

function emptyPreferences(): PortfolioPreferences {
  return { manualAccountIds: [], hiddenAccountIds: [], revision: 0 }
}

function updatedPreferences(
  current: PortfolioPreferences,
  manualAccountIds: ReadonlySet<string>,
  hiddenAccountIds: ReadonlySet<string>
): PortfolioPreferences {
  const nextManual = [...manualAccountIds].sort()
  const nextHidden = [...hiddenAccountIds].sort()
  const changed = nextManual.join('\0') !== current.manualAccountIds.join('\0')
    || nextHidden.join('\0') !== current.hiddenAccountIds.join('\0')
  return {
    manualAccountIds: nextManual,
    hiddenAccountIds: nextHidden,
    revision: changed ? current.revision + 1 : current.revision
  }
}

export class MemoryPortfolioPreferenceStore implements PortfolioPreferenceStore {
  private readonly records = new Map<string, PortfolioPreferences>()

  async read(userKey: string): Promise<PortfolioPreferences> {
    return structuredClone(this.records.get(userKey) ?? emptyPreferences())
  }

  async addAccount(userKey: string, accountId: string): Promise<PortfolioPreferences> {
    const current = await this.read(userKey)
    const manual = new Set(current.manualAccountIds)
    manual.add(accountId)
    const next = updatedPreferences(current, manual, new Set(current.hiddenAccountIds))
    this.records.set(userKey, next)
    return structuredClone(next)
  }

  async setVisibility(userKey: string, accountId: string, visibility: AccountVisibility): Promise<PortfolioPreferences> {
    const current = await this.read(userKey)
    const hidden = new Set(current.hiddenAccountIds)
    if (visibility === 'hidden') hidden.add(accountId)
    else hidden.delete(accountId)
    const next = updatedPreferences(current, new Set(current.manualAccountIds), hidden)
    this.records.set(userKey, next)
    return structuredClone(next)
  }
}

export class JsonFilePortfolioPreferenceStore implements PortfolioPreferenceStore {
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  read(userKey: string): Promise<PortfolioPreferences> {
    return this.withQueue(async () => {
      const records = await this.readRecords()
      return structuredClone(records[userKey] ?? emptyPreferences())
    })
  }

  addAccount(userKey: string, accountId: string): Promise<PortfolioPreferences> {
    return this.mutate(userKey, (current) => {
      const manual = new Set(current.manualAccountIds)
      manual.add(accountId)
      return updatedPreferences(current, manual, new Set(current.hiddenAccountIds))
    })
  }

  setVisibility(userKey: string, accountId: string, visibility: AccountVisibility): Promise<PortfolioPreferences> {
    return this.mutate(userKey, (current) => {
      const hidden = new Set(current.hiddenAccountIds)
      if (visibility === 'hidden') hidden.add(accountId)
      else hidden.delete(accountId)
      return updatedPreferences(current, new Set(current.manualAccountIds), hidden)
    })
  }

  private withQueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private mutate(
    userKey: string,
    update: (current: PortfolioPreferences) => PortfolioPreferences
  ): Promise<PortfolioPreferences> {
    return this.withQueue(async () => {
      const records = await this.readRecords()
      const next = update(records[userKey] ?? emptyPreferences())
      records[userKey] = next
      await this.writeRecords(records)
      return structuredClone(next)
    })
  }

  private async readRecords(): Promise<Record<string, PortfolioPreferences>> {
    let content: string
    try {
      content = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
    return preferencesFileSchema.parse(JSON.parse(content))
  }

  private async writeRecords(records: Record<string, PortfolioPreferences>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.filePath)
  }
}
