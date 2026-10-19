import { createHash } from 'node:crypto'
import type { TableClient } from '@azure/data-tables'
import { serializeDocument, type ScopedDocument, type ScopedDocumentStore } from './scoped-document-store.js'

function status(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
    ? error.statusCode : undefined
}
function partitionKey(value: string): string { return createHash('sha256').update(value).digest('hex') }
function rowKey(value: string): string { return Buffer.from(value).toString('base64url') }

export class TableDocumentStore implements ScopedDocumentStore {
  constructor(private readonly client: TableClient) {}
  async read(partition: string, key: string): Promise<ScopedDocument | undefined> {
    try {
      const entity = await this.client.getEntity<{ json: string; revision: number }>(partitionKey(partition), rowKey(key))
      return { revision: entity.revision, value: JSON.parse(entity.json) as unknown }
    } catch (error) {
      if (status(error) === 404) return undefined
      throw error
    }
  }
  async insert(partition: string, key: string, value: unknown): Promise<boolean> {
    try {
      await this.client.createEntity({ partitionKey: partitionKey(partition), rowKey: rowKey(key), revision: 1, json: serializeDocument(value) })
      return true
    } catch (error) {
      if (status(error) === 409) return false
      throw error
    }
  }
  async replace(partition: string, key: string, expectedRevision: number, value: unknown): Promise<boolean> {
    try {
      const entity = await this.client.getEntity<{ revision: number }>(partitionKey(partition), rowKey(key))
      if (entity.revision !== expectedRevision) return false
      await this.client.updateEntity({
        partitionKey: partitionKey(partition), rowKey: rowKey(key), revision: expectedRevision + 1, json: serializeDocument(value)
      }, 'Replace', { etag: entity.etag })
      return true
    } catch (error) {
      if ([404, 409, 412].includes(status(error) ?? 0)) return false
      throw error
    }
  }
  async list(partition: string, prefix: string, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('State list limit must be between 1 and 100.')
    const result: Array<{ key: string } & ScopedDocument> = []
    let examined = 0
    for await (const entity of this.client.listEntities<{ json: string; revision: number }>({
      queryOptions: { filter: `PartitionKey eq '${partitionKey(partition)}'` }
    })) {
      if (++examined > 500) throw new Error('Private state enumeration requires a narrower partition.')
      const key = Buffer.from(entity.rowKey ?? '', 'base64url').toString()
      if (key.startsWith(prefix)) result.push({ key, revision: entity.revision, value: JSON.parse(entity.json) as unknown })
      if (result.length === limit) break
    }
    return result
  }
}
