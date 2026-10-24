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

    it('formats the numbered and bold section labels used by the agents', () => {
        const source = `1. Summary
Grounded assessment.

**2. Context used**
Account: Sample account
MCEM stage: 2

3) Observed signals:
- Source: MSX
- Freshness: Current

**Recommended actions:**
- Owner role: ATS
- Priority: High
- Rationale: Confirm the sponsor.
- Confidence: Medium
- Evidence references: O.C1

8. Assumptions and missing information
Approval is unconfirmed.

9. Feedback prompt
Would you like me to convert this into an action plan?`

        const formatted = formatResponseMarkdown(source)

        for (const heading of ['Summary', 'Context used', 'Observed signals', 'Recommended actions', 'Assumptions and missing information', 'Feedback prompt']) {
            expect(formatted).toContain(`## ${heading}`)
        }
        for (const label of ['Account', 'MCEM stage', 'Source', 'Freshness', 'Owner role', 'Priority', 'Rationale', 'Confidence', 'Evidence references']) {
            expect(formatted).toContain(`**${label}:**`)
        }
        expect(formatResponseMarkdown(formatted)).toBe(formatted)
    })

    it('separates inline section headings from their content', () => {
        expect(formatResponseMarkdown('1. Summary: Evidence is incomplete.\n\n**Sources:** [MSX](https://example.com)'))
            .toBe('## Summary\n\nEvidence is incomplete.\n\n## Sources\n\n[MSX](https://example.com)')
        expect(formatResponseMarkdown('**Summary**: **Budget** is unconfirmed.\n\n**Sources:** [MSX](https://example.com:443)'))
            .toBe('## Summary\n\n**Budget** is unconfirmed.\n\n## Sources\n\n[MSX](https://example.com:443)')
    })

    it('preserves code, quotes, ordinary numbered lists, and existing emphasis', () => {
        const source = '```text\nSummary\n- Owner: unchanged\n```\n\n~~~\n1. Summary\n~~~\n\n> Summary\n\n1. Confirm the sponsor.\n2. Review evidence.\n\n- **Owner:** ATS'

        expect(formatResponseMarkdown(source)).toBe(source)
    })
})