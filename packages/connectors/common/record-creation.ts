import type {
  RecordCreationCatalog,
  RecordCreationDraft,
  RecordCreationResult
} from '../../common/index.js'

export interface RecordCreationCatalogProvider {
  getCatalog(accountId: string): Promise<RecordCreationCatalog> | RecordCreationCatalog
}

export interface AtomicRecordCreationWriter {
  getReceipt(batchId: string, digest: string): Promise<RecordCreationResult | undefined> | RecordCreationResult | undefined
  commit(draft: RecordCreationDraft, batchId: string, digest: string): Promise<RecordCreationResult>
}
