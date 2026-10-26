import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InferenceModeBadge, InferenceNotice } from '../../../apps/shared/inference-status.js'
import { inferenceExecutionSchema } from '../../../packages/common/contracts/inference.js'
describe('shared sample AI status presentation', () => {
  it('distinguishes configured real AI, explicit offline mode and unchanged live labels', () => {
    expect(renderToStaticMarkup(createElement(InferenceModeBadge, { label: 'old', mode: 'foundry' }))).toContain('Sample data / Foundry AI')
    expect(renderToStaticMarkup(createElement(InferenceModeBadge, { label: 'old', mode: 'sample' }))).toContain('Sample data / Offline AI')
    expect(renderToStaticMarkup(createElement(InferenceModeBadge, { label: 'Live' }))).toBe('<span class="mode-badge">Live</span>')
  })
  it('renders an accessible warning for a local fallback and no notice on unchanged live output', () => {
    const execution = inferenceExecutionSchema.parse({
      contractVersion: '1.0', correlationId: '00000000-0000-4000-8000-000000000001',
      requested: 'foundry', provider: 'sample', state: 'fallback', reason: 'quota'
    })
    expect(renderToStaticMarkup(createElement(InferenceNotice, { execution }))).toContain('role="alert"')
    expect(renderToStaticMarkup(createElement(InferenceNotice, { execution }))).toContain('Offline/sample fallback')
    expect(renderToStaticMarkup(createElement(InferenceNotice, {}))).toBe('')
  })
})
