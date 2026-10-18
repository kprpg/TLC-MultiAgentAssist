import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { ScopedDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'

const encryptedSchema = z.object({
  iv: z.string(), tag: z.string(), ciphertext: z.string(), expiresAt: z.number()
}).strict()
export class EncryptedSdkState {
  private readonly key: Buffer
  constructor(private readonly store: ScopedDocumentStore, private readonly partition: string, key: Buffer) {
    if (key.length !== 32) throw new Error('Bot credential-state encryption requires a 32-byte key.')
    this.key = Buffer.from(key)
  }
  private address(key: string): string { return createHash('sha256').update(key).digest('hex') }
  async get(key: string): Promise<unknown> {
    const row = await this.store.read(this.partition, this.address(key))
    if (!row || row.value === null) return undefined
    const encrypted = encryptedSchema.parse(row.value)
    if (encrypted.expiresAt <= Date.now()) return undefined
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(encrypted.iv, 'base64'))
    decipher.setAAD(Buffer.from(`${this.partition}:${this.address(key)}`))
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as unknown
  }
  async set(key: string, value: unknown): Promise<void> {
    const plaintext = JSON.stringify(value)
    if (!plaintext || Buffer.byteLength(plaintext) > 32_000) throw new Error('The bot credential-state size limit was exceeded.')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(`${this.partition}:${this.address(key)}`))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    await this.write(key, {
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'), expiresAt: Date.now() + 15 * 60_000
    })
  }
  async delete(key: string): Promise<void> { await this.write(key, null) }
  private async write(key: string, value: unknown): Promise<void> {
    const address = this.address(key)
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await this.store.read(this.partition, address)
      if (row ? await this.store.replace(this.partition, address, row.revision, value) : await this.store.insert(this.partition, address, value)) return
    }
    throw new Error('Concurrent bot credential-state update could not be persisted.')
  }
}
