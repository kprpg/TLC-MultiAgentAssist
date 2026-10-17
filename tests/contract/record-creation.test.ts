import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contractVersion,
  recordCreationDraftSchema,
  recordCreationPreviewRequestSchema,
  recordCreationCommitRequestSchema,
  recordCreationResultSchema,
  type RecordCreationDraft
} from '../../packages/common/index.js'

function fixture(name: string): RecordCreationDraft {
  return JSON.parse(readFileSync(resolve('tests', 'fixtures', 'record-creation', name, 'input.json'), 'utf8')) as RecordCreationDraft
}

const single = fixture('single-opportunity-multiple-milestones')
const multiple = fixture('multiple-opportunities-multiple-milestones')

describe('record creation contracts', () => {
  it('accepts the sanitized single and multiple Opportunity bundles with contract v1.2', () => {
    expect(contractVersion).toBe('1.2')
    expect(recordCreationDraftSchema.parse(single)).toEqual(single)
    expect(recordCreationDraftSchema.parse(multiple)).toEqual(multiple)
  })

  it('accepts Milestones on one existing Account-scoped Opportunity', () => {
    const parent = single.kind === 'opportunity-batch' ? single.opportunities[0]! : null
    expect(recordCreationDraftSchema.parse({
      kind: 'existing-opportunity-milestone-batch',
      account: { id: 'account-contoso', label: 'Contoso Energy' },
      opportunity: { id: 'opp-existing', label: 'Existing opportunity' },
      milestones: parent!.milestones
    }).kind).toBe('existing-opportunity-milestone-batch')
  })

  it('rejects unknown write fields, empty intent, duplicate keys and invalid dates', () => {
    if (single.kind !== 'opportunity-batch') throw new Error('Invalid fixture.')
    const bundle = single.opportunities[0]!
    for (const changed of [
      { ...single, opportunities: [{ ...bundle, opportunity: { ...bundle.opportunity, arbitraryODataBind: '/accounts(1)' } }] },
      { ...single, opportunities: [{ ...bundle, opportunity: { ...bundle.opportunity, intent: [] } }] },
      { ...single, opportunities: [{ ...bundle, milestones: [bundle.milestones[0], bundle.milestones[0]] }] },
      { ...single, opportunities: [{ ...bundle, milestones: [{ ...bundle.milestones[0], milestoneDate: '2027-02-30' }] }] },
      { ...single, opportunities: [{ ...bundle, opportunity: { ...bundle.opportunity, name: 'x'.repeat(201) } }] }
    ]) {
      expect(recordCreationDraftSchema.safeParse(changed).success).toBe(false)
    }
    expect(recordCreationDraftSchema.safeParse({
      ...single, opportunities: [bundle, bundle]
    }).success).toBe(false)
  })

  it('requires risk details for At Risk or Blocked milestones', () => {
    if (single.kind !== 'opportunity-batch') throw new Error('Invalid fixture.')
    const bundle = single.opportunities[0]!
    const atRisk = bundle.milestones[1]!
    expect(recordCreationDraftSchema.safeParse({
      ...single,
      opportunities: [{ ...bundle, milestones: [{ ...atRisk, riskDetails: undefined }] }]
    }).success).toBe(false)
  })

  it('only previews an approved target and rejects unreviewed confirmation', () => {
    expect(recordCreationPreviewRequestSchema.safeParse({ contractVersion, target: 'sqlite', draft: single }).success).toBe(true)
    expect(recordCreationPreviewRequestSchema.safeParse({ contractVersion, target: 'live-msx', draft: single }).success).toBe(true)
    expect(recordCreationPreviewRequestSchema.safeParse({ contractVersion, target: 'https://example.test', draft: single }).success).toBe(false)

    const preview = {
      contractVersion,
      batchId: 'batch-1',
      digest: 'a'.repeat(64),
      target: 'sqlite',
      catalogRevision: 'revision-1',
      normalizedDraft: single,
      mutationCount: 5,
      warnings: [],
      expiresAt: '2027-01-01T00:00:00.000Z'
    }
    expect(recordCreationCommitRequestSchema.safeParse({
      contractVersion, preview, expectedDigest: preview.digest, confirmed: true
    }).success).toBe(true)
    expect(recordCreationCommitRequestSchema.safeParse({
      contractVersion, preview, expectedDigest: preview.digest, confirmed: false
    }).success).toBe(false)
    expect(recordCreationCommitRequestSchema.safeParse({
      contractVersion, preview, expectedDigest: preview.digest
    }).success).toBe(false)
  })

  it('distinguishes a draft from a committed receipt without inventing record IDs', () => {
    const draftResult = {
      contractVersion,
      batchId: 'batch-1',
      target: 'draft' as const,
      state: 'drafted' as const,
      created: [],
      audit: { correlationId: 'correlation-1', opportunityCount: 1, milestoneCount: 3 },
      message: 'Draft created. No Opportunity or Milestone was written to MSX.'
    }
    expect(recordCreationResultSchema.parse(draftResult).created).toEqual([])
    expect(recordCreationResultSchema.safeParse({
      ...draftResult,
      state: 'committed',
      created: [{ clientKey: 'opportunity-1', kind: 'opportunity', recordId: 'opp-1' }]
    }).success).toBe(false)
    expect(recordCreationResultSchema.safeParse({
      ...draftResult,
      audit: { ...draftResult.audit, committedAt: '2027-01-01T00:00:00.000Z' }
    }).success).toBe(false)
    expect(recordCreationResultSchema.safeParse({
      ...draftResult,
      target: 'sqlite',
      state: 'committed',
      audit: { ...draftResult.audit, committedAt: '2027-01-01T00:00:00.000Z' }
    }).success).toBe(false)
  })
})
