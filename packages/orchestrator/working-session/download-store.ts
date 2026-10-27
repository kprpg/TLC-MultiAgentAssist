import { randomUUID } from 'node:crypto'

interface StoredDownload { owner: string; fileName: string; bytes: Uint8Array; expiresAt: number }

/** Short-lived, per-user holding area for a zip that a hosted app hands to the browser. Never persisted. */
export class DownloadStore {
  private readonly entries = new Map<string, StoredDownload>()
  constructor(private readonly ttlMs = 15 * 60_000, private readonly maximumPerOwner = 2, private readonly now: () => number = Date.now) {}

  put(owner: string, fileName: string, bytes: Uint8Array): { id: string; expiresAt: string } {
    this.prune()
    const mine = [...this.entries.entries()].filter(([, entry]) => entry.owner === owner).sort((left, right) => left[1].expiresAt - right[1].expiresAt)
    while (mine.length >= this.maximumPerOwner) this.entries.delete(mine.shift()![0])
    const id = randomUUID()
    const expiresAt = this.now() + this.ttlMs
    this.entries.set(id, { owner, fileName, bytes, expiresAt })
    return { id, expiresAt: new Date(expiresAt).toISOString() }
  }

  /** Only the user who created the download can read it. */
  get(owner: string, id: string): { fileName: string; bytes: Uint8Array } | undefined {
    this.prune()
    const entry = this.entries.get(id)
    return entry && entry.owner === owner ? { fileName: entry.fileName, bytes: entry.bytes } : undefined
  }

  private prune(): void {
    const now = this.now()
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id)
  }
}
