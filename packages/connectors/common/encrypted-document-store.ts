import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { serializeDocument, type ScopedDocument, type ScopedDocumentStore } from './scoped-document-store.js'

const envelopeSchema = z.object({
  version: z.literal(1), iv: z.string(), tag: z.string(), ciphertext: z.string()
}).strict()

export class EncryptedDocumentStore implements ScopedDocumentStore {
  private readonly key: Buffer
  constructor(private readonly store: ScopedDocumentStore, key: Buffer) {
    if (key.length !== 32) throw new Error('Local state encryption requires a 32-byte key.')
    this.key = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'tlc-local-documents-v1', 32))
  }
  private encrypt(partition: string, key: string, revision: number, value: unknown) {
    const plaintext = serializeDocument(value)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(JSON.stringify([partition, key, revision])))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
  }
  private decrypt(partition: string, key: string, row: ScopedDocument): ScopedDocument {
    try {
      const envelope = envelopeSchema.parse(row.value)
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'))
      decipher.setAAD(Buffer.from(JSON.stringify([partition, key, row.revision])))
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
      return { revision: row.revision, value: JSON.parse(plaintext.toString('utf8')) as unknown }
    } catch (cause) {
      throw new Error('Local state could not authenticate its encryption key or document. Restore the matching key and backup.', { cause })
    }
  }
  async read(partition: string, key: string): Promise<ScopedDocument | undefined> {
    const row = await this.store.read(partition, key)
    return row ? this.decrypt(partition, key, row) : undefined
  }
  async insert(partition: string, key: string, value: unknown): Promise<boolean> {
    return this.store.insert(partition, key, this.encrypt(partition, key, 1, value))
  }
  async replace(partition: string, key: string, expectedRevision: number, value: unknown): Promise<boolean> {
    return this.store.replace(partition, key, expectedRevision, this.encrypt(partition, key, expectedRevision + 1, value))
  }
  async list(partition: string, prefix: string, limit: number) {
    return (await this.store.list(partition, prefix, limit)).map((row) => ({ key: row.key, ...this.decrypt(partition, row.key, row) }))
  }
  async delete(partition: string, key: string, expectedRevision: number): Promise<boolean> {
    if (!this.store.delete) throw new Error('Conditional deletion is unavailable for the protected state store.')
    return this.store.delete(partition, key, expectedRevision)
  }
}
