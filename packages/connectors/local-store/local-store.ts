import { createRequire } from 'node:module'
import { LOCAL_STORE_SCHEMA } from './schema.js'
import { defaultSeed, type LocalStoreSeed } from './seed.js'

type Row = Record<string, string | number | null>
type QueryRow = Record<string, unknown>
type ScalarParam = string | number | null

// Load node:sqlite lazily (via require) so merely importing this package is safe on runtimes where
// node:sqlite is flagged/unavailable (e.g. Electron's bundled Node 22.x needs --experimental-sqlite).
// Only constructing a LocalStore — i.e. explicitly selecting the SQLite test store — touches it.
const requireModule = createRequire(import.meta.url)

/**
 * A persistent, relational local test-data store backed by `node:sqlite` (built in; no
 * extra dependency). Applies the schema and seed, and exposes small typed query/mutation
 * helpers used by the local-store MSX connector. Defaults to an in-memory database;
 * pass a file path for a store whose injected values survive restarts.
 */
export class LocalStore {
  private readonly db: InstanceType<typeof import('node:sqlite').DatabaseSync>

  constructor(options: { path?: string; seed?: LocalStoreSeed } = {}) {
    const { DatabaseSync } = requireModule('node:sqlite') as typeof import('node:sqlite')
    this.db = new DatabaseSync(options.path ?? ':memory:')
    this.db.exec(LOCAL_STORE_SCHEMA)
    this.load(options.seed ?? defaultSeed)
  }

  private load(seed: LocalStoreSeed): void {
    const tables: Array<[string, readonly Row[]]> = [
      ['account', seed.accounts],
      ['systemuser', seed.systemUsers],
      ['competitor', seed.competitors],
      ['opportunity', seed.opportunities],
      ['engagement_milestone', seed.milestones],
      ['contact', seed.contacts],
      ['stakeholder', seed.stakeholders],
      ['opportunity_dealteam', seed.dealTeam],
      ['discoverable_opportunity', seed.discoverable],
      ['activity', seed.activities],
      ['transcript', seed.transcripts],
      ['transcript_segment', seed.transcriptSegments],
      ['option_value', seed.optionValues]
    ]
    for (const [table, rows] of tables) {
      for (const row of rows) this.insert(table, row)
    }
  }

  private insert(table: string, row: Row): void {
    const columns = Object.keys(row)
    const placeholders = columns.map(() => '?').join(', ')
    const statement = this.db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
    statement.run(...columns.map((column) => row[column] as ScalarParam))
  }

  all(sql: string, ...params: ScalarParam[]): QueryRow[] {
    return this.db.prepare(sql).all(...params) as QueryRow[]
  }

  get(sql: string, ...params: ScalarParam[]): QueryRow | undefined {
    return this.db.prepare(sql).get(...params) as QueryRow | undefined
  }

  run(sql: string, ...params: ScalarParam[]): void {
    this.db.prepare(sql).run(...params)
  }

  /** Executes raw SQL (used for transaction control: BEGIN / COMMIT / ROLLBACK). */
  exec(sql: string): void {
    this.db.exec(sql)
  }

  close(): void {
    this.db.close()
  }
}
