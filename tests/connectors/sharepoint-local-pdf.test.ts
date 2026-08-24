import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalPdfMcemGuidanceConnector } from '../../packages/connectors/sharepoint/index.js'

const pdfPath = resolve('docs/knowledge/MCEM Overview.pdf')

describe('LocalPdfMcemGuidanceConnector', () => {
  it('loads MCEM guidance from the governed local PDF snapshot', async () => {
    const guidance = await new LocalPdfMcemGuidanceConnector(pdfPath).getStageGuidance(1)

    expect(guidance.version).toMatch(/^local-snapshot-\d{4}-\d{2}-\d{2}$/)
    expect(guidance.criteria.map((criterion) => criterion.id)).toEqual([
      'budget',
      'customer-outcome',
      'approval',
      'timing'
    ])
    expect(guidance.sourceUrl).toBeUndefined()
    expect(guidance.sourceHealth.state).toBe('partial')
    expect(guidance.sourceHealth.detail).toContain('docs/knowledge/MCEM Overview.pdf')
    expect(guidance.sourceHealth.detail).toContain('No live SharePoint request was made')
  })
})