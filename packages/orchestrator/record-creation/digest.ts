import { createHmac, randomBytes } from 'node:crypto'
import type { RecordCreationDraft, RecordCreationPreview } from '../../common/index.js'

const signingKey = randomBytes(32)

export function creationPreviewDigest(input: {
  batchId: string
  target: RecordCreationPreview['target']
  catalogRevision: string
  userId: string
  normalizedDraft: RecordCreationDraft
  mutationCount: number
  warnings: readonly string[]
  expiresAt: string
}): string {
  return createHmac('sha256', signingKey).update(JSON.stringify(input)).digest('hex')
}
