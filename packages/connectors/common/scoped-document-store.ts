import { createRequire } from 'node:module'

export interface ScopedDocument {
  revision: number
  value: unknown
}
export interface ScopedDocumentStore {
  read(partition: string, key: string): Promise<ScopedDocument | undefined>
  insert(partition: string, key: string, value: unknown): Promise<boolean>
  replace(partition: string, key: string, expectedRevision: number, value: unknown): Promise<boolean>
  list(partition: string, prefix: string, limit: number): Promise<Array<{ key: string } & ScopedDocument>>
  delete?(partition: string, key: string, expectedRevision: number): Promise<boolean>
}

export function serializeDocument(value: unknown, maxDocumentBytes = 48_000): string {
  const json = JSON.stringify(value)
  if (!json || Buffer.byteLength(json, 'utf8') > maxDocumentBytes) throw new Error('The private state document exceeds its supported size.')
  return json
}

const requireModule = createRequire(import.meta.url)

export class SqliteDocumentStore implements ScopedDocumentStore {
  private readonly db: InstanceType<typeof import('node:sqlite').DatabaseSync>
  private readonly maxDocumentBytes: number
  constructor(path = ':memory:', options: { maxDocumentBytes?: number } = {}) {
    this.maxDocumentBytes = options.maxDocumentBytes ?? 48_000
    if (!Number.isInteger(this.maxDocumentBytes) || this.maxDocumentBytes < 1 || this.maxDocumentBytes > 72_000) throw new Error('The SQLite document storage limit is invalid.')
    const { DatabaseSync } = requireModule('node:sqlite') as typeof import('node:sqlite')
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS scoped_documents (partition TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(partition,key));')
  }
  async read(partition: string, key: string): Promise<ScopedDocument | undefined> {
    const row = this.db.prepare('SELECT revision,json FROM scoped_documents WHERE partition=? AND key=?').get(partition, key)
    return row ? { revision: Number(row['revision']), value: JSON.parse(String(row['json'])) as unknown } : undefined
  }
  async insert(partition: string, key: string, value: unknown): Promise<boolean> {
    return this.db.prepare('INSERT OR IGNORE INTO scoped_documents VALUES(?,?,1,?)').run(partition, key, serializeDocument(value, this.maxDocumentBytes)).changes === 1
  }
  async replace(partition: string, key: string, expectedRevision: number, value: unknown): Promise<boolean> {
    return this.db.prepare('UPDATE scoped_documents SET revision=revision+1,json=? WHERE partition=? AND key=? AND revision=?')
      .run(serializeDocument(value, this.maxDocumentBytes), partition, key, expectedRevision).changes === 1
  }
  async delete(partition: string, key: string, expectedRevision: number): Promise<boolean> {
    return this.db.prepare('DELETE FROM scoped_documents WHERE partition=? AND key=? AND revision=?')
      .run(partition, key, expectedRevision).changes === 1
  }
  async list(partition: string, prefix: string, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('State list limit must be between 1 and 100.')
    return this.db.prepare('SELECT key,revision,json FROM scoped_documents WHERE partition=? AND substr(key,1,?)=? ORDER BY key DESC LIMIT ?')
      .all(partition, prefix.length, prefix, limit).map((row) => ({
        key: String(row['key']), revision: Number(row['revision']), value: JSON.parse(String(row['json'])) as unknown
      }))
  }
  close(): void { this.db.close() }
}
