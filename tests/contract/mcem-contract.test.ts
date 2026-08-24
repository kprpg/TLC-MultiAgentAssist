import { describe, expect, it } from 'vitest'
import {
  contractVersion,
  mcemResponseSchema,
  recommendationSchema,
  sourceHealthSchema
} from '../../packages/common/index.js'

describe('MCEM v1 contracts', () => {
  it('rejects unsupported source states', () => {
    const result = sourceHealthSchema.safeParse({
      source: 'msx',
      state: 'connected-ish',
      detail: 'Ambiguous states are not allowed.',
      checkedAt: new Date().toISOString()
    })

    expect(result.success).toBe(false)
  })

  it('rejects an ungrounded recommendation not labeled as an assumption', () => {
    const result = recommendationSchema.safeParse({
      id: 'rec-1',
      action: 'Schedule a workshop.',
      ownerRole: 'Specialist',
      rationale: 'Advance the pursuit.',
      evidenceIds: [],
      assumption: false,
      confidence: 'low'
    })

    expect(result.success).toBe(false)
  })

  it('accepts a complete, evidence-grounded MCEM response', () => {
    const now = new Date().toISOString()
    const result = mcemResponseSchema.safeParse({
      contractVersion,
      correlationId: '4d959e87-b7bb-4db8-b145-a4a84e545042',
      capability: 'mcem-coach',
      agentVersion: '0.1.0',
      generatedAt: now,
      mode: 'sample',
      state: 'complete',
      summary: 'The recorded stage is ahead of the available evidence.',
      recordedStage: 3,
      evidenceBasedStage: 2,
      criteria: [{ id: 'business-case', label: 'Business case', status: 'missing', rationale: 'No quantified value.', evidenceIds: ['msx-1'] }],
      recommendations: [{ id: 'rec-1', action: 'Quantify the customer outcome.', ownerRole: 'Specialist', rationale: 'Stage 3 needs a supported business case.', evidenceIds: ['msx-1', 'mcem-1'], assumption: false, confidence: 'high' }],
      missingData: ['Quantified customer outcome'],
      evidence: [{ id: 'msx-1', source: 'msx', recordId: 'opp-1', title: 'Opportunity', retrievedAt: now, accessContext: 'sample', quality: 'observed', excerpt: 'Business case is not recorded.' }],
      sourceHealth: [{ source: 'msx', state: 'sample', detail: 'Sanitized fixture', checkedAt: now }]
    })

    expect(result.success).toBe(true)
  })
})