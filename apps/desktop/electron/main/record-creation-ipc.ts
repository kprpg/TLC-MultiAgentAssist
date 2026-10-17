import {
  recordCreationCatalogRequestSchema,
  recordCreationCatalogSchema,
  recordCreationPreviewRequestSchema,
  recordCreationPreviewSchema,
  recordCreationCommitRequestSchema,
  recordCreationResultSchema,
  recordCreationDraftResultSchema
} from '../../../../packages/common/index.js'
import type { ThinSliceOrchestrator } from '../../../../packages/orchestrator/index.js'

export const recordCreationIpcChannels = {
  catalog: 'tlc:get-record-creation-catalog',
  preview: 'tlc:preview-record-creation',
  commit: 'tlc:commit-record-creation',
  draft: 'tlc:export-record-creation-draft'
} as const

export function createRecordCreationIpcHandlers(
  orchestrator: Pick<ThinSliceOrchestrator,
    'getRecordCreationCatalog' | 'previewRecordCreation' | 'commitRecordCreation' | 'exportRecordCreationDraft'>
): Readonly<Record<string, (request: unknown) => Promise<unknown>>> {
  return {
    [recordCreationIpcChannels.catalog]: async (input) =>
      recordCreationCatalogSchema.parse(await orchestrator.getRecordCreationCatalog(recordCreationCatalogRequestSchema.parse(input))),
    [recordCreationIpcChannels.preview]: async (input) =>
      recordCreationPreviewSchema.parse(await orchestrator.previewRecordCreation(recordCreationPreviewRequestSchema.parse(input))),
    [recordCreationIpcChannels.commit]: async (input) =>
      recordCreationResultSchema.parse(await orchestrator.commitRecordCreation(recordCreationCommitRequestSchema.parse(input))),
    [recordCreationIpcChannels.draft]: async (input) =>
      recordCreationDraftResultSchema.parse(await orchestrator.exportRecordCreationDraft(recordCreationCommitRequestSchema.parse(input)))
  }
}
