import { describe, expect, it } from 'vitest'
import { formatResponseMarkdown } from '../../../apps/desktop/renderer-revamp/src/response-markdown.js'

describe('response Markdown display formatting', () => {
    it('promotes response sections, owner roles, and evidence labels without changing links', () => {
        const source = `**MSX Opportunity:** [Open opportunity in MSX](https://example.com/opportunity)

Stage view

1. Specialist / SSP — Budget availability

- Gap: Partial
- Evidence: Opportunity value does not confirm funding.
- Next actions:

Recommended sequence

- First: ATS captures customer outcomes.

Missing data

Assumptions / cautions

- Do not treat value as proof of budget.`

        const formatted = formatResponseMarkdown(source)

        expect(formatted).toContain('## Stage view')
        expect(formatted).toContain('### Specialist / SSP — Budget availability')
        expect(formatted).toContain('- **Gap:** Partial')
        expect(formatted).toContain('- **Evidence:** Opportunity value does not confirm funding.')
        expect(formatted).toContain('- **Next actions:**')
        expect(formatted).toContain('## Recommended sequence')
        expect(formatted).toContain('## Missing data')
        expect(formatted).toContain('## Assumptions / cautions')
        expect(formatted).toContain('[Open opportunity in MSX](https://example.com/opportunity)')
    })

    it('leaves ordinary prose and existing Markdown headings unchanged', () => {
        const source = '## Existing heading\n\nThe customer needs a recommended sequence for approvals.'

        expect(formatResponseMarkdown(source)).toBe(source)
    })
})