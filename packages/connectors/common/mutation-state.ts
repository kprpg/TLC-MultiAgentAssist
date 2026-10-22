import { randomBytes } from 'node:crypto'
import { mkdir, open, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TokenCredential } from '@azure/core-auth'
import { TableClient } from '@azure/data-tables'
import { EncryptedDocumentStore } from './encrypted-document-store.js'
import { SqliteDocumentStore, type ScopedDocumentStore } from './scoped-document-store.js'
import { TableDocumentStore } from './table-document-store.js'

export interface MutationState {
  store?: ScopedDocumentStore
  durable: boolean
  close(): void
}

export async function protectedMutationKey(options: {
  lockPath: string
  read(): Promise<string | undefined>
  write(value: string): Promise<void>
}): Promise<Buffer> {
  const decode = (value: string): Buffer => {
    const key = Buffer.from(value, 'base64')
    if (key.length !== 32) throw new Error('The protected mutation-state key is invalid.')
    return key
  }
  const existing = await options.read()
  if (existing) return decode(existing)
  await mkdir(dirname(options.lockPath), { recursive: true })
  for (let attempt = 0; attempt < 40; attempt++) {
    let lock
    try { lock = await open(options.lockPath, 'wx') } catch (error) {
      if (!(error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error
      const current = await options.read()
      if (current) return decode(current)
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
      continue
    }
    try {
      const current = await options.read()
      if (current) return decode(current)
      const key = randomBytes(32)
      await options.write(key.toString('base64'))
      return key
    } finally { await lock.close(); await unlink(options.lockPath) }
  }
  throw new Error('Protected mutation state is being initialized by another window. Reconnect before enabling background writes.')
}

export async function localMutationState(path: string, key?: Buffer): Promise<MutationState> {
  await mkdir(dirname(path), { recursive: true })
  const sqlite = new SqliteDocumentStore(path, { maxDocumentBytes: key ? 72_000 : 48_000 })
  const store: ScopedDocumentStore = key ? new EncryptedDocumentStore(sqlite, key) : sqlite
  try {
    const check = await store.read('mutation-state:v1', 'key-check')
    if (check ? check.value !== 'tlc-mutation-state-v1'
      : !await store.insert('mutation-state:v1', 'key-check', 'tlc-mutation-state-v1')
        && (await store.read('mutation-state:v1', 'key-check'))?.value !== 'tlc-mutation-state-v1') {
      throw new Error('The mutation-state encryption key check failed. Restore the original protected key.')
    }
    return { store, durable: true, close: () => sqlite.close() }
  } catch (error) { sqlite.close(); throw error }
}

export function hostedMutationState(environment: NodeJS.ProcessEnv, credential: TokenCredential): MutationState {
  const configured = environment['TLC_MUTATION_TABLE_URL']?.trim()
  if (!configured) return { durable: false, close() {} }
  const url = new URL(configured)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname.endsWith('.table.core.windows.net')) {
    throw new Error('TLC_MUTATION_TABLE_URL must be an HTTPS Azure Table service URL without embedded credentials.')
  }
  const name = environment['TLC_MUTATION_TABLE_NAME']?.trim() || 'TlcMutations'
  if (!/^[A-Za-z][A-Za-z0-9]{2,62}$/.test(name)) throw new Error('The mutation receipt table name is invalid.')
  return { store: new TableDocumentStore(new TableClient(url.toString(), name, credential)), durable: true, close() {} }
}
