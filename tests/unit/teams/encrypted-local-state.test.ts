import { afterEach, describe, expect, it } from 'vitest'
import { EncryptedDocumentStore } from '../../../packages/connectors/common/encrypted-document-store.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'

const stores: SqliteDocumentStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture() {
  const raw = new SqliteDocumentStore(':memory:', { maxDocumentBytes: 72_000 })
  stores.push(raw)
  const key = Buffer.alloc(32, 7)
  return { raw, key, store: new EncryptedDocumentStore(raw, key) }
}

describe('encrypted durable laptop collaboration state', () => {
  it('encrypts payloads and preserves isolated read/list/CAS behavior for multiple FTE users', async () => {
    const { raw, store, key } = fixture()
    expect(await store.insert('user-a', 'action:opaque', { note: 'private-synthetic-note' })).toBe(true)
    expect(JSON.stringify((await raw.read('user-a', 'action:opaque'))?.value)).not.toContain('private-synthetic-note')
    expect((await new EncryptedDocumentStore(raw, key).read('user-a', 'action:opaque'))?.value).toEqual({ note: 'private-synthetic-note' })
    expect(await store.read('user-b', 'action:opaque')).toBeUndefined()
    expect(await store.list('user-b', 'action:', 10)).toEqual([])
    expect(await Promise.all([
      store.replace('user-a', 'action:opaque', 1, { state: 'claimed-a' }),
      store.replace('user-a', 'action:opaque', 1, { state: 'claimed-b' })
    ])).toEqual([true, false])
    expect(await store.list('user-a', 'action:', 10)).toEqual([expect.objectContaining({ key: 'action:opaque', revision: 2 })])
  })
  it('authenticates the partition, key and revision and never falls back to plaintext or an empty document', async () => {
    const { raw, store } = fixture()
    await store.insert('user-a', 'receipt:one', { state: 'effect-unknown' })
    const row = await raw.read('user-a', 'receipt:one')
    if (!row) throw new Error('Missing encrypted fixture.')
    await raw.insert('user-b', 'receipt:one', row.value)
    await expect(store.read('user-b', 'receipt:one')).rejects.toThrow(/authenticate/i)
    await raw.insert('user-a', 'receipt:other', row.value)
    await expect(store.read('user-a', 'receipt:other')).rejects.toThrow(/authenticate/i)
    await raw.replace('user-a', 'receipt:one', 1, row.value)
    await expect(store.read('user-a', 'receipt:one')).rejects.toThrow(/authenticate/i)
    await raw.insert('user-a', 'receipt:plaintext', { state: 'confirmed' })
    await expect(store.read('user-a', 'receipt:plaintext')).rejects.toThrow()
  })
  it('retains the existing 48000-byte logical document limit despite the encrypted envelope overhead', async () => {
    const { store } = fixture()
    const atLimit = 'a'.repeat(47_998)
    expect(Buffer.byteLength(JSON.stringify(atLimit))).toBe(48_000)
    expect(await store.insert('user', 'max', atLimit)).toBe(true)
    expect((await store.read('user', 'max'))?.value).toBe(atLimit)
    await expect(store.insert('user', 'oversized', 'a'.repeat(47_999))).rejects.toThrow(/size/i)
  })
})
