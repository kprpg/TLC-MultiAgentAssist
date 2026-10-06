import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

/**
 * A single milestone-team membership for a user. The opportunity id is denormalized
 * alongside the milestone id so portfolio assembly can union milestone-team
 * opportunities without an extra per-milestone lookup.
 */
export const milestoneMembershipSchema = z.object({
  milestoneId: z.string().min(1),
  opportunityId: z.string().min(1)
}).strict()

export type MilestoneMembership = z.infer<typeof milestoneMembershipSchema>

const membershipFileSchema = z.record(z.string().min(1), z.array(milestoneMembershipSchema))

/**
 * Durable store of milestone-team memberships, keyed by the signed-in user. This is an
 * app-owned store (no MSX/Dataverse milestone-member relationship exists) and is the
 * authority for milestone-team membership and for the milestone-team half of the
 * portfolio union. Membership is unique per (user, milestone).
 */
export interface MilestoneMembershipStore {
  list(userKey: string): Promise<MilestoneMembership[]>
  /** Adds a membership. Returns `{ added: false }` when it already existed (idempotent). */
  add(userKey: string, membership: MilestoneMembership): Promise<{ added: boolean }>
  /** Removes the membership for a milestone. Returns `{ removed: false }` when absent (idempotent). */
  remove(userKey: string, milestoneId: string): Promise<{ removed: boolean }>
}

function dedupe(memberships: readonly MilestoneMembership[]): MilestoneMembership[] {
  const byMilestone = new Map<string, MilestoneMembership>()
  for (const membership of memberships) byMilestone.set(membership.milestoneId, membership)
  return [...byMilestone.values()].sort((left, right) => left.milestoneId.localeCompare(right.milestoneId))
}

export class MemoryMilestoneMembershipStore implements MilestoneMembershipStore {
  private readonly records = new Map<string, MilestoneMembership[]>()

  async list(userKey: string): Promise<MilestoneMembership[]> {
    return structuredClone(this.records.get(userKey) ?? [])
  }

  async add(userKey: string, membership: MilestoneMembership): Promise<{ added: boolean }> {
    const parsed = milestoneMembershipSchema.parse(membership)
    const current = this.records.get(userKey) ?? []
    if (current.some((entry) => entry.milestoneId === parsed.milestoneId)) return { added: false }
    this.records.set(userKey, dedupe([...current, parsed]))
    return { added: true }
  }

  async remove(userKey: string, milestoneId: string): Promise<{ removed: boolean }> {
    const current = this.records.get(userKey) ?? []
    const next = current.filter((entry) => entry.milestoneId !== milestoneId)
    this.records.set(userKey, next)
    return { removed: next.length !== current.length }
  }
}

/**
 * JSON-file-backed store with a serialized mutation queue and atomic writes, mirroring
 * {@link JsonFilePortfolioPreferenceStore}. Injected values survive restarts.
 */
export class JsonFileMilestoneMembershipStore implements MilestoneMembershipStore {
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  list(userKey: string): Promise<MilestoneMembership[]> {
    return this.withQueue(async () => {
      const records = await this.readRecords()
      return structuredClone(records[userKey] ?? [])
    })
  }

  add(userKey: string, membership: MilestoneMembership): Promise<{ added: boolean }> {
    const parsed = milestoneMembershipSchema.parse(membership)
    return this.mutate(userKey, (current): { next: MilestoneMembership[]; result: { added: boolean } } => {
      if (current.some((entry) => entry.milestoneId === parsed.milestoneId)) {
        return { next: current, result: { added: false } }
      }
      return { next: dedupe([...current, parsed]), result: { added: true } }
    })
  }

  remove(userKey: string, milestoneId: string): Promise<{ removed: boolean }> {
    return this.mutate(userKey, (current): { next: MilestoneMembership[]; result: { removed: boolean } } => {
      const next = current.filter((entry) => entry.milestoneId !== milestoneId)
      return { next, result: { removed: next.length !== current.length } }
    })
  }

  private withQueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private mutate<T>(
    userKey: string,
    update: (current: MilestoneMembership[]) => { next: MilestoneMembership[]; result: T }
  ): Promise<T> {
    return this.withQueue(async () => {
      const records = await this.readRecords()
      const { next, result } = update(records[userKey] ?? [])
      records[userKey] = next
      await this.writeRecords(records)
      return result
    })
  }

  private async readRecords(): Promise<Record<string, MilestoneMembership[]>> {
    let content: string
    try {
      content = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
    return membershipFileSchema.parse(JSON.parse(content))
  }

  private async writeRecords(records: Record<string, MilestoneMembership[]>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.filePath)
  }
}
